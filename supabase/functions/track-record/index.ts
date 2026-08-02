// supabase/functions/track-record/index.ts
// 예보 적중률 공개 API — Logisight의 핵심 차별점.
//
//   GET /track-record            → 전체 + 모듈별 적중률, 최근 판정 내역, 진행 중 전망
//   GET /track-record?module=rates
//
// 왜 이게 차별점인가:
//   운임 지수 숫자는 무료로 어디서나 구한다. 아무도 공개하지 않는 것은 "그래서 맞췄냐"다.
//   forecasts 테이블은 발행 후 본문 수정·삭제를 DB 트리거로 막는다(20260607000000).
//   즉 이 수치는 주장이 아니라 증명이다 — 뉴스룸이 있어도 조직적으로 따라 하기 어렵다.
//
// 정직성 규칙:
//   · 표본은 resolved 전수. 잘 맞춘 것만 고르지 않는다(RLS도 published/resolved 전수 공개).
//   · miss·partial의 복기(outcome_note)를 숨기지 않고 같이 내보낸다.
//   · 표본이 작으면 작다고 그대로 드러낸다 — resolved < 10이면 sample_warning을 붙인다.
//   · 진행 중(published) 전망도 함께 노출한다. 사후 선별이 불가능함을 보여주는 게 신뢰의 핵심.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_SAMPLE = 10;      // 이보다 적으면 적중률을 단정적으로 읽지 말라고 표시
const RECENT_LIMIT = 20;

type Row = {
  id: string;
  module: string;
  statement: string;
  direction: string | null;
  confidence: string | null;
  metric_ref: string | null;
  horizon_date: string | null;
  outcome: string | null;
  realized_pct: number | null;
  outcome_note: string | null;
  published_at: string | null;
  resolved_at: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600", ...CORS },
  });
}

// hit=1, partial=0.5, miss=0 로 가중한 점수와, 순수 적중률을 함께 낸다.
// 둘 다 내는 이유: 하나만 내면 유리한 정의를 골랐다는 의심을 받는다.
function score(rows: Row[]) {
  const resolved = rows.length;
  const hit = rows.filter((r) => r.outcome === "hit").length;
  const partial = rows.filter((r) => r.outcome === "partial").length;
  const miss = rows.filter((r) => r.outcome === "miss").length;
  return {
    resolved,
    hit,
    partial,
    miss,
    hit_rate_pct: resolved ? Math.round((hit / resolved) * 1000) / 10 : null,
    weighted_score_pct: resolved ? Math.round(((hit + partial * 0.5) / resolved) * 1000) / 10 : null,
    sample_warning: resolved < MIN_SAMPLE
      ? `표본 ${resolved}건 — 적중률 해석에 충분하지 않음`
      : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // anon 키로 충분하다 — forecasts는 published/resolved를 전수 공개한다(20260606010000).
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const moduleFilter = new URL(req.url).searchParams.get("module");

  const cols = "id,module,statement,direction,confidence,metric_ref,horizon_date," +
    "outcome,realized_pct,outcome_note,published_at,resolved_at";

  let q = sb.from("forecasts").select(cols).in("status", ["published", "resolved"]);
  if (moduleFilter) q = q.eq("module", moduleFilter);
  const { data, error } = await q.order("horizon_date", { ascending: false });
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as unknown as Row[];
  const judged = rows.filter((r) => r.outcome != null);

  // 모듈별 집계 — 어느 영역이 강하고 어느 영역이 약한지 그대로 드러낸다.
  const byModule: Record<string, ReturnType<typeof score>> = {};
  for (const m of [...new Set(judged.map((r) => r.module))]) {
    byModule[m] = score(judged.filter((r) => r.module === m));
  }

  return json({
    overall: score(judged),
    by_module: byModule,
    // 최근 판정 — miss/partial의 복기까지 그대로 노출한다.
    recent: judged.slice(0, RECENT_LIMIT).map((r) => ({
      id: r.id,
      module: r.module,
      statement: r.statement,
      direction: r.direction,
      confidence: r.confidence,
      metric_ref: r.metric_ref,
      horizon_date: r.horizon_date,
      outcome: r.outcome,
      realized_pct: r.realized_pct,
      outcome_note: r.outcome_note,
      resolved_at: r.resolved_at,
    })),
    // 진행 중 전망 — 판정 전에 공개돼 있다는 사실이 트랙레코드의 신뢰를 만든다.
    open: rows.filter((r) => r.outcome == null).map((r) => ({
      id: r.id,
      module: r.module,
      statement: r.statement,
      direction: r.direction,
      confidence: r.confidence,
      metric_ref: r.metric_ref,
      horizon_date: r.horizon_date,
      published_at: r.published_at,
    })),
    generated_at: new Date().toISOString(),
  });
});
