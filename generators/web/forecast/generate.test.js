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
    maritime_news: [
      { title: '홍해 우회 지속, 아시아-유럽 항행거리 증가', summary: '수에즈 회피 장기화', published_at: todayMinus(2) },
    ],
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
      async insert(row) { captured.push(row); return { error: null }; },
      update(patch) { return { eq() { captured.push(patch); return Promise.resolve({ error: null }); } }; },
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

test('generateDrafts: persistent LLM mismatch → needs_editor drafts still upserted (not skipped)', async () => {
  const captured = [];
  // 항상 방향 불일치 → narrate가 needs_editor 반환. draft는 placeholder로 여전히 적재돼야 함.
  const badLLM = async () => JSON.stringify({ statement: '내린다', impact_note: 'x', direction_echo: 'down' });
  const res = await generateDrafts(fakeSupabase(captured), badLLM, { asof: new Date() });
  assert.equal(res.inserted, captured.length);
  assert.equal(res.needsEditor, captured.length); // 비-abstain 전부 에디터 필요
  assert.ok(captured.length >= 1);
  assert.equal(captured.every((r) => r.status === 'draft'), true);
  assert.equal(captured.every((r) => /검수/.test(r.statement) && r.impact_note === null), true);
});
