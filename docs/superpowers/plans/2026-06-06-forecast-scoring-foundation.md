# Forecast Scoring Pipeline — Plan A: Schema & Scoring Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, fully unit-testable scoring core that turns a per-target input snapshot into a forecast verdict (direction/strength/range/confidence), plus the DB schema that stores it with auto-adjudication support.

**Architecture:** Code (not the LLM) computes factor scores, composite, direction, and range from the numeric rules in `freight-rate-forecast-prompt.md` v1.1. The LLM is reserved for prose only (Plan C). The scoring core is pure functions with zero external deps, tested with the Node built-in test runner (`node --test`). The `forecasts` table gains structured prediction columns so adjudication (Plan D) can be fully automatic.

**Tech Stack:** Node.js (CommonJS, plain `.js`), `node:test` + `node:assert` (no new deps), Supabase SQL migration (lives in the `logisight-core` repo).

**Repo split:** Both repos share **one** Supabase DB. The pipeline **produces** data (and owns the schema of the tables it produces); the frontend **reads & displays** (plus the human publish-gate writes). Therefore all forecast code, tests, config **and the `forecasts` table schema** live in the **pipeline repo** (`C:\Users\DELL\Documents\logisight`). The original `forecasts` CREATE migration (`20260606010000_forecasts.sql`) is **relocated** from the frontend repo (`logisight-core`) into the pipeline repo so the pipeline's migration set is self-contained for this table. The relocation is bookkeeping only — that migration is already applied to the shared DB, and keeping the same version string means neither repo re-runs it.

**Roadmap (this plan = Plan A only):**
- **Plan A (this doc):** migration + `config/forecast-model.js` + `forecast/score.js` (factor scoring, composite, classify, confidence, abstain). Ships a tested deterministic scorer + DB ready.
- **Plan B:** input assemblers — `forecast/lanes.js` (rate_series from kita_sea_rates / freight_indices), `forecast/inputs/blank-sailing.js` (Drewry T1 → schema + maritime_news keyword tagging → Stage 1/2), `forecast/inputs/fuel.js` (bunker_prices → fuel_mom_pct), `forecast/inputs/demand.js` (trade stats + calendar seasonality + policy-derived frontloading).
- **Plan C:** generation orchestration — `forecast/narrate.js` (LLM statement/impact_note + validation loop) + `forecast/generate.js` (assemble → score → narrate → insert draft).
- **Plan D:** auto-adjudication — `adjudicate-forecasts.js` (horizon-due published rows → realized_pct → outcome auto-confirm; "복기 작성 중" until editor writes outcome_note) + frontend resolution UI.

---

## Post-implementation notes (doc-ambiguity resolutions, user-approved)

Two places where the source prompt doc (`freight-rate-forecast-prompt.md` v1.1) was internally ambiguous; resolved during implementation and pinned by tests:

1. **C(수요) 팩터 overlap — demand +2 vs +1.** The worked example labels `+6%/accelerating` as C=+1 (composite 1.35), but the C **rule** says `≥5% & accelerating → +2`. Per user decision, the **rule is authoritative**: `+6%/accelerating → +2`, golden composite **1.6** (verdict up/상승 가능성 높음/+3~7/high is identical either way). The doc example's 1.35 is treated as a slip.
2. **C 팩터 보합 vs seasonality.** `|m| ≤ 2%` with positive-stable momentum → **0 (보합)** per the doc's `"0: 보합 ±2% 이내, stable"` rule (so the Task 3 code below — which returned +1 here — was corrected). But `seasonality_flag = 'peak_approaching'` → **+1 regardless of magnitude** (the rule has no m-guard), evaluated *before* the 보합 guard.
3. **confidence 'high' requires all 5 factors present** (`missing === 0`). The doc's "4개 이상 최신 → high" overlaps its "일부 결측 → medium"; resolved conservatively (4-present-aligned → medium), documented in code + test.

These are reflected in the committed code (`generators/web/forecast/score.js`) and tests, which supersede the literal code blocks in Tasks 3 and 5 below where they differ.

## Conventions used by the scorer

