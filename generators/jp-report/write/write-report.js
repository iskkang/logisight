'use strict';
// generators/jp-report/write/write-report.js
// writer 단계 — 팩트시트 → 섹션별 초안 → 마크다운 리포트.
// 사용법: node generators/jp-report/write/write-report.js [--facts=경로] [--out=경로]
//
// 섹션마다 생성 직후 verifier(a)로 수치를 대조하고, 위반이 있으면 지적사항을 붙여
// 재생성한다. 마지막 재시도까지 걸리면 섹션 전체를 또 쓰지 않고 걸린 문장만 고친다
// (write/repair.js). 그래도 남으면 미해결로 기록하고 원고를 조합하지 않는다 —
// 조용히 통과시키지 않는다.
//
// 종료 코드: 0 = 원고 작성, 2 = 검수 미해결(원고 없음), 1 = 실패.
// 미해결 목록은 outputs/cache/jp-report/<월>/unresolved.json 에도 남긴다.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { callClaude, callClaudeJson } = require('../../lib/claude');
const { reviewSection, needsRewrite, buildIssueFeedback, splitBySeverity } = require('../verify/editorial');
const { generationOrder, outputOrder, slimFactsheet } = require('./sections');
const { HEDGE } = require('../verify/hedges');
const { deterministicChecks } = require('../verify/deterministic');
const { attachSentences, repairSection, numberRule } = require('./repair');
const { composeSection } = require('./heading');
const cache = require('./cache');
const { tablesFor } = require('./tables');

const STYLE = fs.readFileSync(path.join(__dirname, 'STYLE.ja.md'), 'utf8');
const SEO = fs.readFileSync(path.join(__dirname, 'SEO.ja.md'), 'utf8');

/** thinking이 예산을 잠식해 본문이 비는 일이 있어 넉넉히 잡는다. */
const MAX_TOKENS = 16000;
/**
 * 본문 모델. 기본은 lib/claude.js의 sonnet이다.
 *
 * opus로 올려봤다가 되돌렸다. 재시도가 줄 줄 알았는데 반대였다:
 *   7차(sonnet) 편집 검수 차단 3회 · 미해결 1건 · 8,156자
 *   9차(opus)   편집 검수 차단 10회 · 미해결 2건 · 9,512자
 * opus가 더 길고 해석을 많이 쓴다. 해석 문장이 늘수록 검수자가 speculation으로
 * 걸 표면이 늘어난다. 이 파이프라인에서는 그게 손해였다.
 *
 * 재시도를 줄이는 것은 모델이 아니라 결정적 검사다. 섹션이 7개라 섹션당
 * 통과율을 조금 올려도 7제곱 앞에서 티가 안 난다. LLM 검수가 잡아낸 것 중
 * 패턴이 있는 것을 코드로 내리는 편이 훨씬 크게 듣는다.
 *
 * 바꿔서 시험하려면 JP_WRITER_MODEL 로 준다.
 */
const WRITER_MODEL = process.env.JP_WRITER_MODEL || undefined;

// 모델이 합산·차분을 반복해서 시도한다. 실측상 재시도마다 위반이 줄어든다.
//
// 2회로는 부족해졌다. 검사가 넷(수치·유보·지속·편집)이고 각 차단이 재시도를 한 번씩
// 먹는다. 2026-06호 02. 海運이 편집→유보로 두 번 쓰고 세 번째가 마지막이 되어,
// 남은 편집 지적을 반영할 기회 없이 발행이 막혔다. 검사 수에 맞춰 늘린다.
const MAX_RETRY = 4;

/**
 * 검사기가 기계적으로 세는 규칙을 프롬프트에 그대로 싣는다.
 *
 * STYLE.ja.md는 사람이 읽는 문체 가이드이고, 이쪽은 코드가 세는 목록이다.
 * 「留保は一文まで」라고만 써두면 모델은 무엇이 留保로 세어지는지 모른 채 쓰고,
 * 매번 상한 초과로 재생성된다(1회당 약 2분). 세는 말을 그대로 보여준다.
 *
 * HEDGE 목록은 verify/hedges.js에서 가져온다. 여기에 손으로 옮겨 적으면
 * 검사기를 고쳤을 때 프롬프트만 옛 목록으로 남는다.
 *
 * 이 블록은 캐시 지문(fingerprint)에 들어가지 않는다 — 지문은 STYLE·SEO·팩트시트
 * 조각으로 만든다. 여기를 고쳐도 통과한 섹션을 다시 쓰지 않는다. 의도한 것이다.
 */
