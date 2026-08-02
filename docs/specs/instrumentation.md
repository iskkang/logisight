# 계측 (Instrumentation) — 공개 오픈 전 기준선

파이프라인은 산출물을 만들지만 "누가 읽었나"를 닫는 루프가 없었다. 오픈 후에 붙이면
초기 유입 데이터가 영구 유실되므로 **오픈 전에** 심는다. 대부분의 지표가 0으로 나오는 것이
정상이며, 그 0이 이후 비교의 기준선이다.

## 구성

| 계층 | 위치 | 역할 |
|---|---|---|
| 원장 | `analytics_events` (057) | 사이트 이벤트. service_role 전용 |
| 수집 | `supabase/functions/track` | 프론트가 POST. allowlist 검증 후 적재 |
| 발송 | `newsletter_sends` (058) | 캠페인 1회 = 1행. 오픈율의 분모 |
| 반응 | `newsletter_events` + `functions/resend-webhook` | 도달·오픈·클릭·반송 |
| 공개 | `supabase/functions/track-record` | 예보 적중률 공개 API |
| 집계 | `v_kpi_daily` · `v_content_engagement` · `v_newsletter_campaign_stats` · `v_subscriber_engagement` | 내부 KPI |
| 소비 | `npm run kpi:weekly` + `.github/workflows/kpi-weekly.yml` | 주 1회 Slack 다이제스트 |

## 개인정보 원칙

독립 미디어에서 개인정보 신뢰는 자산이다. 지표보다 우선한다.

- 쿠키 없음. 영속 식별자 없음. IP·UA 원문 저장 없음.
- `session_id`는 `sessionStorage` 난수 — 탭을 닫으면 소멸(교차 사이트 추적 불가).
- referrer는 **호스트만**, 위치는 **국가코드만**. 경로는 쿼리스트링 제거 후 저장.
- 뉴스레터 이벤트 원장에 이메일 원문을 남기지 않는다(웹훅에서 `subscriber_id`로 해석 후 폐기).
- 원장은 anon 접근 전면 차단. 공개가 필요하면 집계 뷰만 노출.

## 이벤트 taxonomy

`supabase/functions/track/index.ts`의 `ALLOWED`가 유일한 정본이다. 여기 없는 이름은 조용히 버려진다.

| event | props | 비고 |
|---|---|---|
| `page_view` | `utm_source`, `utm_campaign` (있을 때) | 뉴스레터 유입 귀속 |
| `article_view` | `slug`, `category` | |
| `article_read` | `slug`, `pct` (25/50/75/100) | 완독률. 50% 이상을 "읽음"으로 집계 |
| `report_view` | `report_id`, `type`, `edition` | |
| `report_download` | `report_id`, `type`, `edition` | PDF 클릭 시 발화 |
| `forecast_view` | `module` | |
| `track_record_view` | — | 적중률 페이지. 차별점 소구력 측정 |
| `subscribe_open` / `subscribe_submit` / `subscribe_done` | `placement` | 구독 퍼널 3단 |
| `outbound_click` | `host` | |

퍼널: `page_view → article_view → article_read(50%+) → subscribe_open → subscribe_submit → subscribe_done`

## 프론트 연동 (사이트 레포에서 작업)

사이트는 별도 레포(Lovable → Vercel)다. 아래 스니펫을 전역에 1회 삽입한다.

```html
<script>
(function () {
  var ENDPOINT = 'https://<project-ref>.supabase.co/functions/v1/track';

  // 비영속 세션 ID — 탭을 닫으면 사라진다. 쿠키·localStorage 사용 금지.
  var sid = sessionStorage.getItem('lg_sid');
  if (!sid) {
    sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/-/g, '').slice(0, 32);
    sessionStorage.setItem('lg_sid', sid);
  }

  window.lgTrack = function (event, props) {
    var body = JSON.stringify({
      event: event,
      path: location.pathname,
      ref: document.referrer || null,
      session_id: sid,
      props: props || {},
    });
    // 페이지 이탈 중에도 유실되지 않게 sendBeacon 우선.
    if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    else fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true });
  };

  // 첫 페이지뷰 — UTM이 있으면 함께 넘겨 뉴스레터 유입을 귀속한다.
  var q = new URLSearchParams(location.search);
  var p = {};
  if (q.get('utm_source')) p.utm_source = q.get('utm_source');
  if (q.get('utm_campaign')) p.utm_campaign = q.get('utm_campaign');
  window.lgTrack('page_view', p);
})();
</script>
```