- A **target** declares `{ metric_ref, mode: 'ocean'|'air', cadence: 'weekly'|'monthly', horizon_date }`.
- Factor score functions return a number in `[-2, 2]` (fractional allowed — mean-reversion adjustments produce ±0.5), or `null` when that factor's input is **missing** (so the composite can reweight).
- `composite()` renormalizes weights over present factors only (abstain redistribution). All-present ocean weights sum to 1.0, so a full snapshot reproduces the doc's worked example exactly.
- `classify()` boundaries match the doc exactly: `flat` is the open interval `(-0.4, +0.4)`; `+0.4` → up, `-0.4` → down.

---

### Task 1: forecasts schema — scoring & adjudication columns

**Files:**
- Relocate: `C:\Users\DELL\Documents\logisight-core\supabase\migrations\20260606010000_forecasts.sql` → `C:\Users\DELL\Documents\logisight\supabase\migrations\20260606010000_forecasts.sql` (move, keep contents & version identical)
- Create: `C:\Users\DELL\Documents\logisight\supabase\migrations\20260607000000_forecasts_scoring.sql`

- [ ] **Step 0: Relocate the original forecasts CREATE into the pipeline repo**

Copy `logisight-core/supabase/migrations/20260606010000_forecasts.sql` verbatim to `logisight/supabase/migrations/20260606010000_forecasts.sql`, then `git rm` it from `logisight-core`. Do NOT change the file contents or the `20260606010000` version — it is already applied to the shared DB, so this is a file move, not a re-run.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 6: 전망 스코어링·자동판정 컬럼 추가.
-- 코드가 채점(direction/range/composite/factor_scores)하고, 자동 판정이 realized_pct를 채운다.
-- model_version: 보정 루프 키(어느 가중치 버전의 전망인지). metric_value_at_publish: % 판정 기준값.

alter table forecasts
  add column if not exists cadence text check (cadence in ('weekly', 'monthly')),
  add column if not exists direction text check (direction in ('up', 'flat', 'down')),
  add column if not exists strength text,
  add column if not exists expected_range_pct text,          -- 표시용 파생("+3~7")
  add column if not exists range_low_pct numeric,            -- 자동 판정 산식용 숫자 경계
  add column if not exists range_high_pct numeric,
  add column if not exists composite_score numeric,
  add column if not exists factor_scores jsonb,
  add column if not exists confidence_reason text,
  add column if not exists data_quality_flags jsonb,
  add column if not exists model_version text,               -- 보정 루프 필수 키
  add column if not exists metric_value_at_publish numeric,  -- 발행 시점 기준값(없으면 % 판정 불가)
  add column if not exists realized_pct numeric;             -- 판정 시 기록되는 실측 변화율

-- 재실행 중복 방지: 같은 지표·기준일·모델버전 전망은 1건.
create unique index if not exists forecasts_dedup_idx
  on forecasts (metric_ref, horizon_date, model_version)
  where metric_ref is not null and model_version is not null;

-- 불변 트리거 갱신: 신규 채점 필드도 발행 후 불변. 단 outcome/outcome_note/realized_pct/resolved_at은 변경 허용.
create or replace function forecasts_guard_published()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'published/resolved forecasts cannot be deleted';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if new.module is distinct from old.module
       or new.statement is distinct from old.statement
       or new.basis is distinct from old.basis
       or new.impact_note is distinct from old.impact_note
       or new.horizon_date is distinct from old.horizon_date
       or new.confidence is distinct from old.confidence
       or new.invalidation_condition is distinct from old.invalidation_condition
       or new.metric_ref is distinct from old.metric_ref
       or new.cadence is distinct from old.cadence
       or new.direction is distinct from old.direction
       or new.strength is distinct from old.strength
       or new.expected_range_pct is distinct from old.expected_range_pct
       or new.range_low_pct is distinct from old.range_low_pct
       or new.range_high_pct is distinct from old.range_high_pct
       or new.composite_score is distinct from old.composite_score
       or new.factor_scores is distinct from old.factor_scores
       or new.model_version is distinct from old.model_version
       or new.metric_value_at_publish is distinct from old.metric_value_at_publish then
      raise exception 'published forecasts are immutable except status/outcome/realized fields';
    end if;
  end if;
  return new;
