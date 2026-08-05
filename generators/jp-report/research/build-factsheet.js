'use strict';
// generators/jp-report/research/build-factsheet.js
// 일본 월간 리포트 팩트시트 생성 — DB → JSON.
// 사용법: node generators/jp-report/research/build-factsheet.js [--out=경로]
//
// 축마다 최신 기준월이 다르다(무역 6월 / 항만 5월). 각 축의 최신을 개별로 찾고
// facts.js가 불일치를 표시한다. 임의로 한 달에 맞추지 않는다 — 맞추면 있는 데이터를 버리게 된다.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const {
  buildSppiFacts, buildPortFacts, buildTradeFacts, buildCommodityFacts, buildGlobalFacts, buildRailFacts,
  buildSupplyFacts,
  buildRouteFacts,
  buildGlobalHistory, buildSppiHistory,
  buildFactsheet, GLOBAL_CODES, SPPI_TREND_SERIES,
} = require('./facts');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE = 1000; // PostgREST 기본 반환 상한. 넘기면 조용히 잘린다.

async function query(pathAndQs) {
  if (!URL || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL}/rest/v1/${pathAndQs}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${pathAndQs} → HTTP ${res.status}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** 해당 테이블의 최신 (year, month). 축마다 지연이 달라 개별로 찾는다. */
async function latestPeriod(table, filter = '') {
  const rows = await query(`${table}?select=year,month${filter}&order=year.desc,month.desc&limit=1`);
  if (rows.length === 0) throw new Error(`${table}: 데이터 없음`);
  return { year: rows[0].year, month: rows[0].month };
}

async function collectFacts() {
  // ── 운임(SPPI) ──
  const sppiAt = await latestPeriod('jp_price_indices');
  const sppiSel = 'select=series_name,category,basis,value';
  const sppiRows = await query(`jp_price_indices?${sppiSel}&year=eq.${sppiAt.year}&month=eq.${sppiAt.month}`);
  const sppiPrev = await query(`jp_price_indices?${sppiSel}&year=eq.${sppiAt.year - 1}&month=eq.${sppiAt.month}`);
  // 추이 차트용 시계열. 2계열만 받는다 — 13계열 전부는 차트로 읽히지 않는다.
  const sppiHist = await query(
    'jp_price_indices?select=year,month,series_name,basis,value'
    + `&series_name=in.(${SPPI_TREND_SERIES.map((n) => `"${encodeURIComponent(n)}"`).join(',')})`
    + '&order=year.desc,month.desc&limit=300',
  );

  // ── 항만 ──
  const portAt = await latestPeriod('port_throughput', '&country=eq.JP');
  const portRows = await query(
    `port_throughput?select=port_code,teu,export_teu,import_teu,yoy_pct,is_preliminary`
    + `&country=eq.JP&year=eq.${portAt.year}&month=eq.${portAt.month}`,
  );

  // ── 무역(국가) ── 239개국 전부는 프롬프트에 넣을 수 없다. 총계 + 상위 15개국.
  const tradeAt = await latestPeriod('jp_trade_stats');
  const tradeSel = 'select=country_name,is_aggregate,export_jpy,import_jpy,yoy_export_pct,yoy_import_pct';
  const tradeTotal = await query(
    `jp_trade_stats?${tradeSel}&year=eq.${tradeAt.year}&month=eq.${tradeAt.month}&country_name=eq.Grand%20Total`,
  );
  const tradeTop = await query(
    `jp_trade_stats?${tradeSel}&year=eq.${tradeAt.year}&month=eq.${tradeAt.month}`
    + `&is_aggregate=is.false&order=export_jpy.desc&limit=15`,
  );

  // ── 품목 ── 전량을 받아 합산한다(페이지네이션 필수). 상위 N만 받으면 구성비가 틀어진다.
  const cmAt = await latestPeriod('jp_trade_by_commodity');
  const cmRows = await query(
    `jp_trade_by_commodity?select=direction,commodity_name,value_jpy&year=eq.${cmAt.year}&month=eq.${cmAt.month}`,
  );

  // 世界のスポット指数。週次で最新まで出るので、月次の日本統計より先の情報を持つ。
  // 系列ごとに公表日が違うため多めに取り、系列ごとの最新行を facts 側で拾う。
  const globalRows = await query(
    `freight_indices?select=index_code,value,change_pct,week_date&index_code=in.(${GLOBAL_CODES.join(',')})`
    + '&order=week_date.desc&limit=600',
  );

  // 供給側 — Drewry の欠航便数(主要East-West航路)。日本発着ではないが、
  // スポット運賃の背景を供給から語れる唯一の系列である。
  const supplyRows = await query(
    'blank_sailings?select=week_start,blanked_teu,planned_teu,blank_pct'
    + '&region=eq.Drewry%20East-West&order=week_start.desc&limit=12',
  );

  // 航路別荷動き — JPMAC。日本発の荷動きを航路単位で持つ唯一の軸。
  // 北米は国別(日本が出る)、欧州は地域別まで。
  const routeRows = await query(
    'jp_route_volume?select=trade,direction,year,month,scope,name,teu,yoy_pct,share_pct,cum_teu,cum_yoy_pct,source'
    + '&order=year.desc,month.desc&limit=200',
  );

  return buildFactsheet({
    // history는 차트 전용 축이다. 본문 프롬프트에는 slimFactsheet가 잘라내고 넣지 않는다.
    sppi: { ...buildSppiFacts(sppiRows, sppiPrev, sppiAt), history: buildSppiHistory(sppiHist) },
    port: buildPortFacts(portRows, portAt),
    trade: buildTradeFacts([...tradeTotal, ...tradeTop], tradeAt),
    commodity: buildCommodityFacts(cmRows, cmAt),
    global: { ...buildGlobalFacts(globalRows), history: buildGlobalHistory(globalRows) },
    rail: buildRailFacts(globalRows),
    supply: buildSupplyFacts(supplyRows),
    route: buildRouteFacts(routeRows),
  });
}

/**
 * 품목 합계가 국가별 총액과 일치하는지 대조한다.
 * 서로 다른 소스 경로(CSV 파싱 vs getStatsData API)라 어긋나면 수집 단계에 문제가 있다.
 * 기준월이 다르면 비교 자체가 성립하지 않으므로 건너뛴다.
 */
function crossCheck(factsheet) {
  const { trade, commodity } = factsheet;
  if (trade.period !== commodity.period || !trade.total) return { checked: false };
  const commoditySum = commodity.export.reduce((a, b) => a + b.valueJpy, 0);
  const diffPct = trade.total.exportJpy ? (commoditySum / trade.total.exportJpy - 1) * 100 : null;
  return {
    checked: true,
    tradeTotalExport: trade.total.exportJpy,
    commoditySum,
    diffPct,
    ok: diffPct !== null && Math.abs(diffPct) < 0.01,
  };
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const outPath = outArg
    ? outArg.split('=').slice(1).join('=')
    : path.resolve(__dirname, '../../../content/drafts/jp-factsheet.json');

  const factsheet = await collectFacts();
  const check = crossCheck(factsheet);
  factsheet.crossCheck = check;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(factsheet, null, 2), 'utf8');

  console.log(`✅ 팩트시트: ${outPath}`);
  console.log(`   기준월 — 무역 ${factsheet.periods.trade} / 항만 ${factsheet.periods.port} / 운임 ${factsheet.periods.sppi}`);
  if (factsheet.periodMismatch) console.log('   ⚠️ 축별 기준월 불일치 — 본문에 명시 필요');
  console.log(`   운임 계열 ${factsheet.sppi.series.length}개, 신호 ${factsheet.sppi.signals.length}건`);
  console.log(`   추이(차트용) — 세계 ${factsheet.global?.history?.weeks.length ?? 0}주 / SPPI ${factsheet.sppi.history?.months.length ?? 0}개월`);
  console.log(`   항만 ${factsheet.port.ports.length}개항 (${factsheet.port.isPreliminary ? '속보' : '확보'})`);
  console.log(`   무역 상위 ${factsheet.trade.countries.length}개국, 품목 수출 ${factsheet.commodity.export.length}개`);
  if (check.checked) {
    console.log(`   무결성 대조: 품목 합계 vs 국가별 총액 차이 ${check.diffPct.toFixed(4)}% ${check.ok ? '✅' : '❌'}`);
    if (!check.ok) process.exitCode = 1;
  } else {
    console.log('   무결성 대조: 기준월이 달라 건너뜀');
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ 팩트시트 생성 실패:', e.message);
    process.exit(1);
  });
}

module.exports = { collectFacts, crossCheck };
