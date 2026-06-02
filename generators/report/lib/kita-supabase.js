'use strict';
// KITA 운임 데이터 → Supabase upsert
// 테이블: kita_sea_rates, kita_sea_indices, kita_air_rates, kita_air_indices
// upsert 키: (origin, dest, year_mon) / year_mon (중복 실행 안전)

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

function getClient() {
  const { createClient } = require('@supabase/supabase-js');
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(url, key, { auth: { persistSession: false } });
}

// conflictCol(콤마구분) 기준으로 행을 dedup — 마지막 값 우선.
// ON CONFLICT는 한 배치에서 같은 키를 두 번 못 건드리므로 upsert 전 필수.
function dedupRows(rows, conflictCol) {
  var keys = conflictCol.split(',').map(function(c) { return c.trim(); });
  var map  = {};
  for (var i = 0; i < rows.length; i++) {
    var k = keys.map(function(c) { return rows[i][c]; }).join('|');
    map[k] = rows[i];
  }
  return Object.values(map);
}

async function batchUpsert(sb, table, rows, conflictCol) {
  if (!rows.length) return 0;
  rows = dedupRows(rows, conflictCol);
  const BATCH = 100;
  var total = 0;
  for (var i = 0; i < rows.length; i += BATCH) {
    var chunk = rows.slice(i, i + BATCH);
    var res   = await sb.from(table).upsert(chunk, { onConflict: conflictCol });
    if (res.error) throw new Error(table + ' upsert 오류: ' + res.error.message);
    total += chunk.length;
  }
  return total;
}

// ── 해상 ─────────────────────────────────────────────────────────────────────

async function pushSeaToSupabase(payload) {
  if (!payload?.routes?.length) return { rates: 0, indices: 0 };
  var sb  = getClient();
  var now = new Date().toISOString();

  var rateRows  = [];
  var indexMap  = {};   // yearMon → row (여러 노선에서 같은 지수가 오므로 dedup)

  for (var ri = 0; ri < payload.routes.length; ri++) {
    var route = payload.routes[ri];
    if (route.error) continue;

    for (var r = 0; r < (route.rates || []).length; r++) {
      var rate = route.rates[r];
      rateRows.push({
        origin:     route.originName,
        dest:       route.destName,
        region:     route.regionName,
        year_mon:   rate.yearMon,
        teu:        rate.teu     != null ? rate.teu     : null,
        feu:        rate.feu     != null ? rate.feu     : null,
        teu_chg:    rate.teuChg  != null ? rate.teuChg  : null,
        feu_chg:    rate.feuChg  != null ? rate.feuChg  : null,
        fetched_at: now,
      });
    }

    for (var ii = 0; ii < (route.indices || []).length; ii++) {
      var idx = route.indices[ii];
      indexMap[idx.yearMon] = {
        year_mon:   idx.yearMon,
        radis:      idx.radis      != null ? idx.radis      : null,
        na_index:   idx.naIndex    != null ? idx.naIndex    : null,
        eu_index:   idx.euIndex    != null ? idx.euIndex    : null,
        asia_index: idx.asiaIndex  != null ? idx.asiaIndex  : null,
        fetched_at: now,
      };
    }
  }

  var indexRows = Object.values(indexMap);
  var r1 = await batchUpsert(sb, 'kita_sea_rates',   rateRows,  'origin,dest,year_mon');
  var r2 = await batchUpsert(sb, 'kita_sea_indices',  indexRows, 'year_mon');
  return { rates: r1, indices: r2 };
}

// ── 항공 ─────────────────────────────────────────────────────────────────────

async function pushAirToSupabase(payload) {
  if (!payload?.routes?.length) return { rates: 0, indices: 0 };
  var sb  = getClient();
  var now = new Date().toISOString();

  var rateRows = [];
  var indexMap = {};

  for (var ri = 0; ri < payload.routes.length; ri++) {
    var route = payload.routes[ri];
    if (route.error) continue;

    for (var r = 0; r < (route.rates || []).length; r++) {
      var rate = route.rates[r];
      rateRows.push({
        origin:     route.originName,
        dest:       route.destName,
        region:     route.regionName,
        year_mon:   rate.yearMon,
        kg100:      rate.kg100  != null ? rate.kg100  : null,
        kg300:      rate.kg300  != null ? rate.kg300  : null,
        kg500:      rate.kg500  != null ? rate.kg500  : null,
        chg100:     rate.chg100 != null ? rate.chg100 : null,
        chg300:     rate.chg300 != null ? rate.chg300 : null,
        chg500:     rate.chg500 != null ? rate.chg500 : null,
        fetched_at: now,
      });
    }

    for (var ii = 0; ii < (route.indices || []).length; ii++) {
      var idx = route.indices[ii];
      indexMap[idx.yearMon] = {
        year_mon:   idx.yearMon,
        na_index:   idx.naIndex    != null ? idx.naIndex    : null,
        eu_index:   idx.euIndex    != null ? idx.euIndex    : null,
        asia_index: idx.asiaIndex  != null ? idx.asiaIndex  : null,
        cn_index:   idx.cnIndex    != null ? idx.cnIndex    : null,
        fetched_at: now,
      };
    }
  }

  var indexRows = Object.values(indexMap);
  var r1 = await batchUpsert(sb, 'kita_air_rates',   rateRows,  'origin,dest,year_mon');
  var r2 = await batchUpsert(sb, 'kita_air_indices',  indexRows, 'year_mon');
  return { rates: r1, indices: r2 };
}

module.exports = { pushSeaToSupabase, pushAirToSupabase };
