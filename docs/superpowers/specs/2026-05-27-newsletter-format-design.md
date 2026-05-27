# Newsletter Format Redesign — Design Spec
**Date:** 2026-05-27  
**Status:** Approved  
**Depends on:** rail-intelligence-redesign.md, ocean-intelligence-redesign.md

---

## 1. 변경 배경

기존 `daily-news.yml` + `generate-brief.js` 파이프라인을 완전히 교체.  
오늘 설계한 철도·해상 수집기를 기반으로 **단일 unified 뉴스레터**를 발행.

---

## 2. Scope

### 삭제
- `.github/workflows/daily-news.yml` (기존 뉴스레터 워크플로 전체 삭제)

### 신규
- `scripts/curate-rail.js` — 철도 AI 큐레이션 (rail spec 참조, 이 파일 신규 작성)
- `scripts/curate-ocean.js` — 해상 AI 큐레이션 (ocean spec 참조, 이 파일 신규 작성)
- `scripts/generate-newsletter.js` — 새 HTML 템플릿 (generate-brief.js 교체)
- `.github/workflows/daily-newsletter.yml` — 통합 일간 워크플로
- `.github/workflows/weekly-newsletter.yml` — 통합 주간 워크플로

### 유지 (변경 없음)
- `scripts/generate-brief.js` — 삭제하지 않음 (CADI 보고서 등 다른 용도 사용 여부 확인 필요). 단, newsletter 파이프라인에서는 더 이상 호출하지 않음.
- `.github/workflows/market-collectors.yml` — 운임 지수·블랭크 세일링 수집 (뉴스레터와 독립)
- `.github/workflows/cadi-ingest.yml` — CADI 트래킹 (뉴스레터와 독립)

---

## 3. 큐레이션 출력 스키마 (신규)

curate-rail.js와 curate-ocean.js는 각각 아래 스키마로 출력.  
기존 `latest-news-curated.json` 스키마 **대체**.

### `content/drafts/curated-rail.json`
```json
{
  "date": "YYYY-MM-DD",
  "curated_at": "ISO8601",
  "section": "rail",
  "main": {
    "title": "제목 (영어 또는 한국어)",
    "title_ko": "한국어 제목",
    "url": "원본 기사 URL",
    "source": "출처명",
    "image_url": "Unsplash 이미지 URL (선택)",
    "what": "≤200자. 무슨 일이 일어났나.",
    "why_now": "≤200자. 왜 지금 중요한가.",
    "checkpoint": "≤200자. 화주·포워더가 지금 할 일.",
    "importance_score": 7
  },
  "links": [
    { "title": "제목2", "title_ko": "한국어 제목2", "url": "URL2", "source": "출처2" },
    { "title": "제목3", "title_ko": "한국어 제목3", "url": "URL3", "source": "출처3" }
  ],
  "total_collected": 25,
  "excluded_count": 22
}
```

### `content/drafts/curated-ocean.json`
```json
{
  "date": "YYYY-MM-DD",
  "curated_at": "ISO8601",
  "section": "ocean",
  "main": { ... (rail과 동일 구조) ... },
  "links": [ ... (동일) ... ],
  "total_collected": 40,
  "excluded_count": 37
}
```

**핵심 제약:**
- `what`, `why_now`, `checkpoint` 각 필드: **200자(bytes 아닌 문자 기준) 초과 시 Claude 프롬프트에서 강제 단축**
- `mtl_point` 필드: **삭제** (curate-rail.js, curate-ocean.js 모두)
- `ch4_action.mtl_point` 필드: **삭제**
- links는 정확히 2개 (부족하면 null 대신 빈 배열 허용, generate-newsletter.js가 graceful 처리)

---

## 4. Claude 프롬프트 변경 (curate-rail.js + curate-ocean.js 공통)

### 기존에서 제거
```
# 삭제
mtl_point (MTL 영업 포인트)
ch5_watch (Watch 섹션)  ← 생략
ch4_action.mtl_point
score_reasons (내부 필드, 출력 불필요)
```

### 길이 제약 프롬프트 추가
```
출력 규칙:
- what: 200자 이하. 핵심 사실 1~2문장.
- why_now: 200자 이하. 지금 중요한 이유 1~2문장.
- checkpoint: 200자 이하. 화주·포워더 즉시 행동 1가지.
- mtl_point: 출력하지 말 것.
- links 제목: 영어 원문 + 한국어 번역 모두 포함.
```

---

## 5. HTML 템플릿 (`scripts/generate-newsletter.js`)

**입력:** `content/drafts/curated-rail.json` + `content/drafts/curated-ocean.json`  
**출력:** `content/drafts/newsletter-YYYY-MM-DD.html`

### 레이아웃 구조

```
┌──────────────────────────────────────┐
│  헤더 (Logisight Daily / Weekly)      │
├──────────────────────────────────────┤
│  🚂 RAIL — 메인 스토리               │
│    이미지 (220px)                     │
│    제목 (한국어)                      │
│    What:       ≤200자 본문            │
│    Why Now:    ≤200자 본문            │
│    체크포인트: ≤200자 본문            │
│    [원문 보기 →]                      │
├──────────────────────────────────────┤
│  Rail 추가 뉴스                       │
│    ▶ 제목2  (원본 URL 링크)           │
│    ▶ 제목3  (원본 URL 링크)           │
├──────────────────────────────────────┤
│  🚢 OCEAN — 메인 스토리              │
│    이미지 (220px)                     │
│    제목 (한국어)                      │
│    What:       ≤200자 본문            │
│    Why Now:    ≤200자 본문            │
│    체크포인트: ≤200자 본문            │
│    [원문 보기 →]                      │
├──────────────────────────────────────┤
│  Ocean 추가 뉴스                      │
│    ▶ 제목2  (원본 URL 링크)           │
│    ▶ 제목3  (원본 URL 링크)           │
├──────────────────────────────────────┤
│  CTA + Footer                        │
└──────────────────────────────────────┘
```

