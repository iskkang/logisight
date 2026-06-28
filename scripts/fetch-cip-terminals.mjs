// scripts/fetch-cip-terminals.mjs
// CIP RNE(RailNetEurope Customer Information Platform) 유럽 복합운송 터미널 디렉터리 ETL.
// 공개 엔드포인트 /api/public/terminals?groupId=8513 (EU 교통회랑) 전 페이지를 수집 → eu_rail_terminals upsert.
// 정적 참조 데이터(월 1회면 충분). 응답 원본을 jsonb(raw)로 보존. 이번 실행에서 안 보인 행은 prune.
// 실행: node scripts/fetch-cip-terminals.mjs  (Node 20+, global fetch)
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

// groupId=8513 = EU Transport Corridors(ScanMed·Atlantic·Baltic-Adriatic·MED·North Sea-Baltic·Rhine-Danube 등).
// bbox는 유럽 전역을 넉넉히 덮는 값. (RFC 그룹 6199 등은 터미널이 비어 있어 8513만 사용)
const BASE = "https://cip.rne.eu/api/public/terminals";
const GROUP_ID = 8513;
const BBOX = "left=-30&bottom=30&right=45&top=72&zoomLevel=4";
const PAGE_SIZE = 100;

const HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchPage(page) {
  const url = `${BASE}?groupId=${GROUP_ID}&${BBOX}&page=${page}&size=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.content)) throw new Error(`Invalid terminals response for ${url}`);
  return json;
}

const str = (v) => (v === null || v === undefined || v === "" ? null : String(v));

async function main() {
  console.log("[cip-terminals] fetch started");
  const fetchedAt = new Date().toISOString();

  // 1) 전 페이지 수집
  const rows = [];
  for (let page = 0; page < 60; page++) {
    const json = await fetchPage(page);
    if (!json.content.length) break;
    for (const t of json.content) {
      rows.push({
        id: t.id,
        name: t.name,
        operator: str(t.operator),
        type: str(t.type),
        corridors: Array.isArray(t.corridors) ? t.corridors : [],
        address: str(t.address),
        home_page: str(t.homePage),
        info_url: str(t.infoUrl),
        raw: t,
        fetched_at: fetchedAt,
      });
    }
    const total = json.page?.totalPages ?? 0;
    if (total && page + 1 >= total) break;
  }
  console.log(`[cip-terminals] fetched rows: ${rows.length}`);
  if (!rows.length) throw new Error("no terminals returned — aborting (테이블 보존)");

  // 2) id 중복 제거(마지막 우선) 후 upsert
  const byId = new Map(rows.map((r) => [r.id, r]));
  const deduped = [...byId.values()];
  const { error: upErr } = await supabase
    .from("eu_rail_terminals")
    .upsert(deduped, { onConflict: "id", ignoreDuplicates: false });
  if (upErr) throw new Error(`upsert eu_rail_terminals failed: ${upErr.message}`);
  console.log(`[cip-terminals] upserted: ${deduped.length}`);

  // 3) 이번 실행에서 안 보인 행(상류에서 삭제됨) prune
  const { error: delErr, count } = await supabase
    .from("eu_rail_terminals")
    .delete({ count: "exact" })
    .lt("fetched_at", fetchedAt);
  if (delErr) throw new Error(`prune eu_rail_terminals failed: ${delErr.message}`);
  console.log(`[cip-terminals] pruned stale: ${count ?? 0}`);

  console.log("[cip-terminals] completed successfully");
}

main().catch((err) => {
  console.error("[cip-terminals] failed:", err.message);
  process.exit(1);
});
