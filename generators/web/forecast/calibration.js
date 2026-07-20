'use strict';
// 읽기 전용 calibration 분석: status='resolved' 전망 → metric_ref별 통계 출력.
// 실행: node generators/web/forecast/calibration.js
const path = require('path');

// ─────────────────── 순수 함수 ───────────────────

/** 방향 적중률 = (hit + partial×0.5) / n */
function directionAccuracy(rows) {
  if (!rows.length) return null;
  const score = rows.reduce((s, r) => {
    if (r.outcome === 'hit') return s + 1;
    if (r.outcome === 'partial') return s + 0.5;
    return s;
  }, 0);
  return Math.round((score / rows.length) * 1000) / 1000;
}

/**
 * 예측 midpoint 대비 realized_pct 편차.
 * bias = mean(realized_pct - midpoint), MAE = mean(|realized_pct - midpoint|).
 * range 없는 행(flat 등)은 제외.
 */
function biasAndMae(rows) {
  const valid = rows.filter(
    (r) => r.range_low_pct != null && r.range_high_pct != null && r.realized_pct != null,
  );
  if (!valid.length) return { bias: null, mae: null, n: 0 };
  let sumBias = 0;
  let sumAbs = 0;
  for (const r of valid) {
    const mid = (r.range_low_pct + r.range_high_pct) / 2;
    const diff = r.realized_pct - mid;
    sumBias += diff;
    sumAbs += Math.abs(diff);
  }
  return {
    bias: Math.round((sumBias / valid.length) * 100) / 100,
    mae: Math.round((sumAbs / valid.length) * 100) / 100,
    n: valid.length,
  };
}

/**
 * range 커버리지: realized_pct ∈ [range_low_pct, range_high_pct] 인 비율.
 * range 없는 행 제외.
 */
function rangeCoverage(rows) {
  const valid = rows.filter(
    (r) => r.range_low_pct != null && r.range_high_pct != null && r.realized_pct != null,
  );
  if (!valid.length) return null;
  const covered = valid.filter(
    (r) => r.realized_pct >= r.range_low_pct && r.realized_pct <= r.range_high_pct,
  ).length;
  return Math.round((covered / valid.length) * 1000) / 1000;
}

/**
 * factor_scores 기여 부호와 realized_pct 부호의 정합률.
 * factor_scores: [{factor, score, weight, missing}]. missing 팩터 제외.
 * sign(score × weight) vs sign(realized_pct) 비교.
 */
function factorSignAlignment(rows) {
  const valid = rows.filter((r) => r.realized_pct != null && Array.isArray(r.factor_scores));
  if (!valid.length) return null;
  let total = 0;
  let match = 0;
  for (const r of valid) {
    const rSign = Math.sign(r.realized_pct);
    for (const f of r.factor_scores) {
      if (f.missing || f.score == null) continue;
      total++;
      const contribSign = Math.sign(f.score * f.weight);
      if (contribSign === rSign || (contribSign === 0 && rSign === 0)) match++;
    }
  }
  if (!total) return null;
  return Math.round((match / total) * 1000) / 1000;
}

/** metric_ref별 집계. rows: status='resolved' 전망 배열. */
function aggregateByMetric(rows) {
  const groups = {};
  for (const r of rows) {
    const key = r.metric_ref || 'unknown';
    (groups[key] = groups[key] || []).push(r);
  }
  const result = {};
  for (const [metric, group] of Object.entries(groups)) {
    const bm = biasAndMae(group);
    result[metric] = {
      n: group.length,
      directionAccuracy: directionAccuracy(group),
      bias: bm.bias,
      mae: bm.mae,
      rangeCoverage: rangeCoverage(group),
      factorSignAlignment: factorSignAlignment(group),
    };
  }
  return result;
}

// ─────────────────── 출력 ───────────────────

function pct(v) { return v != null ? `${(v * 100).toFixed(1)}%` : 'n/a'; }
function num(v, sign) {
  if (v == null) return 'n/a';
  return sign && v > 0 ? `+${v}` : String(v);
}

function printTable(stats) {
  const metrics = Object.keys(stats);
  if (!metrics.length) { console.log('(결과 없음)'); return; }
  const header = ['metric', 'n', '방향 적중률', 'bias(%p)', 'MAE(%p)', 'range 커버리지', 'factor 정합률'];
  const rows = metrics.map((m) => {
    const s = stats[m];
    return [m, String(s.n), pct(s.directionAccuracy), num(s.bias, true), num(s.mae, false), pct(s.rangeCoverage), pct(s.factorSignAlignment)];
  });
  const allRows = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...allRows.map((r) => (r[i] || '').length)));
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  console.log(allRows[0].map((h, i) => h.padEnd(widths[i])).join(' | '));
  console.log(sep);
  for (const row of allRows.slice(1)) {
    console.log(row.map((v, i) => v.padEnd(widths[i])).join(' | '));
  }
}

// ─────────────────── main ───────────────────

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE 환경변수 없음 (.env.local에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요)');
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('forecasts')
    .select('metric_ref,direction,range_low_pct,range_high_pct,composite_score,factor_scores,metric_value_at_publish,outcome,realized_pct,published_at,horizon_date,resolved_at')
    .eq('status', 'resolved')
    .order('resolved_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data || [];
  console.log(`\n판정 완료 전망 ${rows.length}건 (status=resolved)`);
  if (!rows.length) {
    console.log('표본 없음 — Phase 1 자동 발행 후 horizon이 도래해야 데이터가 쌓입니다.');
    return;
  }
  const stats = aggregateByMetric(rows);
  console.log('\n[metric_ref별 calibration 통계]\n');
  printTable(stats);
  console.log('\n주의: 표본이 적으면(< 20건) 통계는 잠정값 — 누적 후 재산정.');
}

if (require.main === module) main().catch((e) => { console.error('calibration 실패:', e.message); process.exit(1); });

module.exports = { directionAccuracy, biasAndMae, rangeCoverage, factorSignAlignment, aggregateByMetric };
