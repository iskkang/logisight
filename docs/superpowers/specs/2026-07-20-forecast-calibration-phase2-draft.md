# Forecast Calibration — Phase 2 설계 초안

**작성일:** 2026-07-20  
**상태:** 초안 — 실제 수치는 라이브 DB 실행 후 채워야 함  
**전제:** Phase 1(자동 발행 + adjudicate) 가동 완료, `status='resolved'` 표본 누적 중

---

## 1. 목적

Phase 1이 켜놓은 "예측→발행→실측→판정" 루프에서 **통계적 교정 피드백**을 뽑아  
`scoreForecast`의 range 폭/방향 편향을 보정하고 `narrate` 프롬프트에 과거 성적을 주입한다.

---

## 2. calibration 스크립트 (`calibration.js`)

### 2.1 실행

```bash
# .env.local에 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요
npm run calibration:forecasts
```

스크립트는 **읽기 전용** — DB 쓰기 없음. `status='resolved'` 전망 전수를  
`metric_ref`별로 집계해 아래 4가지 통계를 콘솔 표로 출력한다.

### 2.2 통계 정의

| 통계 | 공식 | 의미 |
|---|---|---|
| **방향 적중률** | (hit + partial×0.5) / n | 방향 예측 품질 |
| **bias** | mean(realized_pct − midpoint) | 체계적 과소/과대 추정 |
| **MAE** | mean(\|realized_pct − midpoint\|) | 예측 범위 중앙값 오차 |
| **range 커버리지** | realized ∈ [low, high] 비율 | range 폭 적정성 |
| **factor 정합률** | sign(score×weight) == sign(realized) 비율 | 팩터 방향 신뢰도 |

> `midpoint = (range_low_pct + range_high_pct) / 2`  
> range 없는 행(flat 방향 등)은 bias/MAE/커버리지 계산에서 제외.

### 2.3 실제 수치 — 사용자가 채워야 할 섹션

> **이 에이전트는 라이브 DB에 접속하지 않으므로 아래 표는 비어 있다.**  
> 자격증명이 있는 환경에서 `npm run calibration:forecasts`를 실행해 숫자를 채운다.

| metric_ref | n | 방향 적중률 | bias(%p) | MAE(%p) | range 커버리지 | factor 정합률 |
|---|---|---|---|---|---|---|
| SCFI | — | — | — | — | — | — |
| KCCI | — | — | — | — | — | — |
| WCI | — | — | — | — | — | — |
| … | | | | | | |

표본 권장 기준: **지표당 ≥ 20건** 이후 보정 적용. 그 전까지는 관찰만.

---

## 3. Phase 2-A: `scoreForecast` range 보정

### 3.1 트리거 조건

`calibration.js` 실행 결과가 다음 중 하나를 충족할 때:
- **bias 절댓값 > 2%p** — 체계적 편향 존재
- **range 커버리지 < 50%** — range 폭이 실측 변동성보다 좁음

### 3.2 보정 방법 A: range 스케일 조정

`score.js`의 `classify` 함수가 반환하는 `range` 배열을 metric_ref별 스케일 계수로 조정.

```js
// config/forecast-model.js에 추가 예시 (아직 미구현 — Phase 2 설계)
const RANGE_SCALE = {
  SCFI: 1.0,   // calibration 후 실측치로 갱신
  KCCI: 1.0,
  WCI:  1.0,
};

// classify 이후, scoreForecast 반환 직전에 적용
if (RANGE_SCALE[input.metric_ref]) {
  const k = RANGE_SCALE[input.metric_ref];
  result.range_low_pct  = round2(result.range_low_pct  * k);
  result.range_high_pct = round2(result.range_high_pct * k);
  result.expected_range_pct = fmtRange([result.range_low_pct, result.range_high_pct]);
}
```

**스케일 계수 산출:**
- 목표 커버리지 66%(약 1σ 등가). 실측 coverage = C, 목표 = 0.66 →  
  `k = 0.66 / C` 를 초기값으로 사용하고, 과적합 방지를 위해 `clamp(k, 0.5, 2.0)`.

### 3.3 보정 방법 B: 방향 bias 교정

