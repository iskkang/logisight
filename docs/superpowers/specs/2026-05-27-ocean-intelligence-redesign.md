# Ocean Freight Intelligence Redesign — Design Spec
**Date:** 2026-05-27  
**Status:** Approved  
**Author:** Claude Code (brainstorming session)

---

## 1. Problem Statement

현재 Logisight 해상 수집기 현황:

| 파일 | 커버 | 상태 |
|------|------|------|
| `shipping_indices.ts` | BDI·WCI·FBX·SCFI·KCCI·CCFI | ✅ 유지 |
| `blank_sailing.ts` | EconDB 7개 리전 blank sailing | ✅ 유지 |
| `news_global.ts` | Loadstar·Splash247·FreightWaves·SupplyChainDive·TTNews | ✅ 유지 |
| 선사 Advisory 페이지 | Maersk·MSC·CMA·Hapag·ONE·HMM·COSCO·Yang Ming | ❌ 전무 |
| Chokepoint 리스크 | UKMTO·Panama·Suez | ❌ 전무 |
| 항만 월간 통계 | LA·LB·Singapore·Rotterdam·Antwerp | ❌ 전무 |
| 해상 전문뉴스 추가 | Container News·Hellenic·Seatrade·Sea-Intel·gCaptain | ❌ 미수집 |
| AI 큐레이션 파이프라인 | curate-ocean.js | ❌ 없음 |

목표: 선사 advisory(실무 최우선) + chokepoint 리스크 + 해상 뉴스 + 항만 통계를 자동 수집하고, AI가 한국 화주·MTL 영업 관점에서 뉴스레터 픽을 자동 생성.

---

## 2. Scope (In / Out)

### In
- `workers/collectors/carrier_advisories.ts` 신규 (선사 8개, Playwright)
- `workers/collectors/ocean_news.ts` 신규 (해상 뉴스 6개, RSS/fetch)
- `workers/collectors/chokepoints.ts` 신규 (UKMTO·Panama·Suez·BIMCO, fetch)
- `workers/collectors/port_stats.ts` 신규 (5개 항만 월간 TEU, Supabase 직접 저장)
- `scripts/curate-ocean.js` 신규 (AI 해상 큐레이션)
- `.github/workflows/daily-ocean.yml` 신규 (매일 09:30 KST)
- `.github/workflows/weekly-ocean.yml` 신규 (매주 목요일 11:00 KST)
- `workers/collectors/index.ts` 수정: `ocean-daily` / `ocean-weekly` 그룹 추가
- `workers/collectors/utils/snapshot_writer.ts` 수정: `carrier_advisory`·`risk` section 추가
- `package.json` 수정: 3개 스크립트 추가
- `supabase/migrations/20260527000010_port_throughput.sql` 신규 (port_throughput 테이블)

### Out
- `shipping_indices.ts`, `blank_sailing.ts`, `news_global.ts` 수정 없음
- 기존 daily-news.yml 수정 없음
- Airtable 연동 없음
- curate-rail.js와 병합 없음 (각자 독립 실행)
- 2단계: Linerlytica 유료 API, Lloyd's List, ShippingWatch 유료 데이터

---

## 3. New Collectors

### 3.1 `carrier_advisories.ts` — 선사 8개 (Playwright)

**목적:** 선사 advisory는 blank sailing·surcharge·항만 omission·서비스 중단이 운임 지수보다 먼저 공지됨. 실무 최우선 소스.

**수집 방식:** Playwright chromium 1개 인스턴스, 8개 사이트 순차 방문. `section: 'carrier_advisory'`.

| 선사 | URL | 셀렉터 전략 |
|------|-----|------------|
| Maersk | `https://www.maersk.com/news` | `article a, .news-card a, [data-test="news-item"] a` |
| MSC | `https://www.msc.com/en/newsroom/customer-advisories` | `.advisory-item a, article a, h3 a` |
| CMA CGM | `https://www.cma-cgm.com/latest-news` | `.news-item a, article a, h2 a` |
| Hapag-Lloyd | `https://www.hapag-lloyd.com/en/services-information/operational-updates/overview.html` | `.update-item a, .news-list a, article a` |
| ONE | `https://www.one-line.com/en/news/156/all-years/all-months` | `.news-list a, article a, h3 a` |
| HMM | `https://www.hmm21.com/company/newsList.do` | `.board-list a, td a, .title a` |
| COSCO | `https://lines.coscoshipping.com/` | `.news-item a, article a, h2 a` |
| Yang Ming | `https://www.yangming.com/en/about_us/news/notice` | `.notice-list a, article a, h3 a` |

