'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateDrafts } = require('./generate');

function todayMinus(d) { return new Date(Date.now() - d * 86400000).toISOString().slice(0, 10); }

// 최소 가짜 supabase. 빌더는 `await builder.limit(...)`와 `await builder` 둘 다 지원.
function fakeSupabase(captured) {
  const data = {
    freight_indices: [
      { index_code: 'KCCI', value: 1200, change_pct: 4, week_date: todayMinus(2) },
      { index_code: 'KCCI', value: 1150, change_pct: 3, week_date: todayMinus(9) },
      { index_code: 'KCCI', value: 1110, change_pct: 2, week_date: todayMinus(16) },
      { index_code: 'SCFI', value: 1000, change_pct: 1, week_date: todayMinus(2) },
    ],
    blank_sailings: [
      { region: 'East Asia', blank_pct: 12, week_start: todayMinus(3) },
      { region: 'East Asia', blank_pct: 8, week_start: todayMinus(10) },
    ],
    bunker_prices: [
      { grade: 'VLSFO', port: 'Singapore', price_usd: 600, obs_date: todayMinus(1) },
      { grade: 'VLSFO', port: 'Singapore', price_usd: 550, obs_date: todayMinus(30) },
    ],
    trade_statistics: [], policies: [], kita_sea_rates: [],
  };
  function from(table) {
    let rows = (data[table] || []).slice();
    const api = {
      select() { return api; },
      eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
      gte(col, val) { rows = rows.filter((r) => String(r[col]) >= String(val)); return api; },
      order() { return api; },
      limit() { return Promise.resolve({ data: rows }); },
      then(res, rej) { return Promise.resolve({ data: rows }).then(res, rej); }, // await builder 지원
      async upsert(row) { captured.push(row); return { error: null }; },
    };
    return api;
  }
  return { from };
}

test('generateDrafts: scores targets and upserts drafts (fake LLM/DB)', async () => {
  const captured = [];
  const fakeLLM = async () => JSON.stringify({
    statement: '상승 가능성이 높은 것으로 추정된다.', impact_note: 'FEU 비용 상승 → 부킹 검토.', direction_echo: 'up',
  });
  const res = await generateDrafts(fakeSupabase(captured), fakeLLM, { asof: new Date() });
  assert.equal(res.total >= 2, true);
  assert.equal(captured.length, res.inserted);
  assert.equal(captured.every((r) => r.status === 'draft'), true);
  assert.equal(captured.every((r) => r.model_version === 'v1.1'), true);
});