- `bias > +2%p`: 모델이 실측 대비 낮게 예측(과소) → range를 위쪽으로 shift.  
  `shift = clamp(bias, -5, 5)` 적용.  
  `range_low_pct += shift; range_high_pct += shift`.
- `bias < -2%p`: 과대 예측 → 아래쪽으로 shift.

두 보정(A·B)은 순서대로 적용: scale 먼저, shift 나중.

### 3.4 구현 위치

- `config/forecast-model.js`: `RANGE_SCALE`, `RANGE_SHIFT` 상수 추가.
- `score.js` `scoreForecast` 반환 직전에 metric_ref 기반 보정 적용.
- 보정 적용 시 `data_quality_flags`에 `"range 보정(calibration v1): scale×K, shift+S"` 추가.

---

## 4. Phase 2-B: `narrate` 프롬프트 track-record 주입

### 4.1 목적

LLM이 자신의 과거 예측 성적을 인지한 채로 본문을 작성하게 함으로써  
근거 없는 자신감이나 일관성 없는 어조를 교정한다.

### 4.2 주입 형식

`generators/web/forecast/narrate.js` (또는 해당 프롬프트 빌더)에  
calibration 결과를 `system` 블록 하단에 삽입:

```
### 이 모델의 과거 성적 (${metric_ref}, 최근 ${n}건)
- 방향 적중률: ${directionAccuracy}%
- 예측 range 커버리지: ${rangeCoverage}%  (목표 66%)
- 평균 편차(bias): ${bias}%p  (양수=과소추정)

이 성적을 감안해 tone을 조정하라:
- 방향 적중률 < 60%: "향후 변동성이 높아 방향 판단에 불확실성이 있습니다" 문구 포함.
- 커버리지 < 50%: range를 서술할 때 "잠정 범위" 표현 사용.
- bias 절댓값 > 2%p: 편향 방향을 언급("최근 예측이 실측 대비 낮은 경향").
```

### 4.3 데이터 공급 흐름

```
calibration.js (read)
  └→ aggregateByMetric(rows)
       └→ stats 객체
            └→ narrate.js가 generate.js 호출 시 metric_ref별 stats 전달
                 └→ buildPrompt()에서 track-record 블록 삽입
```

`generate.js`는 narrate 호출 전에 `calibration.aggregateByMetric(resolvedRows)`를  
별도 조회하거나 캐시 파일에서 읽어 전달한다.

### 4.4 캐시 전략 (Phase 2 구현 시 결정)

옵션 1 — **실시간 조회**: generate.js에서 `status='resolved'` 전망 전수 조회 → 집계.  
옵션 2 — **주간 캐시**: `calibration.js`가 `cache/calibration-stats.json`에 저장, generate.js가 읽음.

추천: 표본이 적은 초기는 옵션 1(단순), 표본 증가 시 옵션 2로 전환.

---

## 5. 구현 순서 (Phase 2 로드맵)

```
[지금] calibration.js 작성 + 테스트 ← 이 PR
  ↓
[표본 누적 후] npm run calibration:forecasts 실행 → 수치 확인
  ↓
[bias/coverage 기준 충족 시]
  Phase 2-A: score.js range 보정 (RANGE_SCALE / RANGE_SHIFT)
  Phase 2-B: narrate.js track-record 주입
  ↓
[운영 후 4주] 보정 효과 재측정 (bias·coverage 개선 여부)
```

---

## 6. 지표별 개선 우선순위 (수치 채운 후 결정)

> 아래는 빈 서식 — `calibration.js` 실행 후 채운다.

| 우선순위 | metric_ref | 근거 | 보정 유형 |
|---|---|---|---|
| 1 | — | — | — |
| 2 | — | — | — |

---

## 7. 비고

- **표본 < 20건**: 보정 적용 금지 — 통계 불안정. `calibration.js`가 경고 출력.
- **flat 방향**: range 없으므로 bias/MAE/커버리지 집계에서 제외. 방향 적중률만 산출.
- **DB 불변성 규칙 유지**: 보정은 새 INSERT 시 적용 — `status='published'` 행 UPDATE 금지.