function machineRules() {
  return [
    '=== 機械検査の規則(コードが数える。違反すると自動で書き直しになる) ===',
    '',
    '【留保は1セクションに1文まで】次の語を含む文を「留保」として数える。',
    HEDGE.map((h) => `「${h}」`).join('・'),
    '2文以上あると差し戻される。無いデータを繰り返し断るより、有るデータで言えることを増やす。',
    '留保の代わりに事実の記述で終える:',
    '  悪い例: 「航空のスポット指数は本レポートのデータに含まれていない。」',
    '  良い例: 「国際航空貨物輸送は円ベース142.4、契約通貨ベース98.1である。」',
    '  悪い例: 「需給のどちらから動いたかは説明できない。」',
    '  良い例: 「公表された直近回の欠航は49便(6%)である。」',
    '',
    '【閾値・目安の数値を作らない】factsheet に無い数値は、丸めた目安であっても書けない。',
    '「10%を上回る水準」「2000台を割り込む」のような基準線は、その数値が factsheet に無い限り書かない。',
    'コードが本文の数字を factsheet と突き合わせるので、必ず弾かれる。',
    '',
    '【順位・最上級は factsheet に載っている範囲でだけ書く】',
    'factsheet にあるのは一部の国・港・系列である。全体の順位は分からない。',
    '  悪い例: 「最も伸びたのは台湾である」(全体の比較ができない)',
    '  良い例: 「factsheet にある国のうち、伸び率が最も高いのは台湾である」',
    '範囲を書けないなら順位ではなく水準の対比で述べる。',
    '',
    '【別の指数を同じ根拠に束ねない】',
    'ERAI と SCFI・CCFI は対象も作成者も異なる。海運と航空も別である。',
    '一方の動きをもう一方の裏付けとして使わない。並べるときは別々の事実として並べる。',
    '',
    '【反映される月を名指ししない】公表の遅れは事実として述べるだけにする。',
    '  悪い例: 「8月分に反映される」「次の公表で表れる」(転嫁ラグを置いたことになる)',
    '  良い例: 「日本の指数は6月分までの公表である」',
    '',
    '【factsheet に無い時点を書かない】periods は月次統計の基準月、asOf は週次データの基準日である。',
    '週次の asOf が基準月より後を指すことはある(月次は遅れて出る)。そこまでは書いてよい。',
    'しかし factsheet が持っていない時点の動きは、「〜月に入って」の形であっても書かない。',
    '時点に触れるときは factsheet の日付をそのまま書く。',
  ].join('\n');
}

function systemPrompt() {
  return [
    'あなたは日本の物流専門メディアの編集記者だ。荷主・フォワーダー向けの月次マーケットレポートを書く。',
    '以下の文体ガイドと SEO ガイドに従う。',
    '', '=== 文体ガイド ===', STYLE,
    '', '=== SEO ガイド ===', SEO,
    '', machineRules(),
  ].join('\n');
}

