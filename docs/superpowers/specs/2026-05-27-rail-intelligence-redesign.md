# Rail Intelligence Redesign — Design Spec
**Date:** 2026-05-27  
**Status:** Approved  
**Author:** Claude Code (brainstorming session)

---

## 1. Problem Statement

현재 Logisight 철도 수집기의 한계:

- `rail_tcr.ts`: RailFreight BRI RSS + 영어 매체 4개만. 중국 공식 소스(China Railway, 95306, CRCT) 전무.
- `rail_tsr.ts`: RailFreight Russia + PortNews EN + RZD Partner + Deliver-2 (4개). FESCO, RZD Logistics, TransContainer, KTZ 등 주요 운영사 누락.
- **AI 큐레이션 단계가 파이프라인에 없음.** `latest-news-curated.json`은 수동 작성 상태.

목표: TCR/TSR/중앙아시아 철도 시장의 70%+ 커버 + AI 자동 우선순위 평가·픽.

---

## 2. Scope (In / Out)

### In
- `workers/collectors/rail_cn.ts` 신규 작성 (중국어 공식 8개 소스 + Claude 번역)
- `workers/collectors/rail_ops.ts` 신규 작성 (러시아/CIS 운영사 10개 소스)
- `scripts/curate-rail.js` 신규 작성 (AI 우선순위 평가 + 픽 + 한국어 요약)
- `.github/workflows/daily-rail.yml` 신규 (매일 09:00 KST)
- `.github/workflows/weekly-rail.yml` 신규 (매주 월요일 11:00 KST)
- `workers/collectors/index.ts` 수정: `rail-daily` / `rail-weekly` 그룹 추가
- `package.json` 수정: `collect:rail:daily`, `collect:rail:weekly`, `curate:rail` 스크립트 추가

### Out
- `rail_tcr.ts`, `rail_tsr.ts` 수정 없음 (기존 영어 소스 유지)
- Airtable 연동 없음
- 월간 소스 (China Customs 통계, SCFI 지수) — 기존 `shipping_indices.ts`로 커버
- 2단계 기능 (Sea-Intelligence 구독, ShipsGo API 등) 없음

---

## 3. New Collectors

### 3.1 `rail_cn.ts` — 중국어 공식 소스

**소스 목록 (8개):**

| 소스명 | URL | 타입 | 주기 플래그 |
|--------|-----|------|-------------|
| China Railway 뉴스 | `https://www.china-railway.com.cn/xwzx/zhxw/` | HTML | weekly |
| 95306 | `https://www.95306.cn/` | HTML | weekly |
| CRCT 中欧班列协调 | `https://www.crct.com/index.php?m=content&c=index&a=lists&catid=34` | HTML | weekly |
| 시안 창안호 | `https://www.xaport.net/newabout` | HTML | weekly |
| 청두 국제철도 | `https://cdirs.cdiport.com/` | HTML | weekly |
| 일대일로 포털 | `https://www.yidaiyilu.gov.cn/` | HTML | weekly |
| Global Times BRI | `https://www.globaltimes.cn/rss/outbrain.xml` | RSS | daily |
| Xinhua English | `https://english.news.cn/rss/world.xml` | RSS | daily |

**수집 흐름:**
1. `fetchHtmlLinks()` / `parseRss()` — 기존 패턴 재사용
2. 중국어 제목 아이템만 필터 (`/[一-鿿]/.test(title)`)
3. `translateBatch()` — Claude `claude-haiku-4-5` 1회 API call:
   ```
   입력: [{title, url, source}, ...] (최대 40건)
   프롬프트: 중국어 물류/철도 뉴스 제목 → 영어 번역 + 한 줄 요약
   출력: [{title_en, title_cn, summary_en, url}]
   ```
4. 번역 실패 시 `title_cn` 보존 + `translated: false` 플래그
5. `snapshotWriter()` → `data/snapshots/rail_cn_YYYY-MM-DD.json`

**수집량:** 소스당 max 5건 × 8소스 = 최대 40건/실행

