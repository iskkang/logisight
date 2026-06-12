# Daily Newsletter — 사이트 기사 기반 재구성 설계

**날짜:** 2026-06-12
**상태:** 승인됨 (2026-06-12)

## 목표

데일리 이메일 뉴스레터가 수집·큐레이션 파이프라인을 자체 실행하지 않고,
이미 웹사이트(logisight-core)에 발행된 기사를 읽어 카드 목록만 렌더링하도록 재구성한다.

- 이메일 카드 = 이미지 + 섹션 라벨 + 제목 + 소제목(summary). 클릭 시 사이트 기사 페이지로 이동.
- DeepSeek 호출 0회, Playwright 불필요 → API 비용 절감, 실행 시간 30분 → 약 1분.
- 사용처 없는 daily_card 파이프라인(06:00 워크플로) 폐기 → 하루 3회 중복 수집·큐레이션이 1회로 감소
  (06:30 daily-web-articles.yml만 남음).

## 현재 구조 (변경 전)

| 시간 (KST) | 워크플로 | 동작 |
|---|---|---|
| 06:00 | publish-daily-news.yml | 수집+큐레이션 → daily_card upsert (**사이트 미사용 — 죽은 경로**) |
| 06:30 | daily-web-articles.yml | 수집+큐레이션 → 웹 기사 생성 (agent_type=shipping/brief/external) |
| 09:00 | daily-newsletter.yml | 수집+큐레이션 **재실행** → curated-*.json → HTML 생성 → Resend 발송 |

## 변경 후 구조

| 시간 (KST) | 워크플로 | 동작 |
|---|---|---|
| 06:30 | daily-web-articles.yml | (변경 없음) 수집+큐레이션 → 웹 기사 생성 |
| 08:00 | daily-newsletter.yml | maritime_news 조회 → 카드 HTML 생성 → Resend 발송 |

## 컴포넌트 설계

### 1. 신규: `generators/email/generate-newsletter-from-site.js`

**입력:** Supabase `maritime_news` (env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
**출력:** `content/drafts/newsletter-YYYY-MM-DD.html`

**기사 선정 쿼리:**

```
agent_type = 'shipping'
AND slug IS NOT NULL
AND fetched_at >= 당일 00:00 KST (= 전일 15:00 UTC)
ORDER BY fetched_at DESC
```

- 06:30 워크플로의 `generate-article-shipping.js`가 섹션당 1건씩 생성하는 기사가 대상.
  shipping 기사는 `category`가 섹션과 1:1 매핑된다 (rail→철도, ocean→해상, air→항공,
  trade→무역, logistics→물류 — `categoryFor()` 기준).
- **카테고리당 최신 1건**만 선택 (같은 카테고리에 복수 행이 있으면 fetched_at 최신 우선).
  최대 5장의 카드.
- 카드 표시 순서는 고정: 해상 → 항공 → 철도 → 무역 → 물류.

**카드 렌더링 (카드당):**

- 이미지: `image_url` (없으면 기존 generate-newsletter.js의 섹션 아이콘 placeholder 패턴 재사용).
  `image_credit` 있으면 "Photo: …" 캡션.
- 섹션 라벨: category 텍스트 (예: 🚢 해상).
- 제목: `title`.
- 소제목: `summary` (insertArticle이 frontmatter subtitle을 저장하는 컬럼). null이면 생략.
- 본문(content)은 **넣지 않는다.**
- 링크: 카드 전체 클릭 → `https://logisight.mtlship.com/article/{slug}`.

**프레임:** 기존 `generate-newsletter.js`의 헤더(MTL Logisight Intelligence / Logisight Daily),
대시보드 CTA, 푸터 디자인을 그대로 가져온다. 푸터의 "웹에서 보기" 링크는
`https://logisight.mtlship.com/news`로 변경.

**엣지 케이스:**

- 당일 기사 0건 → HTML을 생성하지 않고 exit 0 (워크플로의 기존 "HTML 없음 — 발송 스킵" 가드가 동작).
- 일부 섹션 기사 없음 → 해당 카드만 생략 (placeholder 박스 없음).

### 2. 수정: `.github/workflows/daily-newsletter.yml`

- cron: `0 0 * * *` → `0 23 * * *` (08:00 KST).
- 스텝 축소: checkout → setup-node → `npm ci` → `node generators/email/generate-newsletter-from-site.js`
  → 기존 발송 스텝 (`send-newsletter.js --html=…`, 변경 없음).
- 제거: Playwright 설치, collect:rail/ocean, curate:rail/ocean 스텝.
- secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INTERNAL_EMAIL`만 사용
  (`DEEPSEEK_API_KEY`, `UNSPLASH_ACCESS_KEY` 불필요).

### 3. 삭제: daily_card 파이프라인

- `.github/workflows/publish-daily-news.yml` 삭제.
- `generators/web/publish-daily-cards-to-site.js` 삭제.
- `package.json`의 `publish:daily-cards` 스크립트 삭제.
- 기존 DB의 daily_card 행은 그대로 둔다 (프론트엔드가 이미 쿼리에서 제외 중).
- `db/SCHEMA.md`의 daily_card 행에 "폐기됨(2026-06-12), 신규 생성 없음" 주석 추가.

### 4. 정리: `generators/email/generate-newsletter.js`

- 데일리 경로에서는 신규 스크립트로 대체된다.
- 단, **weekly-newsletter.yml이 아직 `newsletter:generate`로 이 파일을 사용**하므로 삭제하지 않는다.
- `package.json`의 `newsletter:generate`는 weekly용으로 유지하고,
  신규 스크립트는 `newsletter:from-site`로 등록.

## 변경하지 않는 것 (스코프 제외)

- `weekly-newsletter.yml` 및 weekly 경로 전체 — 추후 같은 패턴 적용 후보.
- `daily-web-articles.yml` — 기사 생성 파이프라인은 그대로.
- 수신자 — 현행 `INTERNAL_EMAIL` 단일 수신 유지. 구독자 테이블 연동은 별도 작업.
- `send-newsletter.js` — `--html=` 경로 그대로 사용.
- curate-*.js 스크립트 — 06:30 웹 기사 파이프라인이 계속 사용.

## 검증 기준

1. 로컬에서 `node generators/email/generate-newsletter-from-site.js` 실행 시
   당일 shipping 기사 기준 HTML이 생성된다 (기사 있을 때).
2. 생성된 HTML의 모든 카드 링크가 `https://logisight.mtlship.com/article/{slug}` 형식이고,
   해당 slug가 DB에 실재한다.
3. 당일 기사 0건인 경우 HTML 미생성 + exit 0.
4. `workflow_dispatch`로 daily-newsletter.yml 수동 실행 → INTERNAL_EMAIL로 수신 확인.
5. `npm run` 스크립트 중 `publish:daily-cards` 참조가 남아 있지 않다 (grep 0건).
