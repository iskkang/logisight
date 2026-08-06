'use strict';
// generators/jp-report/write/write-report.js
// writer 단계 — 팩트시트 → 섹션별 초안 → 마크다운 리포트.
// 사용법: node generators/jp-report/write/write-report.js [--facts=경로] [--out=경로]
//
// 섹션마다 생성 직후 verifier(a)로 수치를 대조하고, 위반이 있으면 지적사항을 붙여
// 1회 재생성한다. 그래도 남으면 위반을 리포트에 기록해 다음 단계(verifier b·발행)가
// 판단하게 한다 — 조용히 통과시키지 않는다.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { callClaude, callClaudeJson } = require('../../lib/claude');
const { verifyNumbers } = require('../verify/numbers');
const { reviewSection, needsRewrite, buildIssueFeedback, splitBySeverity } = require('../verify/editorial');
const { generationOrder, outputOrder, slimFactsheet } = require('./sections');
const { checkHedges, hedgeFeedback } = require('../verify/hedges');
const { checkContinuity, continuityFeedback } = require('../verify/continuity');
const { checkJargon, jargonFeedback } = require('../verify/jargon');
const { checkCausation, causationFeedback } = require('../verify/causation');
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

function systemPrompt() {
  return [
    'あなたは日本の物流専門メディアの編集記者だ。荷主・フォワーダー向けの月次マーケットレポートを書く。',
    '以下の文体ガイドと SEO ガイドに従う。',
    '', '=== 文体ガイド ===', STYLE,
    '', '=== SEO ガイド ===', SEO,
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
    parts.push('', '【前回の指摘・数値】以下の数値はファクトシートに存在しない。書き直せ。',
      violations.map((v) => `- 「${v.raw}」 … ${v.context}`).join('\n'));
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
 * 호출이 없는 검사들. 하나라도 걸리면 그 자리에서 돌려준다.
 *
 * 한곳에 모아두는 이유: 저장분을 되쓸 때도 이것들은 전부 다시 돌려야 한다.
 * 검사기를 새로 추가했을 때, 예전에 통과한 본문이 그 검사를 건너뛰면 안 된다.
 */
function deterministicChecks(body, factsheet) {
  const numbers = verifyNumbers(body, factsheet);
  if (!numbers.ok) {
    return { label: `수치 위반 ${numbers.violations.length}건`, violations: numbers.violations };
  }
  const hedges = checkHedges(body);
  if (!hedges.ok) {
    return { label: `유보 문구 ${hedges.sentences.length}건(상한 ${hedges.cap})`, note: hedgeFeedback(hedges), slot: 'hedge' };
  }
  const continuity = checkContinuity(body);
  if (!continuity.ok) {
    return { label: `지속 표현 ${continuity.hits.length}건`, note: continuityFeedback(continuity), slot: 'phrase' };
  }
  const jargon = checkJargon(body);
  if (!jargon.ok) {
    return {
      label: `내부 명칭 노출 ${jargon.hits.length}건(${jargon.hits.map((h) => h.token).join(', ')})`,
      note: jargonFeedback(jargon), slot: 'jargon',
    };
  }
  const causation = checkCausation(body);
  if (!causation.ok) {
    return { label: `인과·비율 표현 ${causation.hits.length}건`, note: causationFeedback(causation), slot: 'cause' };
  }
  return null;
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
      violations = fail.violations || null;
      issues = null;
      hedgeNote = fail.slot === 'hedge' ? fail.note : null;
      phraseNote = fail.slot === 'phrase' ? fail.note : null;
      jargonNote = fail.slot === 'jargon' ? fail.note : null;
      causeNote = fail.slot === 'cause' ? fail.note : null;
      console.warn(`  ⚠️ ${section.id}: ${fail.label} — ${last ? '미해결로 기록' : '재생성'}`);
      if (!last) continue;
      // 마지막 시도에도 걸렸다. 통과시키지 않는다 — 저장도 하지 않는다.
      // 여기서 깨끗한 것으로 돌려주면 캐시에 들어가 다음 회차가 그대로 되쓴다.
      return {
        body,
        violations: fail.violations || [],
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
    const { body, violations, issues } = await writeSection(section, factsheet, digests);
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

  return { markdown, violations: allViolations, period, reused, total: generationOrder().length };
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
  console.log(`📝 일본 월간 리포트 생성 (${factsheet.generatedFor})${fresh ? ' — 저장분 버리고 전부 다시 씀' : ''}`);
  const { markdown, violations, period, reused, total } = await writeReport(factsheet, { fresh });

  if (violations.length > 0) {
    // 통과한 섹션은 저장돼 있다. 다음 실행은 막힌 섹션만 다시 쓴다.
    console.warn(`
⚠️ 미해결 ${violations.length}개 섹션 — 원고를 조합하지 않는다`);
    violations.forEach((v) => {
      v.violations.forEach((x) => console.warn(`   ${v.section} 수치: 「${x.raw}」 …${x.context}…`));
      v.issues.forEach((x) => console.warn(`   ${v.section} 편집(${x.type}): ${x.reason}`));
    });
    console.warn(`   통과 ${total - violations.length}/${total}개는 저장했다. 다시 실행하면 남은 것만 쓴다.`);
    console.warn(`   저장 위치: ${path.join(cache.ROOT, String(period))}`);
    process.exitCode = 2; // 발행 파이프라인이 이 코드를 보고 멈춘다(fail-closed)
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, 'utf8');
  console.log(`✅ ${outPath} (${markdown.length}자 · 저장분 재사용 ${reused}/${total})`);
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ 리포트 생성 실패:', e.message); process.exit(1); });
}

module.exports = { writeReport, writeSection, digestOf, userPrompt };
