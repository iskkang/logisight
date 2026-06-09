# Design: IMF Portwatch 기반 Red Sea 우회율 자동 수집

**Date:** 2026-06-09  
**Status:** Approved

## 배경

기존 `red_sea_diversion` 테이블은 어드민이 격주로 Drewry Red Sea Diversion Tracker에 수동 로그인해 케이프 우회율을 입력하는 구조였다. 데이터 입력이 누락되면 `forecast-diversion-check.yml`이 exit 1로 실패했다. IMF Portwatch는 수에즈 운하 일별 통과 선박 수를 무료 공개 API로 제공하므로, 이를 자동 수집으로 대체한다.

## 목표

- `red_sea_diversion` 테이블을 매주 화요일 자동으로 채운다
- 하위 코드(`diversion.js`, `buildDiversion`, 생성 파이프라인)는 변경하지 않는다
- 기존 수동 체크 워크플로우(`forecast-diversion-check.yml`)를 삭제하고 자동화 버전으로 교체한다

## 데이터 소스

**IMF Portwatch ArcGIS REST API**

```
https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query
```

- 수에즈 운하 ID: `chokepoint1`
- 핵심 필드: `date`, `n_container` (일별 컨테이너선 통과 수)
- 갱신 주기: 매주 화요일
- 인증 불필요 (공개)

## 방법론: cape_share_pct 산출

```
baseline     = 2023년 1~10월 평균 일별 컨테이너 통과 수 (Red Sea 위기 이전)
current_avg  = 최근 7일 평균 n_container
deviation    = (baseline - current_avg) / baseline
cape_share_pct = clamp(round(deviation × 100), 0, 100)
```

수에즈 통과량이 감소한 비율 = 케이프로 우회한 비율로 해석하는 업계 표준 접근법.  
`baseline`은 구현 시 API에서 일회성 조회 후 상수로 하드코딩한다.

**기존 계수 유효성:** `COEF_PER_CAPE_PT = -0.12`는 Δcape_share(두 회독 간 변화량)에 적용되므로, 절대값 소스가 바뀌어도 내부 일관성이 유지되면 계산이 성립한다.

## 변경 범위

### 새 파일

| 파일 | 역할 |
|------|------|
| `generators/web/forecast/inputs/portwatch-diversion.js` | API fetch + cape_share_pct 계산 (순수 함수 + async) |
| `generators/web/forecast/persist-diversion.js` | 오케스트레이터: fetch → `red_sea_diversion` upsert |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.github/workflows/forecast-diversion-check.yml` | 삭제 후 신규 자동화 버전으로 교체 |
| `package.json` | `"forecast:diversion"` 스크립트 추가 |

### 변경 없음

- `red_sea_diversion` 테이블 스키마
- `generators/web/forecast/inputs/diversion.js` (buildDiversion, fetchDiversion)
- `generators/web/forecast/check-diversion.js`
- `.github/workflows/forecast-drewry.yml` (Blank Sailing 별도 기능)
- 생성·채점 파이프라인 전체

## 새 워크플로우 구조

**파일:** `.github/workflows/forecast-diversion-check.yml` (교체)  
**스케줄:** `0 4 * * 2` (매주 화요일 04:00 UTC, 기존 격주 → 매주)

```
Step 1: node generators/web/forecast/persist-diversion.js  ← 수집 + upsert
Step 2: node generators/web/forecast/check-diversion.js    ← freshness 검증 (안전망)
```

Step 1 실패 시 exit 1 → Step 2 미실행. 둘 다 성공해야 워크플로우 통과.

## portwatch-diversion.js 인터페이스

```js
// 순수 변환
buildCapeShare(rows, baseline)
  // rows: [{date, n_container}], baseline: number
  // 반환: { cape_share_pct, current_avg, baseline, as_of, source } | null

// API fetch
fetchPortwatchTransits(daysBack = 14)
  // 반환: [{date: 'YYYY-MM-DD', n_container: number}]

// 합성
fetchAndBuildDiversion()
  // 반환: { cape_share_pct, as_of, source } | null

module.exports = { buildCapeShare, fetchPortwatchTransits, fetchAndBuildDiversion, SUEZ_BASELINE }
```

## persist-diversion.js 동작

```
1. fetchAndBuildDiversion() 호출
2. 결과 없으면 exit 1
3. red_sea_diversion 테이블에 upsert (as_of 기준)
   - source = 'IMF Portwatch (auto)'
   - suez_share_pct = 100 - cape_share_pct (근사)
4. 성공 로그 출력
```

## 성공 기준

- `node generators/web/forecast/persist-diversion.js` 실행 시 Supabase에 행 삽입
- `node generators/web/forecast/check-diversion.js` 이어서 실행 시 exit 0
- 기존 `forecast-drewry.yml` 워크플로우 영향 없음
- `npm test forecast` 기존 테스트 통과
