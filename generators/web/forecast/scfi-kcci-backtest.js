'use strict';
// v1.4 백테스트: SCFI→KCCI 교차상관(선행 시차) 산정. b-3 보정 계수·선행 시차의 초기값(0.5/2주)을
// 실측으로 검증·보정하기 위한 분석 스크립트. 읽기 전용(DB 쓰기 없음).
// 실행: node generators/web/forecast/scfi-kcci-backtest.js
const path = require('path');

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy; dx += vx * vx; dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000;
}

// scfiChg/kcciChg: 시간 오름차순 WoW% 배열. lag>0 = SCFI가 KCCI를 lag주 선행.
function leadLagScan(scfiChg, kcciChg, maxLag = 6) {
  const res = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    const a = scfiChg.slice(0, scfiChg.length - lag);
    const b = kcciChg.slice(lag);
    res.push({ lag, corr: pearson(a, b), n: Math.min(a.length, b.length) });
  }
  return res;
}

// WoW% (시간 오름차순 value 배열에서)
function wowSeries(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i - 1] ? Math.round(((values[i] - values[i - 1]) / values[i - 1]) * 1000) / 10 : null);
  }
  return out.filter((v) => v != null);
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const read = async (code) => {
    // 최근 60주(descending) 후 시간 오름차순으로 뒤집어 반환 — ascending limit은 오래된 주를 집어 정합 실패.
    const { data } = await sb.from('freight_indices').select('value,week_date').eq('index_code', code).order('week_date', { ascending: false }).limit(60);
    return (data || []).filter((r) => r.value != null).reverse();
  };
  const [scfi, kcci] = await Promise.all([read('SCFI'), read('KCCI')]);
  // 공통 week_date로 정렬·정합
  const kMap = new Map(kcci.map((r) => [r.week_date, r.value]));
  const aligned = scfi.filter((r) => kMap.has(r.week_date)).map((r) => ({ date: r.week_date, scfi: r.value, kcci: kMap.get(r.week_date) }));
  console.log(`정합 주차 ${aligned.length}개 (${aligned[0] ? aligned[0].date : '-'} ~ ${aligned.length ? aligned[aligned.length - 1].date : '-'})`);
  const scfiChg = wowSeries(aligned.map((r) => r.scfi));
  const kcciChg = wowSeries(aligned.map((r) => r.kcci));
  const scan = leadLagScan(scfiChg, kcciChg, 6);
  console.log('SCFI→KCCI 교차상관(lag주 / corr / n):');
  scan.forEach((s) => console.log(`  lag ${s.lag}주: corr=${s.corr ?? 'n/a'} (n=${s.n})`));
  const best = scan.filter((s) => s.corr != null).sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))[0];
  if (best) console.log(`→ 최대 상관 시차: ${best.lag}주 (corr=${best.corr}). 표본 적으면 잠정값.`);
  console.log('주의: 표본이 적으면(< ~20주) 선행 시차는 잠정 — 누적 후 재산정.');
}

if (require.main === module) main().catch((e) => { console.error('backtest 실패:', e.message); process.exit(1); });

module.exports = { pearson, leadLagScan, wowSeries };