end;
$$;
```

- [ ] **Step 2: Verify the migration applies cleanly**

Run (from `C:\Users\DELL\Documents\logisight`): `npx supabase db push` (or apply via the project's normal migration path against the shared DB).
Expected: `20260606010000_forecasts` is reported **already applied** (skipped); `20260607000000_forecasts_scoring` applies; `\d forecasts` shows the new columns; `forecasts_dedup_idx` exists.

- [ ] **Step 3: Commit — pipeline repo (logisight)**

```bash
git add supabase/migrations/20260606010000_forecasts.sql supabase/migrations/20260607000000_forecasts_scoring.sql
git commit -m "feat(forecasts): own forecasts schema in pipeline + scoring/adjudication columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Commit the removal — frontend repo (logisight-core)**

```bash
git -C "C:/Users/DELL/Documents/logisight-core" rm supabase/migrations/20260606010000_forecasts.sql
git -C "C:/Users/DELL/Documents/logisight-core" commit -m "chore(forecasts): relocate schema ownership to pipeline repo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: model config constants

**Files:**
- Create: `C:\Users\DELL\Documents\logisight\generators\web\forecast\config\forecast-model.js`

- [ ] **Step 1: Write the config**

```js
'use strict';
// 스코어링 모델 상수 — 프롬프트 문서 docs(또는 freight-rate-forecast-prompt.md) v1.1 과 버전 동기화.
// 분기 보정 시 이 파일 상수만 바꾸고 MODEL_VERSION을 함께 올린다(코드 수술 금지).

const MODEL_VERSION = 'v1.1';

// 팩터 가중치 — 합 1.0. 결측 팩터는 composite()에서 재분배.
const WEIGHTS = {
  ocean: { momentum: 0.25, supply: 0.30, demand: 0.25, cost: 0.10, pricing: 0.10 },
  air: { momentum: 0.20, supply: 0.30, demand: 0.30, cost: 0.15, pricing: 0.05 },
};

// composite → 방향/강도/범위(%). classify()가 경계를 명시적으로 적용한다.
const THRESHOLDS = {
  upHigh: { direction: 'up', strength: '상승 가능성 높음', range: [3, 7] },
  upLean: { direction: 'up', strength: '상승 우세', range: [1, 4] },
  flat: { direction: 'flat', strength: '방향성 약함(보합권)', range: null },
  downLean: { direction: 'down', strength: '하락 우세', range: [-4, -1] },
  downHigh: { direction: 'down', strength: '하락 가능성 높음', range: [-7, -3] },
};

// 신선도 임계(일) — 케이던스별. 문서 그대로.
const FRESHNESS_DAYS = { weekly: 14, monthly: 45 };
// abstain 기준일 과도 임계(일).
const STALE_DAYS = { weekly: 21, monthly: 60 };
// 결항 신호 만료(일).
const SUPPLY_SIGNAL_MAX_AGE_DAYS = 14;

module.exports = {
  MODEL_VERSION,
  WEIGHTS,
  THRESHOLDS,
  FRESHNESS_DAYS,
  STALE_DAYS,
  SUPPLY_SIGNAL_MAX_AGE_DAYS,
};
```

- [ ] **Step 2: Commit**

```bash
git add generators/web/forecast/config/forecast-model.js
git commit -m "feat(forecast): scoring model constants (weights/thresholds, v1.1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: factor scoring functions (TDD)

**Files:**
- Create: `C:\Users\DELL\Documents\logisight\generators\web\forecast\score.js`
- Test: `C:\Users\DELL\Documents\logisight\generators\web\forecast\score.test.js`

- [ ] **Step 1: Write failing tests for the five factor scorers**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreMomentum, scoreSupply, scoreDemand, scoreCost, scorePricing,
} = require('./score');

