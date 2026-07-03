# Monthly Report 데이터 소스 개선 설계

**날짜:** 2026-07-03
**대상:** `logisight-pipeline` — 월간 리포트 생성 파이프라인 (`section:all` = `generators/report/run-section.js`)
**범위:** 두 가지 독립적 개선을 하나의 스펙으로 묶음
1. Part 1 — 직전 완료월 타깃팅 + 발행월 데이터 배제
2. Part 2 — `maritime_news`(external 원문) 병합으로 뉴스 소스 확장

---

## 배경 / 문제

월간 리포트는 "7월 첫째 주 발행 = **6월 데이터 취합 → 6월 정리 → 6월 기반 7월 전망**" 구조여야 한다.
현재 코드의 두 가지 간극:

### 문제 1 — 잘못된 월 타깃 + 발행월 데이터 혼입
- `run-section.js:28` `MONTH = TODAY.slice(0,7)` = **실행 시점의 현재 월**.
- cron `0 19 2 * *` (매월 2일경) → 7월 초 실행 시 `2026-07` 라벨. 그러나 완료된 달은 6월.
- 지수 조회가 최신값(`s[0]`)을 절대 최신 주로 잡아, 6월 리포트에 7월 1주차 데이터가 섞일 수 있음.

### 문제 2 — 뉴스 소스가 monthly 전용으로 협소
- 월간 리포트 뉴스 = `content/drafts/latest-news.json` (← `monthly_analysis` collector: JOC·Freightos·Flexport·Linerlytica).
- Weekly / 지역별 weekly 리포트 뉴스 = `maritime_news` 테이블 (← `news_global`·`news_rail`·`news_industry`·`news_browser`: Loadstar·Splash247·FreightWaves·WorldACD·RailFreight 등 + 한글 큐레이션).
- 정규·정식 리포트인 월간이 오히려 좁은 소스를 봄. "deep intelligence"를 위해 external 원문 소스를 넓혀야 함.

### 확정된 전제 (탐색으로 검증)
- 각 섹션은 이미 `sections.config.js`의 `focus` 프롬프트에 "현상→원인→배경→전망"을 내장 → **별도 전망 섹션 신설 불필요**. 타깃 월만 맞추면 "완료월 정리 + 익월 전망"이 자연 성립.
- 뉴스 아이템은 `loadAllMonthlyItems()` 풀 → `sec.filterItems()`로 섹션별 분배. 이 풀에 병합하는 것이 유일한 통합 지점.
- `filterItems`는 대부분 title·summary_en·source **키워드 매칭** 기반이므로, external 영문 원문이면 섹션 분류가 정상 작동.

---

## Part 1 — 직전 완료월 타깃팅

### 1.1 기본 타깃 월 = 직전 완료월
- `run-section.js`, `assemble-monthly-report.js`의 기본 `MONTH` 계산을 **직전 완료월**로 변경.
  - 계산: 현재월 1일 기준 하루 전 날짜의 `YYYY-MM` (1월 실행 → 전년 12월로 정상 롤오버).
- `--month=YYYY-MM` 오버라이드:
  - `assemble-monthly-report.js` — 이미 존재(`:18`), 유지.
  - `run-section.js` — **신규 추가**. 특정 월 수동 재생성/테스트용.

### 1.2 데이터 앵커 = 타깃월 말일 상한 (발행월 배제)
- **불변식: 발행월(7월) 데이터는 지수에서 완전히 배제. 최신값은 직전월(6월) 마지막 주로 고정.**
- `freight_indices` 조회 쿼리에 상한 `week_date <= <타깃월 말일>` 추가.
  - 대상: `lib/ocean-indices.js:32`(loadGroup), `lib/index-factsheet.js:94`(loadIndexFactsheet), `lib/intra-asia.js:31`(loadIntraRoutes).
- 상한 추가로 `s[0]` = 타깃월 마지막 주, `s[1]`=전주, `s[4]`=전월(약 4주 전) 델타가 완료월 기준으로 정렬됨.
- 타깃월 말일은 run-section.js에서 계산해 각 빌더에 전달(또는 공용 유틸 `monthEndDate(MONTH)`).

### 1.3 영향 파일 (Part 1)
- `generators/report/run-section.js` — MONTH 계산, `--month` 파싱, 타깃월 말일 전달.
- `generators/report/assemble-monthly-report.js` — MONTH 계산.
- `generators/report/lib/ocean-indices.js` — `loadGroup`에 week_date 상한.
- `generators/report/lib/index-factsheet.js` — `loadIndexFactsheet`에 week_date 상한.
- `generators/report/lib/intra-asia.js` — `loadIntraRoutes`에 week_date 상한.

