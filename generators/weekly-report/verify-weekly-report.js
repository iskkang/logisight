'use strict';
// generators/weekly-report/verify-weekly-report.js
// 주간 리포트 초안을 기계 린트로 심사하고, critical 이 있으면 exit 1 한다.
//
// 사용법:
//   node generators/weekly-report/verify-weekly-report.js --week=2026-W32
//   node generators/weekly-report/verify-weekly-report.js --file=content/weekly-region/xxx.md
//
// ■ 왜 만들었나
// 주간·권역 리포트는 발행 전에 아무 검사도 거치지 않았다. approve-weekly-report.js 의
// 「승인」은 status 를 draft → approved 로 바꾸는 것뿐이고, 수치를 보지 않는다.
// 월간은 verify-report.js 가 막고 있었는데(그것도 발행 뒤에 부르고 있었지만),
// 주간에는 그 자리가 비어 있었다.
//
// ■ 월간과 다른 점 — 기계 린트만 한다
// 월간의 Claude 적대적 교차검증은 붙이지 않는다. 그쪽은 월간 경로(forecasts.json·
// editor-brief·스타일 문서)에 묶여 있고, 주간은 발행 빈도가 4배라 매번 부르면
// 비용과 대기가 커진다. 기계 린트만으로도 「표에 없는 수치를 본문이 말한다」는
// 가장 흔한 유형은 잡힌다. 필요해지면 그때 교차검증을 얹는다.
//
// ■ 무엇을 "주입 수치"로 보는가
// 월간과 같은 규칙이다 —— 표 라인(| … |)에 있는 숫자는 근거가 있는 것으로 본다.
// 본문 산문에만 나오고 표에 없는 숫자가 number-mismatch 로 걸린다.
//
// ■ formal-ending 은 적용하지 않는다 ★
// 그 규칙은 월간 리포트의 문체 규정(스타일 가이드 §2)이다. 경어체뿐 아니라
// 평서문 종결(~했다. ~한다. ~됐다.)까지 금지한다. 그런데 주간 리포트는 KSG
// 기사 문체라 그 어미가 정상이다.
//
// 실측(2026-08-14): 주간 초안 3개에 formal-ending 이 162건 걸렸고, 문장을 보면
// 전부 정상적인 기사 문장이었다. 이걸 게이트로 두면 매주 발행이 막힌다.
// 나머지 규칙(forbidden-arrow·ops-leak·flat-with-arrow·calque·inconsistent-name)은
// 같은 3개 초안에서 0건이었다 —— 문체와 무관한 진짜 사고만 잡는다는 뜻이다.
//
// 월간까지 이 규칙을 빼지는 않는다. 거기서는 유효한 규정이다.

const fs = require('fs');
const path = require('path');

const { lintReport, extractNumbers } = require('../report/lib/report-lint');

const ROOT = path.resolve(__dirname, '../..');

/** 월간 전용 문체 규칙. 주간에 걸면 정상 기사 문장이 전부 걸린다(위 주석 참조). */
const RULES_NOT_FOR_WEEKLY = new Set(['formal-ending']);

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

/** 표 라인의 숫자를 근거 있는 수치로 모은다(월간 verify-report.js 와 같은 규칙). */
function collectInjectedNumbers(md) {
  const nums = [];
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('|')) nums.push(...extractNumbers(line));
  }
  return nums;
}

/**
 * 권역 리포트는 마크다운이 아니라 JSON 이다(content/weekly-region-deep/*.json).
 * 린터는 산문을 보는 도구이므로, 문자열 잎만 모아 한 덩이로 만들어 넘긴다.
 *
 * 근거 수치는 indices 에서 뽑는다 —— 마크다운의 "표 라인"에 해당하는 자리다.
 * 산문(summary·issues[].lead)에만 나오고 indices 에 없는 숫자가 걸리게 된다.
 */
function fromJson(obj) {
  const prose = [];
  const walk = (v) => {
    if (typeof v === 'string') prose.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk({ ...obj, indices: undefined }); // 지표 블록은 근거 쪽이지 산문이 아니다
  const injected = obj.indices ? extractNumbers(JSON.stringify(obj.indices)) : [];
  return { text: prose.join('\n'), injected };
}

function resolveTarget() {
  const file = arg('file');
  if (file) return path.resolve(ROOT, file);
  const week = arg('week');
  if (!week) {
    console.error('ERROR: --week=YYYY-Www 또는 --file=경로 가 필요하다');
    process.exit(2);
  }
  return path.join(ROOT, 'content/weekly-report', `${week}.md`);
}

function main() {
  const target = resolveTarget();
  if (!fs.existsSync(target)) {
    // 초안이 없는 것과 초안이 틀린 것은 다른 문제다. 종료 코드를 나눠 둔다 —
    // 2 는 "볼 것이 없다", 1 은 "봤는데 문제가 있다".
    console.error(`ERROR: 초안 없음: ${path.relative(ROOT, target)}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(target, 'utf-8');
  let text = raw;
  let injected;
  if (target.endsWith('.json')) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      console.error(`ERROR: JSON 파싱 실패: ${e.message}`);
      process.exit(2);
    }
    ({ text, injected } = fromJson(obj));
  } else {
    injected = collectInjectedNumbers(raw);
  }
  const all = lintReport(text, injected).findings;
  const findings = all.filter((f) => !RULES_NOT_FOR_WEEKLY.has(f.rule));
  const skipped = all.length - findings.length;

  const critical = findings.filter((f) => f.severity === 'critical');
  const warn = findings.filter((f) => f.severity !== 'critical');

  console.log(`📄 ${path.relative(ROOT, target)}`);
  console.log(`   critical: ${critical.length} | warn: ${warn.length}`);
  // 뺀 건수를 숨기지 않는다. 조용히 제외하면 "검사했다"와 "안 봤다"가 같아진다.
  if (skipped > 0) {
    console.log(`   (월간 전용 규칙 ${[...RULES_NOT_FOR_WEEKLY].join('·')} ${skipped}건 제외)`);
  }

  for (const f of critical) console.log(`   🔴 [${f.rule}] ${f.excerpt}`);
  // warn 은 접어서 보여준다. 전부 찍으면 critical 이 묻힌다.
  for (const f of warn.slice(0, 10)) console.log(`   🟡 [${f.rule}] ${f.excerpt}`);
  if (warn.length > 10) console.log(`   … warn ${warn.length - 10}건 더`);

  if (critical.length > 0) {
    console.log('❌ 발행 보류 — critical 을 고친 뒤 다시 실행할 것');
    process.exit(1);
  }
  console.log('✅ 발행 가능');
}

if (require.main === module) main();

module.exports = { collectInjectedNumbers };