test('momentum: up_3 + high percentile → +2', () => {
  assert.equal(scoreMomentum({ trend_3p: 'up_3', percentile_52w: 78, mom_pct: 6.2 }), 2);
});
test('momentum: extreme percentile applies mean-reversion (-0.5)', () => {
  assert.equal(scoreMomentum({ trend_3p: 'up_3', percentile_52w: 92, mom_pct: 6 }), 1.5);
});
test('momentum: missing trend → null', () => {
  assert.equal(scoreMomentum({ percentile_52w: 50 }), null);
});

test('supply: tracker_quoted ratio>=15 expanding → +2', () => {
  assert.equal(scoreSupply({ source_type: 'tracker_quoted', ratio_pct: 16, direction: 'expanding', signal_age_days: 3 }), 2);
});
test('supply: tracker_quoted ratio 12 → +1', () => {
  assert.equal(scoreSupply({ source_type: 'tracker_quoted', ratio_pct: 12, direction: 'expanding', signal_age_days: 3 }), 1);
});
test('supply: stale signal (>14d) → null', () => {
  assert.equal(scoreSupply({ source_type: 'tracker_quoted', ratio_pct: 16, direction: 'expanding', signal_age_days: 20 }), null);
});
test('supply: news_derived easing major 2 sources → -2', () => {
  assert.equal(scoreSupply({ source_type: 'news_derived', direction: 'easing', magnitude_class: 'major', independent_sources: 2, signal_age_days: 5 }), -2);
});
test('supply: none → null', () => {
  assert.equal(scoreSupply({ source_type: 'none' }), null);
});

test('demand: +6 accelerating → +2', () => {
  assert.equal(scoreDemand({ export_momentum_yoy_pct: 6, momentum_trend: 'accelerating' }), 2);
});
test('demand: flat (|m|<=2) → 0', () => {
  assert.equal(scoreDemand({ export_momentum_yoy_pct: 1, momentum_trend: 'stable' }), 0);
});
test('demand: missing → null', () => {
  assert.equal(scoreDemand({}), null);
});

test('cost: fuel +9 → +1', () => {
  assert.equal(scoreCost({ fuel_mom_pct: 9 }, 1), 1);
});
test('cost: pass-through failure halves score when demand<=-1', () => {
  assert.equal(scoreCost({ fuel_mom_pct: 9 }, -1), 0.5);
});
test('cost: missing → null', () => {
  assert.equal(scoreCost({}, 0), null);
});

