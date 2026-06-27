// scripts/fetch-index1520.mjs
// Index1520 통계 ETL — periods로 신규 여부 판단 후 transit-service / route / cities / countries / provinces 를 Supabase에 upsert.
// 5일 주기 실행. 동일 maxReportingDate면 graceful 종료. 모든 응답 원본을 jsonb(raw)로 보존.
// 실행: node scripts/fetch-index1520.mjs  (Node 20+, global fetch)
import ws from "ws";
import { createClient } from "@supabase/supabase-js";

// Node 20에는 네이티브 WebSocket이 없어 supabase-js RealtimeClient가 throw → ws 주입(기존 수집기와 동일 패턴).
if (!globalThis.WebSocket) globalThis.WebSocket = ws;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BASE = "https://index1520.com/StatisticsAPI/clickhouse";
const HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// JSON fetch + 명확한 에러. 응답이 비정상이면 throw → 워크플로 실패.
async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  if (!json || typeof json !== "object" || json.meta?.success === false) {
    throw new Error(`Invalid API response for ${url}`);
  }
  return json;
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// {id,idCountries,countrySet,name} 행 → ref 테이블 row(raw 포함).
function mapRef(row) {
  return {
    id: row.id,
    id_countries: row.idCountries ?? null,
    country_set: row.countrySet ?? null,
    name: row.name ?? null,
    raw: row,
  };
}

// route API 행이 O-D(출발→도착) 형태인지 판별. (현재 route API는 지역 집계라 false)
function isODRoute(row) {
  if (!row) return false;
  const dep = row.departureStationId ?? row.departureId ?? row.departure_id;
  const dest = row.destinationStationId ?? row.destinationId ?? row.destination_id;
  return Boolean(dep && dest);
}

async function upsert(table, rows, onConflict) {
  if (!rows.length) return 0;
  // 같은 onConflict 키가 한 배치에 중복되면 Postgres가 거부("cannot affect row a second time")
  // → 키로 dedupe(마지막 우선). 예: cities 응답에 동일 id(YIVU=Yiwu/Yiwuxi)가 2건.
  const keys = onConflict.split(",").map((s) => s.trim());
  const byKey = new Map(rows.map((r) => [keys.map((k) => r[k]).join("||"), r]));
  const deduped = [...byKey.values()];
  const { error } = await supabase.from(table).upsert(deduped, { onConflict, ignoreDuplicates: false });
  if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  return deduped.length;
}

