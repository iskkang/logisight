// supabase/functions/track/index.ts
// 사이트 계측 수집 엔드포인트 — 프론트(별도 레포)가 이벤트 1건을 POST 한다.
//
//   POST /track  { event, path?, ref?, session_id?, props? }  → 204
//
// 설계 원칙:
//   · 공개 엔드포인트다(--no-verify-jwt). 그래서 방어는 "무엇을 받느냐"로 한다 —
//     event는 allowlist 통과분만, props는 키 수·길이 상한, 그 외 필드는 전부 버린다.
//   · 개인식별자를 만들지 않는다. IP·UA 원문·전체 referrer는 저장하지 않고,
//     referrer는 호스트만, 위치는 CDN 헤더의 국가코드만 남긴다.
//   · service_role로 INSERT 한다 — analytics_events는 anon 쓰기가 막혀 있다(057).
//   · 실패해도 사이트를 방해하지 않는다. 오류에도 항상 204로 응답한다.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  // 브라우저 계측 비콘은 어느 페이지에서든 나간다. Origin 제한은 curl로 우회되므로
  // 실질 방어가 아니다 — 방어는 allowlist·상한으로 하고 CORS는 열어 둔다.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 계측 이벤트 taxonomy. 여기 없는 이름은 조용히 버린다.
// 퍼널: page_view → article_view → article_read(50%+) → subscribe_submit → subscribe_done
const ALLOWED = new Set([
  "page_view",         // {}
  "article_view",      // { slug, category }
  "article_read",      // { slug, pct }        스크롤 깊이 25/50/75/100
  "report_view",       // { report_id, type, edition }
  "report_download",   // { report_id, type, edition }
  "forecast_view",     // { module }
  "track_record_view", // {}                   적중률 페이지 — 차별점 소구력 측정
  "subscribe_open",    // { placement }
  "subscribe_submit",  // { placement }
  "subscribe_done",    // { placement }
  "outbound_click",    // { host }
]);

const MAX_PROPS_KEYS = 10;
const MAX_STR = 200;

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const noContent = () => new Response(null, { status: 204, headers: CORS });

function str(v: unknown, max = MAX_STR): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

// 경로만 남기고 쿼리스트링·해시는 버린다(유입 파라미터에 개인정보가 섞여 오는 사고 방지).
function cleanPath(v: unknown): string | null {
  const s = str(v, 300);
  if (!s) return null;
  return s.split("?")[0].split("#")[0].slice(0, 300);
}

// referrer는 호스트만. 파싱 실패(빈 값·상대경로)면 저장하지 않는다.
function refHost(v: unknown): string | null {
  const s = str(v, 500);
  if (!s) return null;
  try {
    return new URL(s).hostname.slice(0, 120);
  } catch {
    return null;
  }
}

// 세션 난수는 형태만 검증 — 영속 식별자로 쓰이지 않도록 길이를 제한한다.
function sessionId(v: unknown): string | null {
  const s = str(v, 64);
  return s && /^[A-Za-z0-9_-]{6,64}$/.test(s) ? s : null;
}

// props는 1뎁스 문자열·숫자·불리언만 통과. 중첩 객체는 통째로 버린다.
function cleanProps(v: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS_KEYS) break;
    if (!/^[a-z_][a-z0-9_]{0,32}$/.test(k)) continue;
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else if (typeof val === "boolean") out[k] = val;
    else if (typeof val === "string" && val.trim()) out[k] = val.trim().slice(0, MAX_STR);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return noContent();

  try {
    // sendBeacon은 content-type을 text/plain으로 보내는 경우가 있어 text로 받아 직접 파싱한다.
    const body = JSON.parse(await req.text());
    const event = str(body?.event, 40);
    if (!event || !ALLOWED.has(event)) return noContent();

    const country = req.headers.get("x-vercel-ip-country")
      ?? req.headers.get("cf-ipcountry")
      ?? null;

    const { error } = await sb.from("analytics_events").insert({
      event,
      path: cleanPath(body?.path),
      session_id: sessionId(body?.session_id),
      referrer_host: refHost(body?.ref),
      country: country ? country.slice(0, 2).toUpperCase() : null,
      props: cleanProps(body?.props),
    });
    // 계측 실패가 사이트를 깨뜨리면 안 된다 — 로그만 남기고 204.
    if (error) console.error("analytics_events insert:", error.message);
  } catch (e) {
    console.error("track:", e instanceof Error ? e.message : String(e));
  }
  return noContent();
});
