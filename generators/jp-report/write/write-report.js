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

const { callClaude } = require('../../lib/claude');
const { verifyNumbers } = require('../verify/numbers');
const { generationOrder, outputOrder, slimFactsheet } = require('./sections');
const { normalizeHeading } = require('./heading');

const STYLE = fs.readFileSync(path.join(__dirname, 'STYLE.ja.md'), 'utf8');
const SEO = fs.readFileSync(path.join(__dirname, 'SEO.ja.md'), 'utf8');

/** thinking이 예산을 잠식해 본문이 비는 일이 있어 넉넉히 잡는다. */
const MAX_TOKENS = 16000;
// 모델이 합산·차분을 반복해서 시도한다. 실측상 재시도마다 위반이 줄어들어 2회까지 준다.
const MAX_RETRY = 2;

function systemPrompt() {
  return [
    'あなたは日本の物流専門メディアの編集記者だ。荷主・フォワーダー向けの月次マーケットレポートを書く。',
    '以下の文体ガイドと SEO ガイドに従う。',
    '', '=== 文体ガイド ===', STYLE,
    '', '=== SEO ガイド ===', SEO,
  ].join('\n');
}

function userPrompt(section, slim, digests, violations) {
  const parts = [
    `セクション「${section.no}. ${section.title}」の本文を書け。`,
    '',
    '【このセクションの狙い】',
    section.focus,
    '',
    '【ファクトシート】単位: 金額=千円, 運賃=指数(2020年=100), 港湾=TEU',
    JSON.stringify(slim),
  ];
  if (digests.length > 0) {
    parts.push('', '【他セクションの要旨】これらが確定した事実である。新たな数値を持ち込まない。',
      digests.map((d) => `- ${d.title}: ${d.digest}`).join('\n'));
  }
  if (violations && violations.length > 0) {
    parts.push('', '【前回の指摘】以下の数値はファクトシートに存在しない。書き直せ。',
      violations.map((v) => `- 「${v.raw}」 … ${v.context}`).join('\n'));
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

async function writeSection(section, factsheet, digests) {
  const slim = slimFactsheet(factsheet, section.id);
  let violations = null;
  let body = '';

  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    const res = await callClaude({
      max_tokens: MAX_TOKENS,
      system: systemPrompt(),
      messages: [{ role: 'user', content: userPrompt(section, slim, digests, violations) }],
    });
    body = textOf(res);
    if (!body) throw new Error(`${section.id}: 본문이 비었다 (thinking이 예산을 소진했을 수 있다)`);

    const check = verifyNumbers(body, factsheet);
    if (check.ok) return { body, violations: [], attempts: attempt + 1 };
    violations = check.violations;
    console.warn(`  ⚠️ ${section.id}: 수치 위반 ${violations.length}건 — ${attempt < MAX_RETRY ? '재생성' : '기록 후 통과'}`);
  }
  return { body, violations, attempts: MAX_RETRY + 1 };
}

async function writeReport(factsheet) {
  const digests = [];
  const bodies = new Map();
  const allViolations = [];

  for (const section of generationOrder()) {
    console.log(`  ▸ ${section.no}. ${section.title}`);
    const { body, violations } = await writeSection(section, factsheet, digests);
    // 재생성된 섹션이 제목 번호를 잃는 일이 있다. 출력 순서·목차가 번호에 의존한다.
    bodies.set(section.id, normalizeHeading(body, section));
    if (violations.length > 0) allViolations.push({ section: section.id, violations });
    // 총론은 요지를 소비하는 쪽이므로 자신의 요지는 넘기지 않는다.
    if (!section.generateLast) digests.push({ title: section.title, digest: digestOf(body) });
  }

  const markdown = outputOrder()
    .map((s) => bodies.get(s.id))
    .filter(Boolean)
    .join('\n\n---\n\n');

  return { markdown, violations: allViolations, period: factsheet.generatedFor };
}

async function main() {
  const arg = (name, fallback) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=').slice(1).join('=') : fallback;
  };
  const factsPath = arg('facts', path.resolve(__dirname, '../../../content/drafts/jp-factsheet.json'));
  const factsheet = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
  const outPath = arg('out', path.resolve(__dirname, `../../../content/drafts/jp-report-${factsheet.generatedFor}.md`));

  console.log(`📝 일본 월간 리포트 생성 (${factsheet.generatedFor})`);
  const { markdown, violations } = await writeReport(factsheet);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, 'utf8');
  console.log(`✅ ${outPath} (${markdown.length}자)`);

  if (violations.length > 0) {
    console.warn(`⚠️ 수치 위반이 남은 섹션 ${violations.length}개 — verifier 단계에서 판정 필요`);
    violations.forEach((v) => v.violations.forEach((x) => console.warn(`   ${v.section}: 「${x.raw}」 …${x.context}…`)));
    process.exitCode = 2; // 발행 파이프라인이 이 코드를 보고 멈춘다
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ 리포트 생성 실패:', e.message); process.exit(1); });
}

module.exports = { writeReport, writeSection, digestOf };