function userPrompt(section, slim, digests, violations, issues, hedgeNote, phraseNote, jargonNote, causeNote) {
  const parts = [
    `セクション「${section.no}. ${section.title}」の本文を書け。`,
    '',
    '【このセクションの狙い】',
    section.focus,
    '',
  ];
  if (section.subsections && section.subsections.length > 0) {
    parts.push('【小見出し構成】次の小見出しを「## 」で立て、それぞれに本文を書く。順序は変えない。',
      '小見出しには内容を表すヘッドラインを付け足してよい(例: 「## 02-1. 外航海上 — 円ベースが突出」)。',
      section.subsections.map((t) => `- ${t}`).join('\n'),
      // 섹션 제목은 코드가 찍는다. 모델이 같이 쓰면 소섹션 번호가 한 칸씩 밀린다.
      `セクション見出し「${section.no}. ${section.title}」は書かない。小見出しから始める。`, '');
  }
  parts.push(
    // 표를 LLM이 그리면 반드시 수치 오류가 섞인다. 코드가 그린 표를 나중에 끼워 넣는다.
    '【重要】数値の表(マークダウンテーブル)は書かない。表はシステムが自動で挿入する。',
    '本文では表の数値を必要な分だけ引用し、解釈に集中する。',
    '',
    // 金額は既に億円に換算して渡す。モデルに割り算をさせると表と1億円ずれた。
    '【ファクトシート】単位: 金額=億円(換算済み), 運賃=指数(2020年=100), 港湾=TEU',
    '【重要】ファクトシートの項目名(英数字のキー)を本文に書かない。必ず日本語に言い換える。',
    '金額は自分で計算しない。換算済みの金額の値をそのまま使う。'
    + '1万億円以上は「10兆9265億円」のように兆で区切ってよいが、下4桁は変えない。',
    JSON.stringify(slim),
  );
  if (digests.length > 0) {
    parts.push('', '【他セクションの要旨】これらが確定した事実である。新たな数値を持ち込まない。',
      digests.map((d) => `- ${d.title}: ${d.digest}`).join('\n'));
  }
  if (violations && violations.length > 0) {
    // 문맥 ±20자만 보내던 때는 모델이 어느 문장을 고칠지 못 짚고 같은 위반을 반복했다.
    // 위반 숫자 · 그 문장 원문 · 무엇을 하라는 지시, 셋을 다 보낸다.
    parts.push('', '【前回の指摘・数値】以下の数値はファクトシートに存在しない。書き直せ。',
      violations.map((v) => [
        `- 「${v.raw}」 … ${v.sentence || v.context}`,
        `  → ${v.rule || numberRule([v.raw])}`,
      ].join('\n')).join('\n'));
  }
  if (hedgeNote) parts.push('', hedgeNote);
  if (phraseNote) parts.push('', phraseNote);
  if (jargonNote) parts.push('', jargonNote);
  if (causeNote) parts.push('', causeNote);
  if (issues && issues.length > 0) {
    parts.push('', '【前回の指摘・編集】編集デスクの指摘である。すべて反映して書き直せ。',
      buildIssueFeedback(issues));
  }
  parts.push('', '見出し(## で始まる行)と本文のみを出力する。前置きや説明は書かない。');
  return parts.join('\n');
}