### 3.2 `rail_ops.ts` — 러시아/CIS 운영사 뉴스

**소스 목록 (10개):**

| 소스명 | URL | 타입 | 주기 플래그 |
|--------|-----|------|-------------|
| RZD Official EN | `https://eng.rzd.ru/en/9631?rubricator_id=881` | HTML | weekly |
| RZD Logistics News | `https://rzdlog.com/press-center/news/` | HTML | weekly |
| FESCO News | `https://www.fesco.com/en/press-center/news/` | HTML | daily |
| TransContainer | `https://trcont.com/en/` | HTML | weekly |
| Delo Group | `https://www.delo-group.com/` | HTML | weekly |
| PortNews EN (RSS) | `https://en.portnews.ru/rss/` | RSS | daily |
| SeaNews / Freight.ru | `https://www.freight.ru/en/` | HTML | weekly |
| KTZ Express | `https://www.ktze.kz/en` | HTML | weekly |
| UTLC ERA | `https://www.utlc.com/en/` | HTML | weekly |
| Index1520 | `https://index1520.com/en/` | HTML | weekly |

**주의:** PortNews EN은 기존 `rail_tsr.ts`에도 있음 → `rail_ops.ts`에서는 수집하되 `curate-rail.js`가 중복 URL 제거.

**수집 방식:** 모두 `fetchHtmlLinks()` 또는 `parseRss()` 기반. Playwright는 사용하지 않음 (속도·안정성).

**수집량:** 소스당 max 5건 × 10소스 = 최대 50건/실행

---

## 4. AI 큐레이션 파이프라인 (`scripts/curate-rail.js`)

### 4.1 실행 순서

```
1. content/drafts/latest-news.json 로드 → .rail 배열 추출
2. published_at 기준 최근 24h(daily) 또는 7d(weekly) 필터
3. 중복 URL dedup (seen Set)
4. Claude claude-sonnet-4-6 API 1회 호출 (필터된 items 전달)
5. content/drafts/latest-news-curated.json 덮어쓰기
6. content/drafts/latest-news-curated-YYYY-MM-DD.json 날짜별 보존 복사
```

**Note:** `snapshot_writer.ts`는 모든 collector 결과를 `content/drafts/latest-news.json` 단일 파일에 section별로 통합. `curate-rail.js`는 `.rail` 배열만 읽음.

### 4.2 Claude 프롬프트 상세

**시스템 메시지:**
```
당신은 MTL Shipping Agency의 물류 인텔리전스 에디터입니다.
한국·CIS·중앙아시아 특화 시각으로 뉴스를 평가합니다.
```

**평가 기준 (프롬프트 내 명시):**
```
+3: 한국↔CIS/중앙아시아 노선 직접 영향 (KR-ANDIJAN, KR-ALMATY 등)
+2: 구체적 수치 포함 (운임·물동량·지연일수·TEU)
+2: MTL 핵심 서비스 직결 (TCR/TSR/INSTC/중유럽반열)
+1: 지정학·정책 변화 (러시아 제재, 카자흐 통과세, 중국 운임정책)
-2: 단순 수상·인사 발표
-2: 한국·CIS 노선과 무관 (미주·서유럽 내부 이슈)
```

**출력 스키마:** 기존 `latest-news-curated.json` 구조 그대로
```json
{
  "date": "YYYY-MM-DD",
  "curated_at": "ISO8601",
  "subject": "오늘의 핵심 한 줄",
  "editor_note": "편집장 노트",
  "total_collected": N,
  "total_selected": N,
  "main_story": {
    "title_ko": "...",
    "source": "...",
    "url": "...",
    "importance_score": 7,
    "score_reasons": [...],
    "chapters": {
      "ch1_what": "...",
      "ch2_why_now": "...",
      "ch3_numbers": "...",
      "ch4_action": { "shipper_checkpoint": [...], "mtl_point": "..." },
      "ch5_watch": "..."
    }
  },
  "supporting_news": [...],
  "excluded_articles": [...]
}
```

