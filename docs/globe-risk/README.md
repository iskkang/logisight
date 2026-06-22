# 기상 리스크 지구본 — 실데이터 연결 (Supabase)

지구본 프론트는 Supabase에서 **읽기만** 하고, 예보→리스크 계산은 Edge Function(`risk-refresh`) + pg_cron이 담당한다. 별도 서버 없음.

생성된 파일:

| 파일 | 역할 |
|---|---|
| `supabase/migrations/20260622000034_globe_risk.sql` | 스키마 4개 테이블 + RLS(읽기 anon, 쓰기 service_role) |
| `supabase/migrations/20260622000035_globe_seed.sql` | assets 26개 + routes 5개 시드 (멱등) |
| `supabase/functions/risk-refresh/index.ts` | Open-Meteo 예보 → 리스크 환산 → `asset_risk` upsert |
| `docs/globe-risk/pg_cron.sql` | STEP 6 — 6시간 주기 자동 갱신 (검증 후 1회 실행) |
| `docs/globe-risk/globe-data.js` | 프론트 드롭인 로더 (DB 읽기로 교체) |

> **마이그레이션 파일명 주의:** 스펙은 `0001_` / `0002_` 를 제안했으나, 이 레포는 타임스탬프 규칙(`20260618000033_*.sql`)을 쓴다. `0001_` 은 기존 33개보다 **먼저** 정렬돼 `db push` 순서를 깨뜨리므로 타임스탬프 이름을 사용했다. 내용은 스펙과 동일.

## 실행 순서 (모두 수동 — 레포 관례 `DO NOT APPLY automatically`)

### 1. 스키마 + 시드 적용
```bash
npx supabase db push
# 또는 두 SQL 파일을 Supabase SQL 에디터에 붙여넣어 실행
```

### 2. Edge Function 배포
```bash
npx supabase functions deploy risk-refresh
```
> `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 는 Supabase가 배포 함수에 자동 주입한다.

### 3. 수동 1회 실행 → DB 검증 (자동화 전 필수)
```bash
npx supabase functions invoke risk-refresh
```
SQL 에디터에서:
```sql
select count(*) from public.asset_risk;          -- 26 * 4 = 104 행
select * from public.asset_risk order by score desc limit 10;
```
값이 들어오면 다음 단계로.

### 4. 프론트(지구본) 교체
지구본 HTML의 `<head>` 에 추가:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```
IIFE 안의 하드코딩 배열(`PORTS/CHOKES/ROUTES/SPOTS`)과 합성 함수(`riskAtH`, `nearSpot`)를 삭제하고 `globe-data.js` 내용으로 대체. 호출부 치환·부팅부 async 전환은 `globe-data.js` 하단 주석 참고.

검증: 마커/항로 색·우측 패널·하단 알림이 `asset_risk` DB 값과 일치하는지 확인.

### 5. pg_cron 자동 갱신 (검증 끝난 뒤)
`docs/globe-risk/pg_cron.sql` 의 `<SERVICE_ROLE_KEY>` 를 `.env.local` 의 `SUPABASE_SERVICE_ROLE_KEY` 로 바꿔 SQL 에디터에서 1회 실행.

## 임계값 (실측 보정은 Phase 2)
- 강풍 점수: 돌풍 8→0, 25 m/s→100 (가중 0.45)
- 파고 점수: 1.5→0, 6 m→100 (가중 0.40)
- 강수 점수: 5→0, 40 mm→100 (가중 0.15)
- 등급: score ≥60 `r`(경보), ≥30 `a`(주의), 그 외 `g`

## 범위 밖 (Phase 2)
실제 태풍 트랙(NOAA/JTWC)→`weather_systems`, 해상 구간 자체 예보, Logisight `/globe` 라우트 컴포넌트화, 임계값 실측 보정. 상용 전환 시 Open-Meteo(비상업용)→유료/Meteomatics/StormGlass URL 교체.