### 구현 세부

- **이미지:** `main.image_url` 있으면 표시, 없으면 섹션 색상 배경 (#EFF6FF rail / #F0FDF4 ocean)
- **추가 뉴스 링크:** `<a href="${item.url}" target="_blank">${item.title_ko || item.title}</a>` — 직접 원본 URL 연결
- **섹션 구분:** 철도 = 남색(#1B4D8C) 테마, 해상 = 청록(#0E7490) 테마
- **빠진 섹션 graceful 처리:** curated-rail.json 없으면 Rail 섹션 생략, ocean도 동일
- **safeUrl 함수 유지:** 홈페이지 URL이거나 blocked domain이면 Google Search 링크로 대체

---

## 6. 통합 워크플로

### `daily-newsletter.yml` — 매일 09:00 KST (UTC 00:00)

```yaml
name: Daily Newsletter
on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  newsletter:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - checkout + setup-node@v4 (node 22)
      - npm ci
      - npx playwright install --with-deps chromium

      - name: Collect rail (daily)
        run: npm run collect:rail:daily
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Collect ocean (daily)
        run: npm run collect:ocean:daily
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Curate rail
        run: npm run curate:rail
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Curate ocean
        run: npm run curate:ocean
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Generate newsletter HTML
        run: npm run newsletter:generate

      - name: Send newsletter
        run: |
          TODAY=$(date +%Y-%m-%d)
          HTML_PATH="content/drafts/newsletter-${TODAY}.html"
          if [ -f "$HTML_PATH" ]; then
            node scripts/send-newsletter.js --html="$HTML_PATH"
          else
            echo "⚠️ HTML 없음 — 발송 스킵"
          fi
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          SEND_TO: ${{ secrets.INTERNAL_EMAIL }}
```

### `weekly-newsletter.yml` — 매주 목요일 02:00 UTC (11:00 KST)

```yaml
name: Weekly Newsletter
on:
  schedule:
    - cron: '0 2 * * 4'   # 목요일 (WCI 발표일)
  workflow_dispatch:

jobs:
  weekly:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    steps:
      # (daily와 동일 setup)
      - name: Collect rail (weekly)
        run: npm run collect:rail:weekly
      - name: Collect ocean (weekly)
        run: npm run collect:ocean:weekly
      - name: Curate rail (7d)
        run: npm run curate:rail -- --window=7d
      - name: Curate ocean (7d)
        run: npm run curate:ocean -- --window=7d
      - name: Generate + Send
        # (daily와 동일)
```

---

## 7. `package.json` 신규 스크립트

```json
"curate:rail":          "node scripts/curate-rail.js",
"curate:ocean":         "node scripts/curate-ocean.js",
"newsletter:generate":  "node scripts/generate-newsletter.js"
```

**삭제 대상 스크립트:**
- `"brief:generate": "node scripts/generate-brief.js"` — newsletter 파이프라인에서 제거 (파일 자체는 유지)

---

## 8. 파일 변경 요약

| 파일 | 액션 |
|------|------|
| `.github/workflows/daily-news.yml` | **삭제** |
| `.github/workflows/daily-newsletter.yml` | **신규** |
| `.github/workflows/weekly-newsletter.yml` | **신규** |
| `scripts/curate-rail.js` | **신규** |
| `scripts/curate-ocean.js` | **신규** |
| `scripts/generate-newsletter.js` | **신규** |
| `package.json` | **수정** (curate:rail, curate:ocean, newsletter:generate 추가) |
| `.github/workflows/daily-rail.yml` | **삭제** (daily-newsletter.yml로 통합) |
| `.github/workflows/daily-ocean.yml` | **삭제** (daily-newsletter.yml로 통합) |
| `.github/workflows/weekly-rail.yml` | **삭제** (weekly-newsletter.yml로 통합) |
| `.github/workflows/weekly-ocean.yml` | **삭제** (weekly-newsletter.yml로 통합) |
| `scripts/generate-brief.js` | **유지** (다른 용도, newsletter 파이프라인에서 제외) |
| `content/drafts/latest-news-curated.json` | **더 이상 생성 안 함** (curated-rail.json / curated-ocean.json으로 교체) |

**Note:** daily-rail.yml, daily-ocean.yml, weekly-rail.yml, weekly-ocean.yml은 ocean/rail 스펙에서 각각 설계했으나 daily-newsletter.yml + weekly-newsletter.yml로 통합됨.

---

## 9. 성공 기준

1. `npm run collect:rail:daily && npm run curate:rail` → `content/drafts/curated-rail.json` 생성, main.what ≤ 200자
2. `npm run collect:ocean:daily && npm run curate:ocean` → `content/drafts/curated-ocean.json` 생성
3. `npm run newsletter:generate` → `newsletter-YYYY-MM-DD.html` 생성, 철도+해상 2개 메인 + 4개 링크 포함
4. HTML에 MTL 영업 포인트 섹션 없음
5. HTML 링크 클릭 시 원본 기사 URL 직접 열림
6. GitHub Actions `daily-newsletter` 워크플로 그린 통과
7. 구 `daily-news.yml` 삭제 확인