**키워드 태깅:** 제목에 아래 키워드 포함 시 `importance_hint: 'high'` 자동 부여:
```
blank sailing, void sailing, service suspension, port omission,
surcharge, GRI, PSS, EFS, war risk, Red Sea, disruption, deviation
```

**수집량:** 선사당 최대 5건 × 8선사 = 최대 40건/실행  
**타임아웃:** 페이지당 20초. 실패 시 `is_complete: false` + 다음 선사 진행 (전체 중단 없음).

---

### 3.2 `ocean_news.ts` — 해상 전문뉴스 (RSS/fetch)

**목적:** 기존 `news_global.ts`에 없는 컨테이너·해운 전문 매체 추가. 기존 파일 건드리지 않음.

| 소스 | URL | 타입 | 주기 플래그 |
|------|-----|------|-------------|
| Container News | `https://container-news.com/feed/` | RSS | daily |
| Hellenic Shipping News | `https://www.hellenicshippingnews.com/feed/` | RSS | daily |
| Seatrade Maritime | `https://www.seatrade-maritime.com/feed/` | RSS | daily |
| Maritime Executive | `https://maritime-executive.com/feed/` | RSS | daily |
| gCaptain | `https://gcaptain.com/feed/` | RSS | daily |
| Sea-Intelligence Press Room | `https://www.sea-intelligence.com/press-room` | HTML | weekly |

**키워드 필터 (daily RSS):** 아래 키워드 없는 기사 드롭 (노이즈 제거):
```
container, blank sailing, surcharge, congestion, port, GRI, void,
omission, freight rate, schedule, carrier, shipping, disruption
```

**수집량:** 소스당 최대 5건 × 6소스 = 최대 30건/실행

---

### 3.3 `chokepoints.ts` — 항로 리스크 (fetch)

**목적:** Red Sea 인시던트·파나마 흘수 제한·수에즈 통항 변경은 운임 상승의 선행 지표. `section: 'risk'`.

| 소스 | URL | 타입 | 주기 플래그 |
|------|-----|------|-------------|
| UKMTO Recent Incidents | `https://www.ukmto.org/recent-incidents` | HTML | daily |
| Panama Canal Advisories | `https://pancanal.com/en/maritime-services/advisory-to-shipping/` | HTML | weekly |
| Suez Canal Authority | `https://www.suezcanal.gov.eg/` | HTML | weekly |
| BIMCO News | `https://www.bimco.org/news` | HTML | weekly |

**UKMTO 파싱:** incident 제목 + 날짜 + 위치(region) 추출.  
region 자동 분류: `Red Sea` / `Indian Ocean` / `Gulf of Aden` / `Gulf of Oman` / `Other`.

**수집량:** 최대 20건/실행  
**AI 큐레이션 가중치:** `risk` section 아이템은 자동으로 +2점 적용.

---

### 3.4 `port_stats.ts` — 항만 월간 통계 (Supabase 직접 저장)

**목적:** 월간 TEU 수치는 뉴스가 아닌 구조화 데이터. `snapshotWriter` 대신 `dbUpsert`로 직행. `curate-ocean.js`가 최근 2개월 수치를 Claude 컨텍스트로 주입.

| 항만 | URL | 수집 방식 | 주기 |
|------|-----|----------|------|
| Port of LA | `https://portoflosangeles.org/business/statistics/container-statistics` | HTML 테이블 파싱 | monthly |
| Port of Long Beach | `https://polb.com/business/port-statistics/` | HTML 파싱 | monthly |
| Singapore MPA | `https://data.gov.sg/datasets/d_da030f7028200d19ffcbe4a2d71af39c/view` | CSV fetch | monthly |
| Rotterdam | `https://www.portofrotterdam.com/en/experience-online/facts-and-figures` | HTML 파싱 | quarterly |
| Antwerp-Bruges | `https://www.portofantwerpbruges.com/en/our-port/facts-and-figures` | HTML 파싱 | quarterly |

**DB 스키마 (신규 마이그레이션 006):**
```sql
CREATE TABLE port_throughput (
  id           BIGSERIAL PRIMARY KEY,
  port_code    TEXT NOT NULL,  -- 'LA', 'LB', 'SGP', 'RTM', 'ANT'
  year         INT  NOT NULL,
  month        INT  NOT NULL,  -- 1~12 (quarterly: 마지막 월 사용)
  teu          BIGINT,
  source       TEXT,
  source_url   TEXT,
  fetched_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(port_code, year, month)
);
ALTER TABLE port_throughput ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read" ON port_throughput FOR SELECT TO anon USING (true);
```

