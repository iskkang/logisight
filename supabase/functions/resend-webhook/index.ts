// supabase/functions/resend-webhook/index.ts
// Resend 웹훅 수신 — 뉴스레터 도달·오픈·클릭·반송을 newsletter_events에 적재한다.
//
//   POST /resend-webhook  (Resend가 호출. Svix 서명 헤더 필수)
//
// 왜 필요한가: 지금은 발송만 하고 반응이 전혀 남지 않는다. 오픈율·클릭률 없이는
//   "이 뉴스레터가 읽히는가"를 답할 수 없고, 잠재고객 판별도 불가능하다.
//
// 보안: 공개 엔드포인트(--no-verify-jwt)이므로 Svix 서명 검증이 유일한 방어선이다.
//   RESEND_WEBHOOK_SECRET 미설정 시 전량 거부한다 — 검증 없이 받으면 지표를 위조당한다.
//
// 개인정보: 이벤트 원장에 이메일 원문을 남기지 않는다.
//   수신자 이메일은 subscriber_id(uuid)로 해석한 뒤 버린다(058 주석 참고).
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOLERANCE_SEC = 300;   // Svix 권장 재전송 허용 오차(±5분)

// Resend 이벤트 타입 → newsletter_events.event (058 CHECK 제약과 일치해야 한다)
const EVENT_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  // email.delivery_delayed 는 최종 상태가 아니라 기록하지 않는다(도달/반송으로 곧 귀결).
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Svix 서명 검증: base64(HMAC-SHA256(secret, "<id>.<timestamp>.<body>")) 가
// svix-signature 헤더의 v1 서명 중 하나와 일치해야 한다.
async function verifySvix(req: Request, raw: string, secret: string): Promise<boolean> {
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  // 재전송 공격 차단 — 오래된 타임스탬프는 거부.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > TOLERANCE_SEC) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    b64ToBytes(secret.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // 헤더는 "v1,<sig> v1,<sig2>" 형태(키 회전 중 복수 서명).
  return sigHeader.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    return ver === "v1" && sig && timingSafeEqual(sig, expected);
  });
}

// 발송 시 심은 Resend tag에서 campaign_id를 되찾는다. 배열/객체 두 형태 모두 대응.
function campaignFromTags(tags: unknown): string | null {
  if (Array.isArray(tags)) {
    const hit = tags.find((t) => t && typeof t === "object" && (t as { name?: string }).name === "campaign_id");
    const v = hit ? (hit as { value?: unknown }).value : null;
    return typeof v === "string" ? v : null;
  }
  if (tags && typeof tags === "object") {
    const v = (tags as Record<string, unknown>).campaign_id;
    return typeof v === "string" ? v : null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) {
    // 검증 불가 상태에서 받아들이면 지표가 오염된다 — 조용히 통과시키지 않고 명시적으로 실패시킨다.
    console.error("RESEND_WEBHOOK_SECRET 미설정 — 웹훅 거부");
    return new Response("webhook secret not configured", { status: 500 });
  }

  const raw = await req.text();
  if (!await verifySvix(req, raw, secret)) return new Response("invalid signature", { status: 401 });

  let payload: { type?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const event = EVENT_MAP[payload.type ?? ""];
  if (!event) return new Response("ignored", { status: 200 });   // 관심 없는 타입은 200으로 종료(재전송 방지)

  const data = payload.data ?? {};
  const to = Array.isArray(data.to) ? String(data.to[0] ?? "") : String(data.to ?? "");

  // 이메일 → subscriber_id 해석. 실패해도 이벤트 자체는 남긴다(캠페인 총계는 유효).
  let subscriberId: string | null = null;
  if (to) {
    const { data: sub } = await sb.from("newsletter_subscribers")
      .select("id").eq("email", to).maybeSingle();
    subscriberId = sub?.id ?? null;
  }

  const click = data.click as { link?: string } | undefined;
  const { error } = await sb.from("newsletter_events").insert({
    campaign_id: campaignFromTags(data.tags),
    resend_email_id: typeof data.email_id === "string" ? data.email_id : null,
    subscriber_id: subscriberId,
    event,
    url: click?.link ?? null,
  });
  if (error) {
    // 5xx로 돌려주면 Resend가 재전송한다 — 일시 장애 시 유실을 막는다.
    console.error("newsletter_events insert:", error.message);
    return new Response("insert failed", { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
