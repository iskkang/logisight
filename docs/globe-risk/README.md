# 기상 리스크 지구본 — 실데이터 연결 (Supabase)

지구본 프론트는 Supabase에서 **읽기만** 하고, 예보→리스크 계산은 Edge Function(`risk-refresh`/`event-ingest`)이 담당한다. 스케줄링은 GitHub Actions(`globe-risk-cron.yml`). 별도 서버 없음.

생성된 파일:

| 파일 | 역할 |
|---|---|
| `supabase/migrations/20260622000034_globe_risk.sql` | 스키마 4개 테이블 + RLS(읽기 anon, 쓰기 service_role) |
| `supabase/migrations/20260622000035_globe_seed.sql` | assets 26개 + routes 5개 시드 (멱등) |
| `supabase/functions/risk-refresh/index.ts` | Open-Meteo 예보 → 리스크 환산 → `asset_risk` upsert (v2: 해저드별) |
| `.github/workflows/globe-risk-cron.yml` | 스케줄러 — risk-refresh 6h / event-ingest 2h 트리거 (pg_cron 대체) |
| `docs/globe-risk/globe-data.js` | 프론트 드롭인 로더 (DB 읽기로 교체, v2 데이터 레이어 포함) |
| **v2** `supabase/migrations/20260622000036_v2_schema.sql` | assets에 'rail'+freeze_prone, asset_risk에 snowfall/temp_min/is_freeze, events 테이블 |
| **v2** `supabase/migrations/20260622000037_v2_assets.sql` | 철도 9 + 결빙 항만 8 = 17개 자산 추가 |
| **v2** `supabase/functions/event-ingest/index.ts` | NHC/GDACS/NWS 글로벌 재해 피드 → `events` |
| **v2** `docs/globe-risk/globe-v2.md` | 지구본 렌더/인터랙션 통합 가이드 (철도·결빙·events 핀) |

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

### 5. 스케줄링 — GitHub Actions (pg_cron 대체)
검증 끝난 뒤 자동화. pg_cron 미사용 (스키마에서 `create extension`도 제거).
1. GitHub repo(logisight) → Settings → Secrets and variables → Actions → **`SUPABASE_FN_KEY`** = anon public 키 (verify_jwt 통과용; 함수가 내부에서 service 키로 DB 씀 — **service_role 키는 워크플로에 넣지 말 것**).
2. `.github/workflows/globe-risk-cron.yml` 가 **기본 브랜치(main)** 에 있어야 cron이 돈다. 커밋·푸시 후 Actions 탭 → **Run workflow** 로 1회 수동 실행 → Supabase에서 `asset_risk`·`events` 갱신 확인.
3. risk-refresh 6h / event-ingest 2h. GitHub cron은 정시 보장이 아니라 best-effort(수 분 지연 가능 — 6h/2h 주기엔 무방).

## v2 실행 순서 (v1 완료 후, 모두 수동)

```bash
# 1. 스키마 변경 + 자산 추가
npx supabase db push        # 또는 ...036/...037 두 SQL 에디터 실행

# 2. 함수 (재)배포 — risk-refresh 교체 + event-ingest 신규
npx supabase functions deploy risk-refresh
npx supabase functions deploy event-ingest

# 3. 수동 1회 실행
npx supabase functions invoke risk-refresh   # → {"updated": 172}  (43 assets × 4)
npx supabase functions invoke event-ingest   # → {"events": N}     (활성 재해 수, 0도 정상)
```
검증:
```sql
select count(*) from public.asset_risk;   -- 43 * 4 = 172 (v1 104 → v2 172)
-- 겨울이면 폭설/한파/결빙 driver 확인
select asset_id,horizon_days,score,level,driver from public.asset_risk
 where asset_id in ('osh','khorgos','stpetersburg','vladivostok') order by 1,2;
select source,count(*) from public.events group by source;   -- 피드 적재 (계절·활성 여부에 따라 0 가능)
```
> 172보다 적으면 v2 자산 17개(`...037`) 미적재 의심 → `select count(*) from public.assets;` = **43** 확인.
> `events`가 0이면 정상일 수 있음(현재 활성 재해 없음) — 함수 응답·로그로 fetch 성공 여부부터 확인.

### 4. 프론트(지구본) v2 교체
`globe-data.js`는 이미 v2 데이터 레이어 반영됨. 렌더/인터랙션(철도 ■·결빙항만 링·events 핀·알림 병합) 편집은 **`globe-v2.md`** 단계대로 적용.

### 5. 스케줄링
risk-refresh·event-ingest 둘 다 위 **GitHub Actions**(`globe-risk-cron.yml`)가 트리거한다 (v1 §5 참고). v2에서 추가 cron 설정 없음.

## 임계값 (실측 보정은 Phase 3)
- (해상) 강풍: 돌풍 8→0, 25 m/s→100 · 파고: 1.5→0, 6 m→100
- (철도) 폭설: 5→0, 40 cm→100 · 한파(일최저): −15→0, −40℃→100
- (결빙항만) 결빙(일최고<0): 0→0, −15℃→100 (score ≥30 → `is_freeze`)
- 강수(보조, ×0.7): 5→0, 40 mm→100
- v2 점수 = **최악 해저드 단일 점수** (v1 가중합과 다름). 등급: ≥60 `r`, ≥30 `a`, 그 외 `g`

## 범위 밖 (Phase 3)
전 지구 GRIB 격자 스캔(GFS/ECMWF, Python 워커), Copernicus Marine 실제 해빙 농도, Meteoalarm(유럽)·JTWC(서태평양) 피드, 임계값 실측 보정. 상용 전환 시 Open-Meteo(비상업용)→유료/Meteomatics/StormGlass URL 교체.