**주의:** 이미 저장된 수치는 UPSERT로 덮어씀 (월이 같으면 최신값 유지).

---

## 4. AI 큐레이션 파이프라인 (`scripts/curate-ocean.js`)

### 4.1 실행 순서

```
1. content/drafts/latest-news.json 로드
   → .shipping + .carrier_advisory + .risk 배열 추출
2. published_at 기준 필터 (daily: 24h / weekly: 7d)
3. 중복 URL dedup
4. Supabase에서 port_throughput 최근 2개월 데이터 로드 → 컨텍스트 문자열 생성
5. Claude claude-sonnet-4-6 1회 API call
6. content/drafts/latest-news-curated.json 덮어쓰기
7. content/drafts/latest-news-curated-YYYY-MM-DD.json 날짜별 보존
```

### 4.2 Claude 프롬프트 상세

**시스템 메시지:**
```
당신은 MTL Shipping Agency의 해운 인텔리전스 에디터입니다.
한국·CIS·극동러시아 항로 특화 시각으로 평가합니다.
```

**평가 기준:**
```
+3: 한국↔유럽/미주/CIS 노선 직접 영향 (FAR EAST, TPEB, Korea-Russia)
+3: Blank Sailing / Void Sailing / Service Suspension 선사 공지
+2: 운임 수치 포함 (WCI·SCFI·FBX 변동폭, $/FEU)
+2: Red Sea / Suez / Panama / Hormuz 실제 인시던트 또는 제한
+2: Surcharge 신설·인상 공지 (GRI·PSS·EFS·WAR RISK)
+1: 항만 혼잡·대기 시간 정보
+1: 스케줄 정시성 변화
-2: 수상·인사 발표, 기업 M&A
-2: 미주·유럽 내부 이슈 (한국 화주 직접 무관)
-3: 광고성·홍보 자료
```

**port_throughput 컨텍스트 주입 (예시):**
```
[항만 최신 현황]
- LA항: 2026-04 = 850,234 TEU (전월 대비 +3.2%)
- LB항: 2026-04 = 720,891 TEU (전월 대비 -1.8%)
- Singapore: 2026-04 = 3,421,000 TEU (전월 대비 +0.5%)
```

**선사 Advisory 특별 처리:**
- `importance_hint: 'high'` 아이템: 점수 +1 자동 부여
- 같은 항로/노선에서 2개 이상 선사 동시 공지 시 → main_story 후보 우선 지정

**출력 스키마:** rail과 동일한 `latest-news-curated.json` 구조 (main_story 5챕터 + supporting_news 최대 4건)

### 4.3 엣지 케이스

| 상황 | 처리 |
|------|------|
| 수집 아이템 0건 | exit(0) + console.warn, 이메일 미발송 |
| Supabase port_throughput 조회 실패 | 컨텍스트 없이 진행 (optional) |
| Claude API 오류 | exit(1) → workflow 실패 표시 |
| main_story 후보 없음 (score < 6) | 최고점 아이템 강제 선택 |
| carrier_advisory만 있고 shipping/risk 없음 | carrier_advisory를 main_story로 처리 |

---

## 5. snapshot_writer.ts 수정

기존 section 목록에 `carrier_advisory`·`risk` 추가:

```typescript
// 변경 전
return { date: '', shipping: [], air: [], rail: [], trade: [] };

// 변경 후
return { date: '', shipping: [], air: [], rail: [], trade: [],
         carrier_advisory: [], risk: [] };
```

`section in output` 체크가 기존 로직을 그대로 사용하므로 이 한 줄 추가로 동작.

---

## 6. GitHub Actions 워크플로

### 6.1 `daily-ocean.yml` — 매일 09:30 KST (UTC 00:30)

기존 `daily-news.yml`(09:00 KST)과 30분 간격. 동일 파일 쓰기 충돌 방지.

```yaml
name: Daily Ocean Intelligence
on:
  schedule:
    - cron: '30 0 * * *'   # 09:30 KST
  workflow_dispatch:

jobs:
  ocean-daily:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Collect ocean daily
        run: npm run collect:ocean:daily
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      - name: Curate ocean
        run: npm run curate:ocean
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      - name: Generate brief
        run: npm run brief:generate
      - name: Send newsletter
        run: |
          TODAY=$(date +%Y-%m-%d)
          HTML_PATH="content/drafts/newsletter-${TODAY}.html"
          if [ -f "$HTML_PATH" ]; then
            node scripts/send-newsletter.js --html="$HTML_PATH"
          fi
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          SEND_TO: ${{ secrets.INTERNAL_EMAIL }}
```

