// supabase/functions/_shared/require-cron-secret.ts
//
// GitHub Actions 만 부르는 Edge Function 의 문지기.
//
// ■ verify_jwt 는 인가가 아니다 ★
// 이 함수들은 지금까지 anon public 키로 호출됐다(globe-risk-cron.yml 등의 주석이
// 그렇게 적고 있다 —— "anon public 키 (verify_jwt 통과용; 함수 내부에서 service 키로
// DB 씀)"). 그런데 anon 키는 이름 그대로 공개 키다. 브라우저 번들에 실려 나가므로
// 누구나 읽을 수 있고, 그걸로 verify_jwt 를 통과해 함수를 부를 수 있었다.
// 함수 안에서는 SUPABASE_SERVICE_ROLE_KEY 로 RLS 를 우회해 쓰기를 한다.
// 즉 "아무나 호출 → service_role 쓰기" 경로가 열려 있었다.
//
// verify_jwt 는 "유효한 토큰인가"를 볼 뿐 "부를 자격이 있는가"를 보지 않는다.
// 자격 검사는 함수 안에 있어야 한다 —— logisight-core 의 서버함수에서와 같은 이야기다.
//
// ■ 비밀값이 없으면 통과가 아니라 거절이다
// 설정 누락이 곧 인증 해제가 되면 안 된다. CRON_SECRET 이 안 잡혀 있으면 요청을 받지
// 않는다. 배포 전에 반드시 넣어야 한다:
//     supabase secrets set CRON_SECRET=<값>
// 그리고 GitHub Secrets 에 같은 값을 CRON_SECRET 으로 넣고 워크플로가
// x-cron-secret 헤더로 보낸다.
//
// ■ 브라우저에서 부르는 함수에는 쓰지 말 것
// 이 헬퍼는 「CI 만 부르는 함수」 전용이다. 프론트에서 부르는 함수에 걸면 비밀값을
// 브라우저에 내려야 하고, 그러면 비밀이 아니게 된다. 그런 함수는 사용자 JWT 로
// 판정해야 한다.

const HEADER = "x-cron-secret";

/**
 * 통과하면 null, 막아야 하면 Response 를 돌려준다.
 *
 *   const denied = requireCronSecret(req);
 *   if (denied) return denied;
 */
export function requireCronSecret(req: Request): Response | null {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) {
    console.error("[authz] CRON_SECRET 미설정 — 요청을 거절한다 (supabase secrets set CRON_SECRET=…)");
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (req.headers.get(HEADER) !== secret) {
    console.error("[authz] x-cron-secret 불일치 — 요청을 거절한다");
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