---

## Part 2 — `maritime_news` 병합 (external 원문, 랭킹·캡)

### 2.1 신규 모듈 `generators/report/lib/maritime-news-feed.js`
- Supabase 클라이언트는 기존 lib 파일과 동일 패턴으로 생성(`createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, …)`). **env 가드 필수** — url/key 없으면 조회 없이 `[]` 반환(전체 실행 안 죽임).
- `maritime_news` 조회:
  - `agent_type = 'external'` (원문만. 한글 큐레이션 brief/shipping/corp 제외).
  - 시간 창: `published_at`가 **[타깃월 말일 − 45일, 타깃월 말일]** 이내.
    - 상한 = 타깃월 말일 (발행월 뉴스 배제 — Part 1과 동일 원칙).
    - 하한 = 상한 − 45일 (6월 중심 + late-May 맥락).
- 정규화: `maritime_news` 행 → `latest-news.json` 아이템 형태.
  - 매핑: `title`→`title`, `summary`→`summary_en`, `content`→`content`, `source`→`source`, `url`→`url`, `published_at`→`published_at`.
  - `category`는 latest-news.json의 값 체계(carrier_update/deep_analysis/lane_causal)와 다르므로 `null` 처리 → 키워드 매칭 경로로만 분류(카테고리 분기에는 안 걸림, 의도된 동작).
- export: `loadMaritimeNewsItems({ monthEnd })` → `Promise<Item[]>`.

### 2.2 run-section.js 병합
- 기존 `const allItems = loadAllMonthlyItems();`(동기, 파일) 유지.
- 그 뒤 async 병합:
  ```
  const extraItems = await loadMaritimeNewsItems({ monthEnd });
  const allItems   = dedupeByUrl([...fileItems, ...extraItems]);
  ```
- dedup: 기존 `loadAllMonthlyItems`의 URL Set 로직과 동일 기준(url 우선). latest-news.json과 maritime_news에 동일 기사가 있으면(예: news_global은 양쪽 기록) 1건으로.

### 2.3 랭킹·캡 (토큰 통제, 신규)
- 병합 후 풀이 커지므로(이번 회차 ocean 232건) 섹션별 `filterItems` 결과에 **랭킹+캡** 적용.
- `run-section.js`의 `const items = sec.filterItems(allItems)`를 `rankAndCap(sec.filterItems(allItems), cap)`로 래핑.
- 랭킹: **최신순(`published_at` desc) 1차 + 본문 분량(`summary_en`+`content` 길이) desc 2차.** 결정론적, LLM 비용 0.
- 캡: `sec.maxItems ?? DEFAULT_MONTHLY_ITEM_CAP`.
  - 현재 `maxItems`: index=5(slice로 자체 처리), region=25, macro=30.
  - `DEFAULT_MONTHLY_ITEM_CAP = 40` (신규 상수) — ocean/air/rail 무제한 섹션에 적용.

### 2.4 영향 파일 (Part 2)
- **신규** `generators/report/lib/maritime-news-feed.js`.
- `generators/report/run-section.js` — async 병합 + `rankAndCap`.
- `generators/report/sections.config.js` — `DEFAULT_MONTHLY_ITEM_CAP` 상수(또는 run-section.js 내 상수).

---

## 비목표 (YAGNI)
- 새 "전망 섹션" 신설 안 함 — 기존 focus 프롬프트가 이미 담당.
- 한글 큐레이션(brief/shipping/corp) 기사 병합 안 함 — 자기참조/에코·중복 위험.
- LLM 기반 관련도 스코어링 안 함 — 결정론적 최신순+분량 랭킹으로 충분.
- `collect:monthly` collector 그룹 변경 안 함 — 생성 시점 병합으로 해결(수집 파이프라인 무변경).
- Part 1·Part 2는 독립 — 어느 하나만 먼저 적용해도 동작.

## 검증 기준
- **Part 1:** 7월 초에 `--month` 없이 실행 → 출력 디렉터리 `content/monthly-report/2026-06/`. ocean/index 지수 표의 최신 주가 6월 마지막 주, 7월 데이터 부재. `--month=2026-05` 오버라이드 시 5월 리포트 생성.
- **Part 2:** 병합 후 각 섹션 아이템 수가 캡 이하. maritime_news의 external 기사가 섹션에 반영(예: Loadstar/FreightWaves 기사 등장). 7월 published 기사 부재. Supabase 미설정 시 `[]`로 graceful(크래시 없음).
- 회귀: `section:all` 완주(exit 0), 기존 섹션 구조·프롬프트 불변.