function textOf(res) {
  return (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
}

/** 총론에 넘길 요지 — 앞 2문장. 숫자를 다시 굴리지 않게 짧게 준다. */
function digestOf(body) {
  const plain = body.replace(/^#+.*$/gm, '').replace(/\s+/g, ' ').trim();
  return plain.split(/(?<=。)/).slice(0, 2).join('').slice(0, 180);
}

/**
 * 걸린 한 문장만 다시 쓰게 한다. 부분 수리(write/repair.js)가 쓰는 호출기다.
 * 섹션 전체 재생성은 약 2분, 이쪽은 수 초다.
 */
async function rewriteSentence(sentence, instruction) {
  const res = await callClaude({
    model: WRITER_MODEL,
    // sonnet은 thinking과 본문이 예산을 함께 쓴다. 한 문장이라도 넉넉히 준다.
    max_tokens: 4000,
    system: 'あなたは日本の物流専門メディアの編集記者だ。渡された一文だけを指示どおりに書き直す。',
    messages: [{
      role: 'user',
      content: [
        '次の一文を、指示に従って書き直せ。',
        '', '【指示】', instruction,
        '', '【条件】',
        '- 常体(だ・である)で、一文だけ出力する。',
        '- 前置き・説明・引用符・箇条書きを付けない。書き直した本文だけを出力する。',
        '- 新しい数値を持ち込まない。指示で許された数値以外は書かない。',
        '- 元の文が見出し(「#」で始まる)なら、見出しの形のまま書き直す。',
        '', '【原文】', sentence,
      ].join('\n'),
    }],
  });
  return textOf(res);
}

/**
 * 두 층으로 검수한다.
 * (a) 결정적 수치 대조 — 코드. 통과해야 (b)로 넘어간다(틀린 수치를 편집 검수에 보낼 이유가 없다).
 * (b) LLM 편집 검수 — 추측·출처 없는 단정·signals 누락·문체.
 */
async function writeSection(section, factsheet, digests) {
  const slim = slimFactsheet(factsheet, section.id);
  let violations = null;
  let issues = null;
  let hedgeNote = null;
  let phraseNote = null;
  let jargonNote = null;
  let causeNote = null;
  let body = '';

  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    const res = await callClaude({
      model: WRITER_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt(),
      messages: [{ role: 'user', content: userPrompt(section, slim, digests, violations, issues, hedgeNote, phraseNote, jargonNote, causeNote) }],
    });
    body = textOf(res);
    if (!body) throw new Error(`${section.id}: 본문이 비었다 (thinking이 예산을 소진했을 수 있다)`);

    const last = attempt === MAX_RETRY;

    const fail = deterministicChecks(body, factsheet);
    if (fail) {
      // 위반 숫자만이 아니라 그 문장 원문까지 되돌려준다 — ±20자 문맥으로는
      // 모델이 어디를 고칠지 못 짚고 같은 위반을 반복했다.
      violations = fail.violations ? attachSentences(body, fail.violations, factsheet) : null;
      issues = null;
      hedgeNote = fail.slot === 'hedge' ? fail.note : null;
      phraseNote = fail.slot === 'phrase' ? fail.note : null;
      jargonNote = fail.slot === 'jargon' ? fail.note : null;
      causeNote = fail.slot === 'cause' ? fail.note : null;
      console.warn(`  ⚠️ ${section.id}: ${fail.label} — ${last ? '부분 수리 시도' : '재생성'}`);
      if (!last) continue;

      // 마지막 시도에도 걸렸다. 섹션 전체를 또 쓰는 대신 걸린 문장만 고친다.
      // 통과하지 못하면 통과시키지 않는다 — 저장도 하지 않는다. 여기서 깨끗한 것으로
      // 돌려주면 캐시에 들어가 다음 회차가 그대로 되쓴다.
      const repaired = await repairSection({
        body,
        factsheet,
        rewrite: rewriteSentence,
        log: (msg) => console.warn(`  🔧 ${section.id}: ${msg}`),
      });
      if (repaired.ok) {
        // 편집 검수(b)는 다시 돌리지 않는다. 바뀐 것은 문장 하나이고, 여기서
        // 2분짜리 왕복을 한 번 더 도는 것은 이 단계의 취지에 어긋난다.
        return { body: repaired.body, violations: [], issues: [], warnings: [], attempts: attempt + 1, repaired: repaired.how };
      }
      console.warn(`  ⚠️ ${section.id}: 부분 수리로도 해결되지 않았다 — 미해결로 기록`);
      return {
        body,
        violations: violations || [],
        issues: fail.violations ? [] : [{ type: 'deterministic', reason: fail.label }],
        warnings: [],
        attempts: attempt + 1,
      };
    } else {
      violations = null;
      hedgeNote = null; phraseNote = null; jargonNote = null; causeNote = null;
    }

    // 검수자에게는 전체 팩트시트를 준다. 슬림본을 주면 총론이 인용한 수치를
    // 출처 불명으로 오판한다(실제로 그렇게 오탐이 났다).
    const review = await reviewSection(callClaudeJson, section, body, factsheet);
    if (!needsRewrite(review.verdict)) {
      return { body, violations: [], issues: [], warnings: [], attempts: attempt + 1 };
    }
    const { blocking, warnings } = splitBySeverity(review.issues);
    // 문체 지적만 남았으면 통과시킨다. 그것만으로 영구히 막히면 자동 발행이 성립하지 않는다.
    if (blocking.length === 0) {
      console.warn(`  ℹ️ ${section.id}: 문체 지적 ${warnings.length}건 — 기록 후 통과`);
      return { body, violations: [], issues: [], warnings, attempts: attempt + 1 };
    }
    issues = review.issues;
    console.warn(`  ⚠️ ${section.id}: 편집 검수 ${review.verdict} 차단 ${blocking.length}건 — ${last ? '기록 후 통과' : '재생성'}`);
    console.warn(`      ${blocking[0].type}: ${blocking[0].reason}`.slice(0, 110));
  }
  const { blocking, warnings } = splitBySeverity(issues || []);
  return { body, violations: violations || [], issues: blocking, warnings, attempts: MAX_RETRY + 1 };
}

async function writeReport(factsheet, { fresh = false } = {}) {
  const period = factsheet.generatedFor;
  if (fresh) cache.clear(period);

  const digests = [];
  const bodies = new Map();
  const allViolations = [];
  const rewrites = [];
  let reused = 0;

  for (const section of generationOrder()) {
    const slim = slimFactsheet(factsheet, section.id);
    const fp = cache.fingerprint({ slim, section, style: STYLE, seo: SEO, digests });

    // 저장분이 있어도 결정적 검사는 다시 돌린다. 검사기를 새로 추가했을 때
    // 예전에 통과한 본문이 그 검사를 건너뛰면 안 된다.
    const saved = cache.read(period, section.id, fp);
    if (saved && !deterministicChecks(saved, factsheet)) {
      console.log(`  ▸ ${section.no}. ${section.title} — 저장분 사용`);
      bodies.set(section.id, composeSection(saved, section, tablesFor(section.id, factsheet)));
      if (!section.generateLast) digests.push({ title: section.title, digest: digestOf(saved) });
      reused += 1;
      continue;
    }

    console.log(`  ▸ ${section.no}. ${section.title}`);
    const { body, violations, issues, attempts, repaired } = await writeSection(section, factsheet, digests);
    rewrites.push({ section: section.id, attempts, repaired: repaired || null });
    // 섹션 제목과 표는 코드가 찍는다 — 모델은 소섹션 번호를 빠뜨리고,
    // 표를 그리게 하면 수치 오류가 섞인다. 목차·앵커가 번호에 의존한다.
    bodies.set(section.id, composeSection(body, section, tablesFor(section.id, factsheet)));

    if (violations.length > 0 || issues.length > 0) {
      allViolations.push({ section: section.id, violations, issues });
      // 막힌 본문은 저장하지 않는다. 저장하면 다음 회차가 그걸 되쓴다.
    } else {
      cache.write(period, section.id, fp, body);
    }
    // 총론은 요지를 소비하는 쪽이므로 자신의 요지는 넘기지 않는다.
    if (!section.generateLast) digests.push({ title: section.title, digest: digestOf(body) });
  }

  const markdown = outputOrder()
    .map((s) => bodies.get(s.id))
    .filter(Boolean)
    .join('\n\n---\n\n');

  // 미해결 목록은 한 줄에 하나씩 평면화한다. run.js와 워크플로 로그가 이것을 그대로 찍는다.
  const unresolved = allViolations.flatMap(({ section, violations, issues }) => [
    ...violations.map((v) => ({
      section, type: 'number', detail: `「${v.raw}」 … ${v.sentence || v.context}`,
    })),
    ...issues.map((i) => ({ section, type: i.type, detail: i.reason })),
  ]);

  return {
    status: unresolved.length > 0 ? 'unresolved' : 'ok',
    unresolved,
    markdown,
    violations: allViolations,
    rewrites,
    period,
    reused,
    total: generationOrder().length,
  };
}

async function main() {
  const arg = (name, fallback) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=').slice(1).join('=') : fallback;
  };
  const factsPath = arg('facts', path.resolve(__dirname, '../../../content/drafts/jp-factsheet.json'));
  const factsheet = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
  const outPath = arg('out', path.resolve(__dirname, `../../../content/drafts/jp-report-${factsheet.generatedFor}.md`));

  const fresh = process.argv.includes('--fresh');
  const period = factsheet.generatedFor;
  console.log(`📝 일본 월간 리포트 생성 (${period})${fresh ? ' — 저장분 버리고 전부 다시 씀' : ''}`);

  let result;
  try {
    result = await writeReport(factsheet, { fresh });
  } catch (e) {
    // status: 'error' — 원고 생성 자체가 실패했다. 미해결(2)과 구분해 1로 끝낸다.
    result = { status: 'error', unresolved: [{ section: '-', type: 'error', detail: e.message }] };
  }

  if (result.status === 'error') {
    console.error(`\n❌ 리포트 생성 실패: ${result.unresolved[0].detail}`);
    console.error(`   기록: ${cache.writeUnresolved(period, result)}`);
    process.exitCode = 1;
    return;
  }

  const { markdown, violations, unresolved, reused, total } = result;

  if (result.status === 'unresolved') {
    // 통과한 섹션은 저장돼 있다. 다음 실행은 막힌 섹션만 다시 쓴다.
    console.warn(`\n⚠️ 미해결 ${violations.length}개 섹션 — 원고를 조합하지 않는다`);
    unresolved.forEach((u) => console.warn(`   ${u.section} [${u.type}] ${u.detail}`));
    console.warn(`   통과 ${total - violations.length}/${total}개는 저장했다. 다시 실행하면 남은 것만 쓴다.`);
    console.warn(`   저장 위치: ${path.join(cache.ROOT, String(period))}`);
    console.warn(`   미해결 목록: ${cache.writeUnresolved(period, result)}`);
    process.exitCode = 2; // 발행 파이프라인이 이 코드를 보고 멈춘다(fail-closed)
    return;
  }

  cache.clearUnresolved(period); // 지난 실행의 목록이 남아 있으면 로그가 거짓말을 한다
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, 'utf8');
  console.log(`✅ ${outPath} (${markdown.length}자 · 저장분 재사용 ${reused}/${total})`);
  // 어느 섹션이 몇 번 만에 통과했는지. 재시도가 어디로 몰리는지 로그에서 바로 보이게 한다.
  result.rewrites.forEach((r) => {
    console.log(`   ${r.section}: ${r.attempts}회${r.repaired ? ` · 부분 수리(${r.repaired})` : ''}`);
  });
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ 리포트 생성 실패:', e.message); process.exit(1); });
}

module.exports = { writeReport, writeSection, digestOf, userPrompt };