### 4.3 엣지 케이스

| 상황 | 처리 |
|------|------|
| 스냅샷 파일 없음 | exit(0) + console.warn, 이메일 미발송 |
| 수집 아이템 0건 | exit(0) + console.warn |
| Claude API 오류 | exit(1) + console.error → workflow 실패로 표시 |
| main_story 후보 없음 (모두 score < 6) | 최고점 아이템을 main_story로 강제 선택 |

---

## 5. GitHub Actions 워크플로

### 5.1 `daily-rail.yml`

```yaml
name: Daily Rail Intelligence
on:
  schedule:
    - cron: '0 0 * * *'   # 09:00 KST
  workflow_dispatch:

jobs:
  rail-daily:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - checkout + setup-node@v4 (node 22)
      - npm ci
      - collect:rail:daily   (env: ANTHROPIC_API_KEY)
      - curate:rail           (env: ANTHROPIC_API_KEY)
      - brief:generate
      - send-newsletter.js --html="content/drafts/newsletter-${TODAY}.html"
```

**수집 대상:** Global Times, Xinhua (rail_cn daily), FESCO News, PortNews EN (rail_ops daily)

### 5.2 `weekly-rail.yml`

```yaml
name: Weekly Rail Intelligence
on:
  schedule:
    - cron: '0 2 * * 1'   # 월요일 11:00 KST
  workflow_dispatch:

jobs:
  rail-weekly:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - checkout + setup-node@v4 (node 22)
      - npm ci
      - collect:rail:weekly  (env: ANTHROPIC_API_KEY)
      - curate:rail           (env: ANTHROPIC_API_KEY)
      - brief:generate
      - send-newsletter.js --html="content/drafts/newsletter-${TODAY}.html"
```

**수집 대상:** China Railway, 95306, CRCT, 시안, 청두, 일대일로 (rail_cn weekly), RZD, RZD Logistics, TransContainer, Delo, KTZ, UTLC ERA, Index1520, SeaNews (rail_ops weekly)

---

## 6. `index.ts` 변경 사항

```typescript
// 기존 그룹 유지
// 신규 추가:
{
  name: 'rail-daily',
  collectors: [
    { name: 'rail_cn_daily',  fn: () => collectRailCN({ frequency: 'daily' }) },
    { name: 'rail_ops_daily', fn: () => collectRailOps({ frequency: 'daily' }) },
  ],
},
{
  name: 'rail-weekly',
  collectors: [
    { name: 'rail_cn_weekly',  fn: () => collectRailCN({ frequency: 'weekly' }) },
    { name: 'rail_ops_weekly', fn: () => collectRailOps({ frequency: 'weekly' }) },
  ],
},
```

각 collector는 `{ frequency: 'daily' | 'weekly' }` 옵션을 받아 해당 플래그 소스만 실행.

---

## 7. 파일 변경 요약

| 파일 | 액션 |
|------|------|
| `workers/collectors/rail_cn.ts` | **신규** |
| `workers/collectors/rail_ops.ts` | **신규** |
| `scripts/curate-rail.js` | **신규** |
| `.github/workflows/daily-rail.yml` | **신규** |
| `.github/workflows/weekly-rail.yml` | **신규** |
| `workers/collectors/index.ts` | **수정** (rail-daily/weekly 그룹 추가) |
| `package.json` | **수정** (3개 스크립트 추가) |
| `rail_tcr.ts`, `rail_tsr.ts` | **변경 없음** |

---

## 8. 성공 기준

1. `npm run collect:rail:daily` → 최소 10건 수집, 0 fatal error
2. `npm run collect:rail:weekly` → 최소 30건 수집, 중국어 제목 영어 번역 포함
3. `npm run curate:rail` → `latest-news-curated.json` 생성, `main_story.importance_score >= 6`
4. `npm run brief:generate` → HTML 정상 생성
5. GitHub Actions daily-rail + weekly-rail 워크플로 그린 통과