async function main() {
  console.log("[index1520] API fetch started");

  // 1) periods → maxReportingDate
  const periods = await fetchJson(`${BASE}/periods/?language=en`);
  const maxReportingDate = periods.data?.maxReportingDate;
  if (!maxReportingDate) throw new Error("periods: maxReportingDate missing");
  console.log(`[index1520] latest maxReportingDate: ${maxReportingDate}`);

  // 2) 이미 적재된 maxReportingDate면 graceful 종료
  const { data: existing, error: exErr } = await supabase
    .from("index1520_period_status")
    .select("max_reporting_date")
    .eq("max_reporting_date", maxReportingDate)
    .maybeSingle();
  if (exErr) throw new Error(`period_status read failed: ${exErr.message}`);
  const force = process.env.FORCE === "true";
  if (existing && !force) {
    console.log(`No new Index1520 data found. Latest maxReportingDate: ${maxReportingDate}`);
    return;
  }
  if (existing && force) console.log(`[index1520] FORCE 모드 — 기존 ${maxReportingDate} 재수집`);

  // 3) period / previousPeriod 계산 (YYYY01-YYYYMM / prevYear01-prevYearMM)
  const year = Number(maxReportingDate.slice(0, 4));
  const month = maxReportingDate.slice(5, 7);
  const period = `${year}01-${year}${month}`;
  const previousPeriod = `${year - 1}01-${year - 1}${month}`;
  console.log(`[index1520] current period: ${period}`);
  console.log(`[index1520] previous period: ${previousPeriod}`);

  // 4) transit-service + route + cities/countries/provinces
  const [transit, route, cities, countries, provinces] = await Promise.all([
    fetchJson(`${BASE}/transit-service/?language=en&view=list&section=transit-service&period=${period}&previousPeriod=${previousPeriod}&level=2`),
    fetchJson(`${BASE}/route/?language=en&view=list&section=route&period=${period}&previousPeriod=${previousPeriod}&level=2`).catch((e) => {
      console.warn(`[index1520] route API fetch failed (계속 진행): ${e.message}`);
      return null;
    }),
    fetchJson(`${BASE}/cities/?language=en`),
    fetchJson(`${BASE}/countries/?language=en`),
    fetchJson(`${BASE}/provinces/?language=en`),
  ]);

  // reportingPeriod (응답 meta 우선, 없으면 계산값)
  const rp = transit.meta?.period?.reportingPeriod ?? {};
  const periodFrom = rp.from ?? `${year}-01-01`;
  const periodTo = rp.to ?? maxReportingDate;

  // transit-service 매핑 (라우트 지도 소스)
  const transitRows = (transit.data ?? []).map((row) => ({
    period,
    previous_period: previousPeriod,
    period_from: periodFrom,
    period_to: periodTo,
    departure_station_id: row.departureStationId,
    departure_station_name: row.departureStationName,
    destination_station_id: row.destinationStationId,
    destination_station_name: row.destinationStationName,
    current_teu: Number(row.currentPeriodTeu || 0),
    current_actual_weight: num(row.currentPeriodActualWeight),
    current_shipping_qty: num(row.currentPeriodShippingQty),
    current_transit_time: num(row.currentPeriodTransitTime),
    previous_teu: Number(row.previousPeriodTeu || 0),
    previous_actual_weight: num(row.previousPeriodActualWeight),
    previous_shipping_qty: num(row.previousPeriodShippingQty),
    previous_transit_time: num(row.previousPeriodTransitTime),
    relative_teu: num(row.relativeTeu),
    relative_actual_weight: num(row.relativeActualWeight),
    relative_shipping_qty: num(row.relativeShippingQty),
    relative_transit_time: num(row.relativeTransitTime),
    raw: row,
  }));

  const nTransit = await upsert(
    "index1520_transit_service",
    transitRows,
    "period,previous_period,departure_station_id,destination_station_id",
  );
  console.log(`[index1520] transit-service rows saved: ${nTransit}`);

  // route API: O-D 경로면 route_statistics에 저장, 아니면(지역 집계) 스킵 → 페이지는 transit-service 사용
  let nRoute = 0;
  const routeData = route?.data ?? [];
  if (routeData.length && routeData.every(isODRoute)) {
    const routeRows = routeData.map((row) => ({
      period,
      previous_period: previousPeriod,
      departure_id: row.departureStationId ?? row.departureId ?? row.departure_id,
      departure_name: row.departureStationName ?? row.departureName ?? row.departure_name,
      destination_id: row.destinationStationId ?? row.destinationId ?? row.destination_id,
      destination_name: row.destinationStationName ?? row.destinationName ?? row.destination_name,
      current_teu: Number(row.currentPeriodTeu ?? row.TEU ?? 0),
      previous_teu: Number(row.previousPeriodTeu ?? row.previousTEU ?? 0),
      relative_teu: num(row.relativeTeu ?? row.relativeTEU),
      current_actual_weight: num(row.currentPeriodActualWeight),
      previous_actual_weight: num(row.previousPeriodActualWeight),
      relative_actual_weight: num(row.relativeActualWeight),
      current_shipping_qty: num(row.currentPeriodShippingQty),
      previous_shipping_qty: num(row.previousPeriodShippingQty),
      relative_shipping_qty: num(row.relativeShippingQty),
      current_transit_time: num(row.currentPeriodFullTime ?? row.currentPeriodTransitTime),
      previous_transit_time: num(row.previousPeriodFullTime ?? row.previousPeriodTransitTime),
      relative_transit_time: num(row.relativeFullTime ?? row.relativeTransitTime),
      raw: row,
    }));
    nRoute = await upsert(
      "index1520_route_statistics",
      routeRows,
      "period,previous_period,departure_id,destination_id",
    );
    console.log(`[index1520] route rows saved: ${nRoute}`);
  } else {
    console.log(
      `[index1520] route API returned ${routeData.length} non-O-D rows (region aggregates) — route_statistics 스킵, 페이지는 transit-service 사용`,
    );
  }

  const nCities = await upsert("index1520_cities", (cities.data ?? []).map(mapRef), "id");
  const nCountries = await upsert("index1520_countries", (countries.data ?? []).map(mapRef), "id");
  const nProvinces = await upsert("index1520_provinces", (provinces.data ?? []).map(mapRef), "id");
  console.log(`[index1520] cities: ${nCities}`);
  console.log(`[index1520] countries: ${nCountries}`);
  console.log(`[index1520] provinces: ${nProvinces}`);

  // period_status 마지막 기록(데이터 적재 성공 후) — 실패 시 다음 실행에서 재시도
  await upsert(
    "index1520_period_status",
    [{ source: "index1520", max_reporting_date: maxReportingDate, current_period: period, previous_period: previousPeriod, raw: periods }],
    "max_reporting_date",
  );

  console.log("[index1520] completed successfully");
}

main().catch((err) => {
  console.error("[index1520] failed:", err.message);
  process.exit(1);
});
