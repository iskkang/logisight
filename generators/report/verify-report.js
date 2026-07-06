'use strict';
// generators/report/verify-report.js
// Task 5: 최종 검증기 — 발행 직전 QA 게이트.
// 조립본(monthly-analysis-<month>.md)을 기계 린트(report-lint) + Claude 적대적 교차검증으로 심사하고
// content/monthly-report/<month>/qa-report.md 를 작성한다.
// 사용법: node generators/report/verify-report.js --month=YYYY-MM
// exit 0 = critical 0(clean/warn) | exit 1 = critical ≥1 | exit 2 = 조립본 없음

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const { resolveMonth } = require('./lib/report-month');
const { lintReport, extractNumbers } = require('./lib/report-lint');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const MONTH          = resolveMonth(process.argv.slice(2), new Date());
const DRAFT_PATH     = path.resolve(__dirname, `../../content/drafts/monthly-analysis-${MONTH}.md`);
const OUT_DIR        = path.resolve(__dirname, `../../content/monthly-report/${MONTH}`);
const QA_PATH        = path.join(OUT_DIR, 'qa-report.md');
const FORECASTS_PATH = path.join(OUT_DIR, 'forecasts.json');
const STYLE_PATH     = path.resolve(__dirname, 'MONTHLY_REPORT_STYLE.md');

function loadDraft() {
  if (!fs.existsSync(DRAFT_PATH)) {
    console.error(`ERROR: 조립본 없음: ${DRAFT_PATH}`);
    console.error(`먼저 실행하세요: node generators/report/assemble-monthly-report.js --month=${MONTH}`);
    process.exit(2);
  }
  return fs.readFileSync(DRAFT_PATH, 'utf-8');
}

// 표 라인(|...|) + forecasts.json 안의 모든 숫자를 "주입 수치"로 수집.
function collectInjectedNumbers(md) {
  const nums = [];
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('|')) nums.push(...extractNumbers(line));
  }
  if (fs.existsSync(FORECASTS_PATH)) {
    try {
      const claims = JSON.parse(fs.readFileSync(FORECASTS_PATH, 'utf-8'));
      nums.push(...extractNumbers(JSON.stringify(claims)));
    } catch (e) {
      console.warn('⚠️  forecasts.json 파싱 실패(무시) —', e.message);
    }
  }
  return nums;
}

// 파생 지표(스프레드·계약-스팟 갭·KITA 갭) factText — 생성 시 프롬프트에 주입됐지만 최종 문서
// 표에는 없음. 본문이 인용한 '4주 전 스프레드' 등을 창작으로 오판하지 않도록 검증 근거로 재계산.
async function loadDerivedGrounding(month) {
  try {
    const { prevMonthOf, monthEndISO } = require('./lib/report-month');
    const { buildDerivedMetrics, loadKitaLanes } = require('./lib/derived-metrics-loader');
    const weekEnd = monthEndISO(prevMonthOf(month));
    let congestion = null;
    try { congestion = await require('./lib/port-congestion').buildPortCongestion(); } catch (_) {}
    const d = await buildDerivedMetrics({ weekEnd, kitaSea: loadKitaLanes(), congestion });
    const texts = [d.spreadBlock, d.gapBlock, d.kitaGapBlock].filter(Boolean).map(b => b.factText);
    if (d.congestionSignalText) texts.push(d.congestionSignalText);
    return texts.length ? texts.join('\n\n') : null;
  } catch (e) {
    console.warn('⚠️  파생 지표 근거 재계산 실패(무시) —', e.message);
    return null;
  }
}

// MONTHLY_REPORT_STYLE.md에서 "## ★ 품질 계약" 섹션만 추출(다음 "---" 전까지).
function loadQualityContract() {
  const content = fs.readFileSync(STYLE_PATH, 'utf-8').replace(/\r\n/g, '\n');
  const m = content.match(/## ★ 품질 계약[\s\S]*?(?=\n---\n)/);
  return m ? m[0].trim() : '';
}

function buildAdversarialSystemPrompt(qualityContract) {
  return `${qualityContract}

---

너는 이 리포트를 발행 전 마지막으로 심문하는 적대적 검증자다. 본문 주장 중 (1) 문서 내 표·수치와 모순 (2) 계약 12조 위반 (3) 근거 없이 단정된 사실을 찾아라.

findings JSON만 출력: [{"severity":"critical"|"warn","rule":"...","claim":"...","why":"..."}]
발견 사항이 없으면 빈 배열 []만 출력하라. JSON 외 설명·코드펜스·서두 문구 없이 출력하라.`;
}

// 코드펜스 스트립 + robust JSON parse. 파싱 실패 시 null(호출부에서 LLM 실패로 취급).
function parseFindingsJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

async function runAdversarialCheck(draftMd, derivedGrounding) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const system = buildAdversarialSystemPrompt(loadQualityContract());
  const userContent = derivedGrounding
    ? `${draftMd}\n\n---\n\n[시스템 주입 근거 데이터 — 문서 표에는 없지만 생성 시 주입된 실측값. 본문이 이 수치를 인용한 것은 창작이 아님]\n\n${derivedGrounding}`
    : draftMd;
  // max_tokens 16000: claude-sonnet-5는 기본적으로 extended thinking을 쓰며, 이 리포트 전문(500줄+) 분량을
  // 검증하는 thinking 자체가 수천 토큰을 소모함. 4000으로는 thinking만으로 예산이 소진되어 최종 텍스트가
  // 비는 현상을 실측 확인(교신 실험) — 16000으로 상향해 실제 findings 출력을 확보.
  const res = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: userContent }],
  });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return parseFindingsJson(text);
}