호출 예:

```js
lgTrack('article_view', { slug: 'scfi-surge-w31', category: '해상' });
lgTrack('article_read', { slug: 'scfi-surge-w31', pct: 50 });   // 스크롤 깊이 도달 시 1회씩
lgTrack('report_download', { report_id: '2026-W31', type: 'weekly', edition: 'kr' });
lgTrack('subscribe_open', { placement: 'footer' });
```

SPA 라우팅이면 라우트 변경마다 `page_view`를 다시 쏜다.

## Resend 웹훅 설정

1. Resend 대시보드 > Webhooks > 엔드포인트 추가
   `https://<project-ref>.supabase.co/functions/v1/resend-webhook`
2. 구독 이벤트: `email.sent`, `email.delivered`, `email.opened`, `email.clicked`,
   `email.bounced`, `email.complained`
3. 발급된 서명 시크릿을 **Supabase Edge Function 시크릿** `RESEND_WEBHOOK_SECRET`에 등록.
   미설정이면 웹훅을 전량 거부한다(검증 없이 받으면 지표를 위조당한다).
4. Resend 대시보드에서 open/click 트래킹을 켜야 오픈·클릭 이벤트가 발생한다.

> **귀속 확인이 중요하다.** 오픈·클릭을 캠페인에 붙이는 것은 발송 시 심는 Resend tag(`campaign_id`)다.
> 이 태그가 웹훅 페이로드로 돌아오지 않으면 반응이 `campaign_id = NULL`로 쌓이고, 캠페인 통계는
> "아무도 열지 않은 것"처럼 보인다. 주간 다이제스트가 미귀속 건수를 세어 경고하므로,
> 첫 발송 후 그 줄이 뜨는지 반드시 확인할 것.

## 오픈 전 점검

- [ ] 마이그레이션 2건 적용 (`20260802000001`, `20260802000002`)
- [ ] Edge Function 3종 배포 — 전부 `--no-verify-jwt` (`deploy-functions.yml`이 처리)
- [ ] `RESEND_WEBHOOK_SECRET` 등록
- [ ] 사이트에 스니펫 삽입 후 `analytics_events`에 `page_view`가 실제로 쌓이는지 확인
- [ ] 테스트 발송 1회 → `newsletter_sends` 1행 + 오픈 시 `newsletter_events` 적재 확인
- [ ] `npm run kpi:weekly` 수동 1회 실행 — 오픈 전 기준선(대부분 0) 기록
- [ ] `SLACK_WEBHOOK` 등록(없으면 다이제스트가 로그로만 남는다)

## 브랜드 분리 시 변경점

`NEWSLETTER_FROM` · `SITE_URL` 환경변수만 바꾸면 발신 주소와 UTM 대상 도메인이 함께 옮겨간다
(미설정 시 현행 값 유지 — 동작 불변). 선행 조건은 DNS와 Resend 발신 도메인 검증이다.
`send-newsletter.js`의 푸터 문구("MTL Shipping Agency")와 이메일 템플릿의 브랜드 표기는
도메인 확정 후 별도로 정리한다.

## 미결

- **PDF 다운로드 정확도** — 현재는 프론트 클릭 이벤트로 센다. PDF는 Vercel rewrite가 Supabase
  스토리지로 직결하므로 직링크 접근은 잡히지 않는다. 정확히 세려면 다운로드 프록시 함수를 두고
  rewrite를 그쪽으로 돌려야 한다(사이트 레포 변경 필요).
- **원장 보존** — `analytics_events`는 무한 증가한다. 집계 뷰가 안정화되면 90일 이전 삭제 배치 추가.