**수집 대상 (daily):**
- `carrier_advisories.ts` (전체 8선사)
- `ocean_news.ts` (daily 소스: Container News, Hellenic, Seatrade, Maritime Executive, gCaptain)
- `chokepoints.ts` (UKMTO daily)

### 6.2 `weekly-ocean.yml` — 매주 목요일 02:00 UTC (11:00 KST)

목요일 = Drewry WCI 발표일. 주간 운임 지수 공개 직후 큐레이션.

```yaml
name: Weekly Ocean Intelligence
on:
  schedule:
    - cron: '0 2 * * 4'   # 목요일 02:00 UTC
  workflow_dispatch:

jobs:
  ocean-weekly:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      # (daily와 동일 setup)
      - name: Collect ocean weekly
        run: npm run collect:ocean:weekly
        # (daily 소스 전체 + weekly 추가)
      - name: Curate ocean (7d)
        run: npm run curate:ocean -- --window=7d
        # curate-ocean.js: process.argv.find(a => a.startsWith('--window='))
        # → '7d' = 7일치 필터, 없으면 기본값 24h
      - name: Generate brief + Send
        # (daily와 동일)
```

**수집 대상 (weekly = daily + 추가):**
- 위 daily 소스 전체
- `ocean_news.ts` weekly: Sea-Intelligence Press Room
- `chokepoints.ts` weekly: Panama·Suez·BIMCO
- `port_stats.ts`: 월간 TEU 업데이트 (새 달 데이터 있을 때만)

---

## 7. `index.ts` 추가 그룹

```typescript
import { collect as collectCarrierAdvisories } from './carrier_advisories';
import { collect as collectOceanNews }          from './ocean_news';
import { collect as collectChokepoints }        from './chokepoints';
import { collect as collectPortStats }          from './port_stats';

// 신규 그룹
{
  name: 'ocean-daily',
  collectors: [
    { name: 'carrier_advisories', fn: collectCarrierAdvisories },
    { name: 'ocean_news_daily',   fn: () => collectOceanNews({ frequency: 'daily' }) },
    { name: 'chokepoints_daily',  fn: () => collectChokepoints({ frequency: 'daily' }) },
  ],
},
{
  name: 'ocean-weekly',
  collectors: [
    { name: 'carrier_advisories',  fn: collectCarrierAdvisories },
    { name: 'ocean_news_weekly',   fn: () => collectOceanNews({ frequency: 'weekly' }) },
    { name: 'chokepoints_weekly',  fn: () => collectChokepoints({ frequency: 'weekly' }) },
    { name: 'port_stats',          fn: collectPortStats },
  ],
},
```

---

## 8. `package.json` 신규 스크립트

```json
"collect:ocean:daily":  "ts-node --project tsconfig.workers.json workers/collectors/index.ts ocean-daily",
"collect:ocean:weekly": "ts-node --project tsconfig.workers.json workers/collectors/index.ts ocean-weekly",
"curate:ocean":         "node scripts/curate-ocean.js"
```

---

## 9. 파일 변경 요약

| 파일 | 액션 |
|------|------|
| `workers/collectors/carrier_advisories.ts` | **신규** |
| `workers/collectors/ocean_news.ts` | **신규** |
| `workers/collectors/chokepoints.ts` | **신규** |
| `workers/collectors/port_stats.ts` | **신규** |
| `scripts/curate-ocean.js` | **신규** |
| `.github/workflows/daily-ocean.yml` | **신규** |
| `.github/workflows/weekly-ocean.yml` | **신규** |
| `supabase/migrations/20260527000010_port_throughput.sql` | **신규** |
| `workers/collectors/index.ts` | **수정** (ocean-daily/weekly 그룹) |
| `workers/collectors/utils/snapshot_writer.ts` | **수정** (1줄: carrier_advisory/risk section) |
| `package.json` | **수정** (3개 스크립트) |
| `shipping_indices.ts`, `blank_sailing.ts`, `news_global.ts` | **변경 없음** |

---

## 10. 성공 기준

1. `npm run collect:ocean:daily` → 최소 20건 수집 (carrier_advisory ≥ 8, risk ≥ 2)
2. `npm run collect:ocean:weekly` → 최소 40건 수집, port_throughput Supabase 저장 확인
3. `npm run curate:ocean` → `latest-news-curated.json` 생성, carrier_advisory가 supporting_news 또는 main_story에 포함
4. `npm run brief:generate` → HTML 정상 생성
5. GitHub Actions daily-ocean + weekly-ocean 워크플로 그린 통과
6. `port_throughput` 테이블 RLS 정책 활성화 확인