test('pricing: GRI announced + success>=0.6 → +2', () => {
  assert.equal(scorePricing({ announcements: [{ type: 'GRI', effective: '2026-07-01' }], historical_success_rate: 0.65 }), 2);
});
test('pricing: announced, success unknown → +1', () => {
  assert.equal(scorePricing({ announcements: [{ type: 'PSS' }], historical_success_rate: null }), 1);
});
test('pricing: no announcements → 0 (defined state, not missing)', () => {
  assert.equal(scorePricing({ announcements: [] }), 0);
});
test('pricing: not gathered → null', () => {
  assert.equal(scorePricing(null), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test generators/web/forecast/score.test.js`
Expected: FAIL — `score.js` has no exports yet / `Cannot find module './score'`.

- [ ] **Step 3: Implement the factor scorers**

```js
'use strict';
const { SUPPLY_SIGNAL_MAX_AGE_DAYS } = require('./config/forecast-model');

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// A. 운임 모멘텀 (-2..+2). rate_series: {trend_3p, percentile_52w, mom_pct}
function scoreMomentum(rs) {
  if (!rs || rs.trend_3p == null) return null;
  const p = rs.percentile_52w;
  const m = rs.mom_pct;
  let s;
  if (rs.trend_3p === 'up_3' && p != null && p >= 70) s = 2;
  else if (rs.trend_3p === 'up_2' || (m != null && m > 3)) s = 1;
  else if (rs.trend_3p === 'down_3' && p != null && p <= 30) s = -2;
  else if (rs.trend_3p === 'down_2' || (m != null && m < -3)) s = -1;
  else s = 0; // mixed 또는 |mom|<=1 포함
  // 평균회귀 보정
  if (p != null && p >= 90) s -= 0.5;
  else if (p != null && p <= 10) s += 0.5;
  return clamp(s, -2, 2);
}

// B. 공급 조정 (-2..+2). blank_sailing 구조체.
function scoreSupply(bs) {
  if (!bs || bs.source_type == null || bs.source_type === 'none') return null;
  if (bs.signal_age_days != null && bs.signal_age_days > SUPPLY_SIGNAL_MAX_AGE_DAYS) return null;
  if (bs.source_type === 'tracker_quoted') {
    const r = bs.ratio_pct;
    const cap = bs.effective_capacity_chg_pct;
    if ((r != null && r >= 15 && bs.direction === 'expanding') || (cap != null && cap <= -10)) return 2;
    if ((r != null && r >= 7) || bs.direction === 'expanding' || (cap != null && cap <= -3)) return 1;
    if (cap != null && cap >= 10) return -2;
    if (bs.direction === 'easing' && cap != null && cap > 0) return -1;
    return 0;
  }
  if (bs.source_type === 'news_derived') {
    const n = bs.independent_sources || 1;
    if (bs.direction === 'expanding' && bs.magnitude_class === 'major' && n >= 2) return 2;
    if (bs.direction === 'expanding') return 1;
    if (bs.direction === 'easing' && bs.magnitude_class === 'major' && n >= 2) return -2;
    if (bs.direction === 'easing') return -1;
    return 0; // stable | mixed
  }
  return null;
}

// C. 수요 (-2..+2).
function scoreDemand(d) {
  if (!d || d.export_momentum_yoy_pct == null) return null;
  const m = d.export_momentum_yoy_pct;
  if ((m >= 5 && d.momentum_trend === 'accelerating') || (d.frontloading_flag && m > 0)) return 2;
  if ((m > 0 && (d.momentum_trend === 'stable' || d.momentum_trend === 'accelerating')) || d.seasonality_flag === 'peak_approaching') return 1;
  if (Math.abs(m) <= 2) return 0;
  if (m <= -5 && d.momentum_trend === 'decelerating') return -2;
  if (d.momentum_trend === 'decelerating' || m < 0) return -1;
  return 0;
}

// D. 비용(유가) (-2..+2). demandScore로 전가 실패 규칙 적용.
function scoreCost(c, demandScore) {
  if (!c || c.fuel_mom_pct == null) return null;
  const f = c.fuel_mom_pct;
  let s;
  if (f >= 10) s = 2;
  else if (f >= 5) s = 1;
  else if (f > -5) s = 0;
  else if (f > -10) s = -1;
  else s = -2;
  if (demandScore != null && demandScore <= -1) s = s * 0.5; // 전가 실패
  return s;
}

// E. 가격 행동 (-2..+2). announcements 배열 존재 여부로 결측/정의 구분.
function scorePricing(p) {
  if (!p || !Array.isArray(p.announcements)) return null;
  const cuts = p.announcements.filter((a) => /인하|cut/i.test(a.type || ''));
  if (cuts.length > 1) return -2;
  if (cuts.length === 1) return -1;
  if (p.announcements.length === 0) return 0;
  if (p.historical_success_rate != null && p.historical_success_rate >= 0.6) return 2;
  return 1; // 공지 존재, 관철률 불명
}

module.exports = { scoreMomentum, scoreSupply, scoreDemand, scoreCost, scorePricing, clamp };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test generators/web/forecast/score.test.js`
Expected: PASS — all factor tests green.

- [ ] **Step 5: Commit**

```bash
git add generators/web/forecast/score.js generators/web/forecast/score.test.js
git commit -m "feat(forecast): deterministic factor scorers (A-E, -2..+2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: composite, classify, confidence, abstain (TDD)

**Files:**
- Modify: `C:\Users\DELL\Documents\logisight\generators\web\forecast\score.js`
- Test: `C:\Users\DELL\Documents\logisight\generators\web\forecast\score.composite.test.js`

- [ ] **Step 1: Write failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { composite, classify, confidence } = require('./score');
const { WEIGHTS } = require('./config/forecast-model');

test('composite: all-present ocean reproduces worked example 1.35', () => {
  const scores = { momentum: 2, supply: 1, demand: 1, cost: 1, pricing: 2 };
  assert.equal(composite(scores, WEIGHTS.ocean), 1.35);
});
test('composite: reweights over present factors when some missing', () => {
  // momentum=2 present, others null → renormalize → 2
  const scores = { momentum: 2, supply: null, demand: null, cost: null, pricing: null };
  assert.equal(composite(scores, WEIGHTS.ocean), 2);
});
test('composite: all missing → null', () => {
  const scores = { momentum: null, supply: null, demand: null, cost: null, pricing: null };
  assert.equal(composite(scores, WEIGHTS.ocean), null);
});

test('classify: boundaries match doc (+0.4 up, -0.4 down, open flat)', () => {
  assert.equal(classify(1.35).direction, 'up');
  assert.equal(classify(0.4).direction, 'up');
  assert.equal(classify(0.39).direction, 'flat');
  assert.equal(classify(-0.4).direction, 'down');
  assert.equal(classify(-0.39).direction, 'flat');
  assert.equal(classify(-0.9).strength, '하락 가능성 높음');
  assert.deepEqual(classify(1.35).range, [3, 7]);
  assert.equal(classify(0).range, null);
});

test('confidence: 5 present, signs aligned → high', () => {
  const scores = { momentum: 2, supply: 1, demand: 1, cost: 1, pricing: 2 };
  assert.equal(confidence(scores, WEIGHTS.ocean), 'high');
});
test('confidence: 2+ missing → low', () => {
  const scores = { momentum: 2, supply: 1, demand: null, cost: null, pricing: 2 };
  assert.equal(confidence(scores, WEIGHTS.ocean), 'low');
});
test('confidence: vulnerable rally (supply>=1 & demand<=-1) → medium', () => {
  const scores = { momentum: 1, supply: 1, demand: -1, cost: 0, pricing: 1 };
  assert.equal(confidence(scores, WEIGHTS.ocean), 'medium');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test generators/web/forecast/score.composite.test.js`
Expected: FAIL — `composite`, `classify`, `confidence` are not exported.

- [ ] **Step 3: Add composite/classify/confidence to score.js**

Add to `score.js` (before `module.exports`), and extend the exports:

```js
const { WEIGHTS, THRESHOLDS } = require('./config/forecast-model');

function round2(v) { return Math.round(v * 100) / 100; }

// 결측 팩터(null)는 제외하고 가중치를 재분배(renormalize)한 가중합.
function composite(scores, weights) {
  let active = 0;
  for (const f of Object.keys(weights)) if (scores[f] != null) active += weights[f];
  if (active === 0) return null;
  let sum = 0;
  for (const f of Object.keys(weights)) {
    if (scores[f] == null) continue;
    sum += scores[f] * (weights[f] / active);
  }
  return round2(sum);
}

// composite → THRESHOLDS 버킷. 경계는 문서 그대로(flat = 개구간).
function classify(c) {
  if (c >= 0.8) return THRESHOLDS.upHigh;
  if (c >= 0.4) return THRESHOLDS.upLean;
  if (c > -0.4) return THRESHOLDS.flat;
  if (c > -0.8) return THRESHOLDS.downLean;
  return THRESHOLDS.downHigh;
}

function confidence(scores, weights) {
  const factors = Object.keys(weights);
  const present = factors.filter((f) => scores[f] != null);
  const missing = factors.length - present.length;
  const nonZero = present.map((f) => scores[f]).filter((v) => v !== 0);
  const pos = nonZero.filter((v) => v > 0).length;
  const neg = nonZero.filter((v) => v < 0).length;

  if (missing >= 2) return 'low';
  // 충돌 규칙 5: 3개 이상 부호 충돌
  if (pos >= 1 && neg >= 1 && pos + neg >= 3) return 'medium';
  // 취약한 상승: 공급 우위(+) & 수요 약화(-)
  if (scores.supply != null && scores.supply >= 1 && scores.demand != null && scores.demand <= -1) return 'medium';
  if (missing === 1) return 'medium';
  if (present.length >= 4 && (pos === 0 || neg === 0)) return 'high';
  return 'medium';
}
```

Update the `module.exports` line to:

```js
module.exports = {
  scoreMomentum, scoreSupply, scoreDemand, scoreCost, scorePricing, clamp,
  composite, classify, confidence, round2,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test generators/web/forecast/score.composite.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add generators/web/forecast/score.js generators/web/forecast/score.composite.test.js
git commit -m "feat(forecast): composite reweighting, classify boundaries, confidence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: scoreForecast() — end-to-end verdict with abstain (TDD)

**Files:**
- Modify: `C:\Users\DELL\Documents\logisight\generators\web\forecast\score.js`
- Test: `C:\Users\DELL\Documents\logisight\generators\web\forecast\score.forecast.test.js`

- [ ] **Step 1: Write failing tests (golden case + abstain cases)**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreForecast } = require('./score');

// 문서 §2 워크드 예제: 부산→LA, A=2 B=1 C=1 D=1 E=2 → composite 1.35
const PUS_LAX = {
  mode: 'ocean', cadence: 'monthly',
  rate_series: { latest: 2850, unit: 'USD/FEU', mom_pct: 6.2, trend_3p: 'up_3', percentile_52w: 78, asof_age_days: 5 },
  supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 12, direction: 'expanding', signal_age_days: 3 } },
  demand: { export_momentum_yoy_pct: 6, momentum_trend: 'accelerating' },
  cost: { fuel_mom_pct: 9 },
  pricing_actions: { announcements: [{ type: 'GRI', effective: '2026-07-01' }], historical_success_rate: 0.65 },
};

test('scoreForecast: golden case → up / 1.35 / +3~7 / high', () => {
  const r = scoreForecast(PUS_LAX);
  assert.equal(r.abstain, false);
  assert.equal(r.direction, 'up');
  assert.equal(r.composite_score, 1.35);
  assert.equal(r.range_low_pct, 3);
  assert.equal(r.range_high_pct, 7);
  assert.equal(r.expected_range_pct, '+3~7');
  assert.equal(r.confidence, 'high');
  assert.equal(r.model_version, 'v1.1');
  assert.equal(r.factor_scores.length, 5);
});

test('scoreForecast: missing rate_series → abstain', () => {
  const r = scoreForecast({ mode: 'ocean', cadence: 'weekly', rate_series: null });
  assert.equal(r.abstain, true);
});

test('scoreForecast: stale rate (weekly D-21+) → abstain', () => {
  const r = scoreForecast({
    mode: 'ocean', cadence: 'weekly',
    rate_series: { latest: 1000, trend_3p: 'up_2', asof_age_days: 30 },
    supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 9, direction: 'expanding', signal_age_days: 3 } },
    demand: { export_momentum_yoy_pct: 3, momentum_trend: 'stable' },
  });
  assert.equal(r.abstain, true);
});

test('scoreForecast: supply & demand both missing → abstain', () => {
  const r = scoreForecast({
    mode: 'ocean', cadence: 'weekly',
    rate_series: { latest: 1000, trend_3p: 'up_2', percentile_52w: 60, asof_age_days: 3 },
    supply: { blank_sailing: { source_type: 'none' } },
    demand: {},
  });
  assert.equal(r.abstain, true);
});

test('scoreForecast: missing factor recorded in data_quality_flags', () => {
  const input = { ...PUS_LAX, pricing_actions: null };
  const r = scoreForecast(input);
  assert.equal(r.abstain, false);
  assert.ok(r.data_quality_flags.some((f) => f.startsWith('pricing')));
  assert.equal(r.factor_scores.find((x) => x.factor === 'pricing').missing, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test generators/web/forecast/score.forecast.test.js`
Expected: FAIL — `scoreForecast` not exported.

- [ ] **Step 3: Implement scoreForecast in score.js**

Add before `module.exports` (it uses helpers already defined in the file):

```js
const { STALE_DAYS, MODEL_VERSION } = require('./config/forecast-model');

function fmtRange(range) {
  if (!range) return null;
  const [lo, hi] = range;
  const sLo = lo > 0 ? `+${lo}` : `${lo}`;
  return `${sLo}~${hi}`;
}

// input: { mode, cadence, rate_series, supply:{blank_sailing}, demand, cost, pricing_actions }
function scoreForecast(input) {
  const rs = input.rate_series;
  if (!rs || rs.latest == null) return { abstain: true, reason: 'rate_series 결측' };
  const staleMax = STALE_DAYS[input.cadence] || STALE_DAYS.weekly;
  if (rs.asof_age_days != null && rs.asof_age_days > staleMax) {
    return { abstain: true, reason: `기준일 과도(>${staleMax}d)` };
  }

  const weights = WEIGHTS[input.mode] || WEIGHTS.ocean;
  const scores = {
    momentum: scoreMomentum(rs),
    supply: scoreSupply(input.supply && input.supply.blank_sailing),
    demand: scoreDemand(input.demand),
    pricing: scorePricing(input.pricing_actions),
    cost: null,
  };
  scores.cost = scoreCost(input.cost, scores.demand);

  if (scores.supply == null && scores.demand == null) {
    return { abstain: true, reason: 'supply·demand 동시 결측' };
  }

  const comp = composite(scores, weights);
  if (comp == null) return { abstain: true, reason: '활성 팩터 없음' };

  const cls = classify(comp);
  const conf = confidence(scores, weights);
  return {
    abstain: false,
    mode: input.mode,
    cadence: input.cadence,
    direction: cls.direction,
    strength: cls.strength,
    composite_score: comp,
    range_low_pct: cls.range ? cls.range[0] : null,
    range_high_pct: cls.range ? cls.range[1] : null,
    expected_range_pct: fmtRange(cls.range),
    confidence: conf,
    factor_scores: Object.keys(weights).map((f) => ({
      factor: f, score: scores[f], weight: weights[f], missing: scores[f] == null,
    })),
    data_quality_flags: Object.keys(weights)
      .filter((f) => scores[f] == null)
      .map((f) => `${f}: 결측 — 가중치 재분배`),
    model_version: MODEL_VERSION,
  };
}
```

Extend `module.exports` to add `scoreForecast`:

```js
module.exports = {
  scoreMomentum, scoreSupply, scoreDemand, scoreCost, scorePricing, clamp,
  composite, classify, confidence, round2, scoreForecast,
};
```

- [ ] **Step 4: Run the full forecast test suite**

Run: `node --test generators/web/forecast/`
Expected: PASS — all four test files green (factor, composite, forecast).

- [ ] **Step 5: Add an npm test script and commit**

In `C:\Users\DELL\Documents\logisight\package.json` scripts, add:

```json
"test:forecast": "node --test generators/web/forecast/"
```

```bash
git add generators/web/forecast/score.js generators/web/forecast/score.forecast.test.js package.json
git commit -m "feat(forecast): scoreForecast end-to-end verdict + abstain rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** Decision 1 (code scoring) = Tasks 2–5. Decision 4 (migration + 4 extra columns: `range_low/high_pct`, `model_version`, `metric_value_at_publish`, `cadence`, `realized_pct`) = Task 1. Two-track cadence (Decision 2) is carried as a per-target `cadence` attribute consumed by `STALE_DAYS`/`FRESHNESS_DAYS`; target declarations themselves land in Plan B. Partial-data (Decision 3) = `composite()` reweighting + `data_quality_flags` (Tasks 4–5).
- **model_version sync (Decision 1a):** `MODEL_VERSION` lives only in `config/forecast-model.js`; both the scorer output and the dedup unique index key off it.
- **narrate validation (Decision 1b)** and **auto-adjudication "복기 작성 중" (Decision ①)** are Plan C / Plan D respectively — out of scope here, but the schema (Task 1) already supports them (`realized_pct` mutable post-publish; `outcome_note` nullable).
- **Type consistency:** factor keys (`momentum/supply/demand/cost/pricing`) are identical across `WEIGHTS`, every scorer, `composite`, `confidence`, and `factor_scores`.
