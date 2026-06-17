// generators/web/rates-brief/generate-rates-brief.js
'use strict';
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../../lib/deepseek');
const S = require('./lib/signals');
const { buildMessages } = require('./lib/prompt');

function isoWeekId(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstTh = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstTh.setUTCDate(firstTh.getUTCDate() - ((firstTh.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d - firstTh) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function indexSeries(sb, code) {
  // 프론트(rates.functions.ts)와 동일하게 전체 history를 사용 — 52주 백분위 산출이 프론트 폴백과 일치해야 함.
  const { data } = await sb.from('freight_indices')
    .select('week_date,value').eq('index_code', code)
    .order('week_date', { ascending: true }).limit(5000);
  return (data || []).filter((r) => r.value != null);
}

// 항공 시황 입력: IATA 권역별 화물 통계(캐시).
function readIata() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../outputs/cache/iata-cargo.json'), 'utf-8'));
  } catch { return null; }
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const [kcci, scfi, wci, vlsfo] = await Promise.all(
    ['KCCI', 'SCFI', 'WCI', 'VLSFO'].map((c) => indexSeries(sb, c)),
  );
  const asOf = kcci.at(-1)?.week_date ?? scfi.at(-1)?.week_date;
  if (!asOf) throw new Error('지수 데이터 없음');

  const ocean = S.computeOceanPressure(kcci, asOf);
  const global = S.computeGlobalMomentum(scfi, wci, asOf);
  const air = S.computeAirMarket(readIata(), asOf);
  const vlsfoMoM = S.momChange(vlsfo.map((p) => ({ k: p.week_date, value: p.value })));
  const bunker = S.computeBunker(vlsfoMoM, asOf);

  const signals = [ocean, global, air, bunker].filter(Boolean);
  if (!signals.length) throw new Error('신호 없음');

  const { system, messages } = buildMessages(signals, { asOf });
  const prose = await callDeepSeekJson({ system, messages, max_tokens: 1500 });

  const row = {
    week_id: isoWeekId(asOf),
    as_of: asOf,
    signals_json: signals,
    prose_json: prose,
    generated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('rates_brief').upsert(row, { onConflict: 'week_id' });
  if (error) throw new Error(error.message);
  console.log(`✅ rates_brief: ${row.week_id} (as_of ${asOf}) — ${signals.length}개 신호`);
}

main().catch((e) => { console.error('rates-brief 생성 실패:', e.message); process.exit(1); });
