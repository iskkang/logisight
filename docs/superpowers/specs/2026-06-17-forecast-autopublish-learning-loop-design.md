# Forecast 자동 발행 + 학습 루프 설계

**작성일:** 2026-06-17
**상태:** Phase 1 승인 — 구현 진행

## 배경 / 문제

`/forecasts` "전망 카드"가 지표당 여러 장(WCI 3·KCCI 3 …)으로 누적돼 정신없이 표시됨.

근본 원인 2가지:
1. **표시**: `getPublishedForecasts`가 published+resolved 전수(최대 100, dedup 없음)를 반환 → 매주 생성된 별개 전망(서로 다른 horizon)이 카드로 계속 쌓임.
2. **발행 흐름**: 모든 전망이 `draft`로 적재되고 `/admin/forecasts` 검수 큐에서 **수동 1건씩** 발행. 검수가 한 달 뒤에야 이뤄져 누적 가속.

확인: 현재 12건은 지표당 3건 모두 **horizon이 다른 정상 전망**(완전 중복 아님). 즉 DB 정리 불필요 — 표시·발행 흐름만 고치면 됨.

## 목표 — 학습 루프

사용자 의도: 단순 표시 정리가 아니라 **자기 교정 루프**.

1. ① 페이지엔 지표당 **최신 전망 1장**만.
2. ② horizon 도래 시 백엔드가 **당시 전망 vs 실측**을 자동 판정(hit/partial/miss).
3. ③ 판정 결과를 **intelligence로 축적**.
4. ④ 축적된 성적을 근거로 **다음 forecast를 더 정확하게**.

### 현황 진단

| 단계 | 상태 |
|---|---|
| ① 페이지 최신만 | 미구현 → 본 설계 |
| ② horizon 판정 | **이미 자동** — `adjudicate.js` + `forecast-adjudicate.yml`(매일 21:00 UTC). 실측으로 `outcome`·`realized_pct`·`status='resolved'` 적재 |
| ③ 결과 축적 | **행에 저장됨** — `outcome`·`realized_pct`·`metric_value_at_publish`(기준값) |
| ④ 학습 → 개선 | **갭** — scoring 가중치 정적, `scfi-kcci-backtest.js`는 수동 분석 |

### 핵심 통찰

지금은 수동 발행이라 draft 대부분이 발행 안 됨 → 판정도 안 됨 → **학습 데이터가 아예 안 쌓임**.
**자동 발행 = 학습 루프를 켜는 스위치.** Phase 1만 해도 ①②③가 매주 돌며 "예측→실측→판정" 데이터셋이 축적되기 시작.

④(학습)는 **표본이 쌓여야** 가능 → 데이터 누적 후 별도 설계(Phase 2).

## Phase 1 — 자동 발행 + 카드 dedup (지금)

### 변경 1: 백엔드 자동 발행 (logisight)

`generators/web/forecast/row.js` `mapVerdictToRow`:
- `prose.needs_editor === false` → `status='published'` + `published_at = asof.toISOString()`.
- `prose.needs_editor === true`(본문 미작성) → `status='draft'`, `published_at=null` 유지 → 검수 큐에 남아 사람이 작성 후 수동 발행.
- `abstain`은 기존대로 `generate.js`에서 skip.

`generate.js`:
- 기존 불변성 가드 유지 — 이미 발행/판정된 `(metric_ref, horizon_date, model_version)` 행은 절대 덮어쓰지 않음. 같은 주 재실행해도 published 발견 시 skip → 중복 발행 없음.
- 카운터에 `published` 추가(로그 명료화). draft(에디터필요)는 `needsEditor`로 집계.

`.github/workflows/forecast-generate.yml`: 주석을 "확신 전망 자동 발행, 에디터 필요 건만 큐"로 갱신.

**불변성 안전**: DB 트리거는 published 행의 UPDATE/DELETE만 차단 — `status='published'`로 INSERT는 허용.

### 변경 2: 카드 dedup (logisight-core)

**중요**: 적중률 KPI·추이(`computeKpis`, `hitRateTrend`, `hitRate`)는 **published+resolved 전수**를 분모로 씀. 따라서 dedup은 **데이터 소스가 아니라 카드 표시 단계**에서만. 소스(`getPublishedForecasts`)는 전수 유지.

`src/components/forecasts/forecastUtils.ts`에 헬퍼 추가:

```ts
// 지표(metric_ref)별 최신 1건만 — 카드 표시 전용. 적중률·추이 등 분석엔 적용 금지(전수 필요).
export function latestPerMetric(forecasts: Forecast[]): Forecast[] {
  const best = new Map<string, Forecast>();
  const stamp = (x: Forecast) => x.published_at ?? x.created_at ?? "";
  for (const f of forecasts) {
    const key = f.metric_ref ?? f.id;
    const cur = best.get(key);
    if (!cur || stamp(f) > stamp(cur)) best.set(key, f);
  }
  return [...best.values()];
}
```

카드 표시 4곳에 적용(분석부는 손대지 않음):
- `src/routes/forecasts.tsx` — `allOpen`(published) → 카드 그리드.
- `src/components/dashboard/DashboardForecastTiles.tsx` — `tiles`(상위 3).
- `src/components/dashboard/ForecastPanel.tsx` — `ForecastTracking`의 `open`.
- `src/components/forecasts/forecastUtils.ts` — `recentRateReports`(지표당 최신만).

### 스키마

변경 없음. 마이그레이션 불필요(`status` 컬럼 재사용).

### 기존 12건 처리

보존(백테스트용 실제 과거 예측). dedup이 카드에서 숨김. horizon 도래 시 adjudicate가 각각 판정 → ③ 데이터로 축적.

## Phase 2 — 학습 (데이터 누적 후, 별도 설계)

표본이 쌓이면 설계:
- 지표별 **calibration** 집계: 적중률, 예측 midpoint 대비 실측 편차(bias), range 커버리지.
- `scoreForecast` range/방향 **보정**(실측 변동성에 맞춰 range 조정, 방향 편향 교정).
- `narrate` 프롬프트에 **track-record 주입**(자기 과거 성적 인지).

이 문서의 ②③는 이미 가동 중이므로, Phase 1 배포 즉시 Phase 2용 데이터가 쌓이기 시작.
