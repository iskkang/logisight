// scripts/fetch-index1520.mjs
// Index1520 통계 ETL — periods로 신규 여부 판단 후 transit-service/cities/countries/provinces를 Supabase에 upsert.
// 스케줄 실행(5일마다). 동일 maxReportingDate면 graceful 종료. 모든 응답 원본을 jsonb(raw)로 보존.
// 실행: node scripts/fetch-index1520.mjs  (Node 20+, global fetch 사용)
import { createClient } from "@supabase/supabase-js";

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

// {id,idCountries,countrySet,name} 행 → 테이블 row(raw 포함).
function mapRef(row) {
  return {
    id: row.id,
    id_countries: row.idCountries ?? null,
    country_set: row.countrySet ?? null,
    name: row.name ?? null,
    raw: row,
  };
}

async function upsert(table, rows, onConflict) {
  if (!rows.length) return 0;
  const { error } = await supabase.from(table).upsert(rows, { onConflict, ignoreDuplicates: false });
  if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  return rows.length;
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
  if (existing) {
    console.log(`No new Index1520 data found. Latest maxReportingDate: ${maxReportingDate}`);
    return;
  }

  // 3) period 파라미터: YYYY01-YYYYMM (year from maxReportingDate). period_from=YYYY-01-01, period_to=maxReportingDate
  const year = maxReportingDate.slice(0, 4);
  const month = maxReportingDate.slice(5, 7);
  const period = `${year}01-${year}${month}`;
  const periodFrom = `${year}-01-01`;
  const periodTo = maxReportingDate;
  console.log(`[index1520] new data — fetching period ${period}`);

  // 4) transit-service + cities/countries/provinces
  const [transit, cities, countries, provinces] = await Promise.all([
    fetchJson(`${BASE}/transit-service/?language=en&view=list&section=transit-service&period=${period}&level=2`),
    fetchJson(`${BASE}/cities/?language=en`),
    fetchJson(`${BASE}/countries/?language=en`),
    fetchJson(`${BASE}/provinces/?language=en`),
  ]);

  // transit-service 매핑
  const transitRows = (transit.data ?? []).map((row) => ({
    period_from: periodFrom,
    period_to: periodTo,
    departure_station_id: row.departureStationId,
    departure_station_name: row.departureStationName,
    destination_station_id: row.destinationStationId,
    destination_station_name: row.destinationStationName,
    current_teu: Number(row.currentPeriodTeu || 0),
    current_actual_weight: row.currentPeriodActualWeight,
    current_shipping_qty: row.currentPeriodShippingQty,
    current_transit_time: row.currentPeriodTransitTime,
    previous_teu: Number(row.previousPeriodTeu || 0),
    previous_actual_weight: row.previousPeriodActualWeight,
    previous_shipping_qty: row.previousPeriodShippingQty,
    previous_transit_time: row.previousPeriodTransitTime,
    relative_teu: row.relativeTeu,
    relative_actual_weight: row.relativeActualWeight,
    relative_shipping_qty: row.relativeShippingQty,
    relative_transit_time: row.relativeTransitTime,
    raw: row,
  }));

  // 5) upsert (중복 방지)
  const nTransit = await upsert(
    "index1520_transit_service",
    transitRows,
    "period_from,period_to,departure_station_id,destination_station_id",
  );
  console.log(`[index1520] transit-service rows saved: ${nTransit}`);

  const nCities = await upsert("index1520_cities", (cities.data ?? []).map(mapRef), "id");
  const nCountries = await upsert("index1520_countries", (countries.data ?? []).map(mapRef), "id");
  const nProvinces = await upsert("index1520_provinces", (provinces.data ?? []).map(mapRef), "id");
  console.log(`[index1520] cities: ${nCities} / countries: ${nCountries} / provinces: ${nProvinces}`);

  // 6) period_status 마지막 기록(데이터 적재 성공 후) — 실패 시 다음 실행에서 재시도
  await upsert(
    "index1520_period_status",
    [{ source: "index1520", max_reporting_date: maxReportingDate, raw: periods }],
    "max_reporting_date",
  );

  console.log("[index1520] completed successfully");
}

main().catch((err) => {
  console.error("[index1520] failed:", err.message);
  process.exit(1);
});
