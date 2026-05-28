# Logisight Delta 마이그레이션 가이드

기존 Supabase 프로젝트(`logisight`)에 홈페이지 기능을 추가하는 단계.
기존 테이블 데이터는 보존됩니다.

---

## 사용자님의 기존 스키마 (그대로 활용)

| 테이블 | 용도 | 컬럼 |
|--------|------|------|
| `freight_indices` | 운임 지수 | `index_code`, `value`, `change_pct`, `week_date` |
| `maritime_news` | 뉴스 (다국어) | `title`, `summary`, `lang`, `published_at` 등 |
| `lanes` | 유라시아 노선 (다국어) | `name_en/zh/ru/ko`, `transit_min/max` |
| `delay_index_weekly` | 주간 지연 지표 | `lane_id`, `on_time_rate`, `median_delay_d` |
| `disruption_events` | 차질 이벤트 (다국어) | `category`, `severity`, `affected_lanes` |
| `shipment_legs` | 운송 leg | `lane_id`, `milestone`, `delay_hours` |
| `blank_sailings` | 블랭크 세일링 | `region`, `blanked_teu`, `blank_pct` |
| `bunker_prices` | 벙커 가격 | `grade`, `port`, `price_usd` |
| `schedule_reliability` | 정시율 | `on_time_pct`, `data_type` |

이 9개 테이블은 **건드리지 않습니다.**

---

## 추가되는 7개 테이블 + 1개 확장

### 신규 테이블
1. `weekly_briefings` — AI 주간 인사이트 헤더
2. `weekly_briefing_points` — 브리핑 카드 3개 (시황/기업/글로벌)
3. `policy_alerts` — CBAM, EU ETS, 제재 모니터
4. `newsletter_subscribers` — 구독자
5. `freight_rates` — 화물운임공표 (data.go.kr 적재 대상)
6. `data_updates` — 업데이트 시각 로그

### 기존 테이블 확장
- `maritime_news`에 컬럼 5개 추가:
  - `category` (해상/항공/철도/물류/무역/기업/브리핑/트렌드분석)
  - `agent_type` (shipping/corp/brief)
  - `is_hero` (TRUE면 메인 hero 기사로 노출)
  - `image_url`
  - `tags` (TEXT[])

기존 행은 모두 NULL/FALSE로 채워지므로 **현재 기사 표시 로직에 영향 없음.**

---

## 실행 절차

### Step 1. 마이그레이션 실행 (3분)

Supabase Dashboard → SQL Editor → New query →
`supabase/migrations/002_logisight_additions.sql` 전체 복사 → Run

**확인:** Table Editor에서 6개 새 테이블 보이고, `maritime_news`에 컬럼 5개 추가됐는지.

### Step 2. 시드 데이터 (1분)

같은 방식으로 `supabase/seed.sql` 실행.

**확인:**
- `weekly_briefings`: 1행
- `weekly_briefing_points`: 3행
- `policy_alerts`: 3행
- `freight_rates`: 4행
- `maritime_news`: 기존 행 + 샘플 5건 추가 (`category` 채워진 행)
- `freight_indices`: 기존 데이터 있으면 그대로, 없으면 6건 추가

### Step 3. 코드 파일 교체 (1분)

이 폴더 → `logisight-web/` 프로젝트로 복사:

```bash
# lib/format.ts (신규)
cp lib/format.ts                ../logisight-web/lib/format.ts

# lib/supabase/queries.ts (덮어쓰기 — 기존 mock-only 버전을 교체)
cp lib/supabase/queries.ts      ../logisight-web/lib/supabase/queries.ts

# supabase/ 폴더 통째로 (참고용, 깃에 커밋용)
cp -r supabase/                 ../logisight-web/supabase/
```

PowerShell:
```powershell
Copy-Item lib\format.ts ..\logisight-web\lib\format.ts
Copy-Item lib\supabase\queries.ts ..\logisight-web\lib\supabase\queries.ts
Copy-Item -Recurse supabase ..\logisight-web\
```

> 이전 `supabase-integration/` 폴더에서 받은 다른 파일들(client.ts, server.ts, 컴포넌트들)은 **그대로 유지**. 이 delta는 queries.ts만 교체.

### Step 4. 재시작

```bash
cd logisight-web
npm run dev
```

`.env.local`은 이미 채워져 있어야 함.

---

## 검증

| 확인 항목 | 위치 | 기대 결과 |
|----------|------|----------|
| 운임 지수 | IndexBar (상단) | `freight_indices` 데이터 또는 mock fallback |
| 주간 브리핑 | 메인 영역 상단 | "주간 시장 브리핑" + 3개 카드 표시 |
| 뉴스 hero | 메인 영역 | maritime_news의 `is_hero=true && lang=ko` 기사 |
| 뉴스 그리드 | 메인 영역 | maritime_news에서 카테고리별 4건 |
| 정책 모니터 | 사이드바 | CBAM, EU ETS, 제재 3건 |
| 한국발 노선 | 사이드바 | freight_rates 4건 |
| 유라시아 코리도어 | 사이드바 | **여전히 mock** (lanes 데이터 구조 확인 후 통합 예정) |
| 뉴스레터 | 사이드바 | 이메일 입력 → newsletter_subscribers에 row |
| 업데이트 시각 | IndexBar 오른쪽 끝 | data_updates의 최신 시각 |

---

## 핵심 변경: queries.ts 어떻게 달라졌는가

**기존 (이전 버전):** 제가 만든 가상 스키마 (index_name, week_of 등) 기준

**현재 (이 버전):** 사용자님의 실제 스키마 기준
- `freight_indices`: `index_code` + `value` + `change_pct` + `week_date` 사용
- `maritime_news`: 기존 컬럼 + 추가된 5개 컬럼 사용. `lang='ko'` 필터, `is_hero` 플래그로 hero 분리
- 값 포맷팅은 `lib/format.ts`에서 처리 (DB는 raw number만 저장)

**Eurasia 위젯은 아직 mock:**
사용자님이 `lanes`와 `delay_index_weekly`에 실제로 어떤 노선 데이터가 들어 있는지 확인하고,
"featured 노선 3개"를 어떻게 선정할지 결정한 다음 통합하는 게 안전해요.
지금 무리해서 짜면 mock보다 더 이상하게 나올 수 있음.

---

## 다음 단계 후보

1. **lanes / delay_index_weekly 데이터 확인** →  EurasiaBridge 실데이터 통합
2. **blank_sailings → Hero "블랭크 43편" 스탯 연결** (region 별 합계)
3. **bunker_prices → IndexBar VLSFO 컬럼이 freight_indices 대신 여기서 가져오기**
4. **기존 maritime_news에 categories 채우기 백필 스크립트** (저널리스트 에이전트가 자동으로 채우게 하거나, 일괄 UPDATE)
5. **data.go.kr 어댑터** → freight_rates 자동 적재
6. **저널리스트 에이전트 → maritime_news 자동 INSERT 파이프라인**