function countBySeverity(findings, severity) {
  return (findings || []).filter(f => f.severity === severity).length;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildQaReport({ month, generatedAt, model, lintFindings, llmFindings, llmNote }) {
  const criticalCount = countBySeverity(lintFindings, 'critical') + countBySeverity(llmFindings, 'critical');
  const warnCount     = countBySeverity(lintFindings, 'warn')     + countBySeverity(llmFindings, 'warn');
  const verdict = criticalCount > 0
    ? '❌ 발행 보류 — critical 발견'
    : (warnCount > 0 ? '⚠️ 발행 가능 — warn 확인 권고' : '✅ 발행 가능 — clean');

  const lines = [];
  lines.push(`# QA 리포트 — ${month}`);
  lines.push('');
  lines.push(`- 검증 시각: ${generatedAt}`);
  lines.push(`- 검증 모델: ${model}`);
  lines.push('');
  lines.push('## 요약');
  lines.push(`- critical: ${criticalCount}`);
  lines.push(`- warn: ${warnCount}`);
  lines.push(`- 판정: ${verdict}`);
  lines.push('');
  lines.push(`## 기계 린트 findings (${lintFindings.length}건)`);
  if (lintFindings.length) {
    lines.push('| 규칙 | 심각도 | 발췌 |');
    lines.push('|---|---|---|');
    for (const f of lintFindings) lines.push(`| ${esc(f.rule)} | ${esc(f.severity)} | ${esc(f.excerpt)} |`);
  } else {
    lines.push('없음');
  }
  lines.push('');
  lines.push(`## LLM 교차검증 findings (${(llmFindings || []).length}건)`);
  if (llmNote) {
    lines.push(llmNote);
  } else if ((llmFindings || []).length) {
    lines.push('| 규칙 | 심각도 | 주장(발췌) | 사유 |');
    lines.push('|---|---|---|---|');
    for (const f of llmFindings) {
      lines.push(`| ${esc(f.rule)} | ${esc(f.severity)} | ${esc(f.claim)} | ${esc(f.why)} |`);
    }
  } else {
    lines.push('없음');
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const draftMd = loadDraft();
  const derivedGrounding = await loadDerivedGrounding(MONTH);
  const injectedNumbers = collectInjectedNumbers(draftMd);
  if (derivedGrounding) injectedNumbers.push(...extractNumbers(derivedGrounding));
  const { findings: lintFindings } = lintReport(draftMd, injectedNumbers);

  let llmFindings = [];
  let llmNote = null;
  let model = '기계 린트만(LLM 미실행)';

  if (!ANTHROPIC_KEY) {
    llmNote = '_LLM 검증 생략(키 없음) — 기계 린트 결과만으로 판정._';
    console.warn('⚠️  ANTHROPIC_API_KEY 없음 — 기계 린트만 수행');
  } else {
    model = 'claude-sonnet-5';
    try {
      const result = await runAdversarialCheck(draftMd, derivedGrounding);
      if (result === null) {
        llmNote = '_LLM 검증 실패(응답 파싱 불가) — 기계 린트 결과만으로 판정._';
        console.warn('⚠️  LLM findings 파싱 실패 — 기계 린트만으로 판정');
      } else {
        llmFindings = result;
      }
    } catch (e) {
      llmNote = `_LLM 검증 실패(${e.message}) — 기계 린트 결과만으로 판정._`;
      console.warn('⚠️  LLM 호출 실패 —', e.message);
    }
  }

  const generatedAt = new Date().toISOString();
  const report = buildQaReport({ month: MONTH, generatedAt, model, lintFindings, llmFindings, llmNote });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(QA_PATH, report, 'utf-8');

  const criticalTotal = countBySeverity(lintFindings, 'critical') + countBySeverity(llmFindings, 'critical');
  const warnTotal     = countBySeverity(lintFindings, 'warn')     + countBySeverity(llmFindings, 'warn');

  console.log(`\n📋 QA 리포트 작성: ${QA_PATH}`);
  console.log(`   critical: ${criticalTotal} | warn: ${warnTotal}`);
  console.log(criticalTotal > 0 ? '❌ 발행 보류' : '✅ 발행 가능');

  process.exit(criticalTotal > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ verify-report.js 실패:', err.message);
  process.exit(1);
});
