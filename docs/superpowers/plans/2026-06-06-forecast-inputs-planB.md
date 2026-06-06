# Forecast Pipeline — Plan B: Input Assemblers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic input assemblers that turn Supabase rows into the per-target snapshot object consumed by `scoreForecast()` (Plan A) — rate_series, supply.blank_sailing, cost (fuel), demand — plus the target declarations (two-track) and the orchestration that assembles a full input per target.

**Architecture:** Each assembler is split into a **pure transform** (rows → schema fragment; fully unit-testable, no I/O) and a thin **fetch wrapper** (Supabase query → transform). All scoring inputs come from existing pipeline tables. No LLM here (LLM is Plan C narrate only). The news-derived blank-sailing path (per-article LLM extraction) is deferred — Plan B uses the `blank_sailings` table (weekly history) for `tracker_quoted` supply.

**Tech Stack:** Node.js (CommonJS, plain `.js`), `node:test` + `node:assert`, `@supabase/supabase-js` (already a dependency) for fetch wrappers.

**Repo:** Pipeline repo `C:\Users\DELL\Documents\logisight`. Builds on Plan A files in `generators/web/forecast/`.

**Roadmap position:** Plan A (scoring core) ✅ done. **Plan B (this doc) = input assemblers.** Plan C = generation (narrate + draft insert). Plan D = auto-adjudication.

---

## Data sources (verified schemas)

- `kita_sea_rates(origin, dest, region, year_mon, teu, feu, teu_chg, feu_chg, fetched_at)` — monthly KITA lane rates. `feu` = level (USD/FEU), `feu_chg` = MoM %.
- `freight_indices(index_code, value, change_pct, week_date, source)` — weekly indices. `KCCI` = Korea composite (primary), `SCFI` = secondary. `change_pct` = WoW %.
- `blank_sailings(week_start, region, blanked_teu, planned_teu, blank_pct, source)` — weekly per region. `region='East Asia'` = transpacific proxy for Korea-origin.
- `bunker_prices(grade, port, price_usd, obs_date, source)` — daily. `grade='VLSFO'`, `port='Singapore'` primary.
- `trade_statistics(period, stat_type, hs_code, country_code, export_usd, import_usd, ...)` — monthly. `period='YYYY-MM'`, `stat_type='country'` rows summed = total exports for a period.
- `policies(effective_date, severity, policy_type, ...)` — for frontloading (effective within D-60).

## Input object shape produced (consumed by `scoreForecast`)

```
{ mode:'ocean', cadence:'weekly'|'monthly',
  rate_series: { latest, unit, mom_pct, trend_3p, percentile_52w, vs_normal_band, asof_age_days },
  supply: { blank_sailing: { source_type, ratio_pct, direction, magnitude_class, independent_sources, geo_scope, signal_age_days } },
  cost: { fuel_mom_pct, fuel_obs_lag_weeks },
  demand: { export_momentum_yoy_pct, momentum_trend, seasonality_flag, frontloading_flag },
  pricing_actions: null  // E팩터는 Plan B 범위 밖(결측 → 가중치 재분배)
}
```

---

### Task 0: refine `scoreDemand` for partial demand inputs

**Why:** Plan A's `scoreDemand` returns `null` (missing) whenever `export_momentum_yoy_pct` is absent, and uses `Math.abs(m)` unguarded — so a seasonality-only demand (no trade stats yet) is wrongly treated as missing or as 0. Decision 3 wants `seasonality_flag='peak_approaching'` to score +1 on its own.

**Files:**
- Modify: `generators/web/forecast/score.js`
- Test: `generators/web/forecast/score.test.js` (add cases)

- [ ] **Step 1: Add failing tests**

```js
test('demand: momentum absent + peak_approaching → +1', () => {
  assert.equal(scoreDemand({ seasonality_flag: 'peak_approaching' }), 1);
});
test('demand: momentum absent, no signals → null (missing)', () => {
  assert.equal(scoreDemand({ momentum_trend: 'stable' }), null);
});
test('demand: momentum absent + frontloading only (no m>0 confirm) → 0', () => {
  assert.equal(scoreDemand({ frontloading_flag: true }), 0);
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `node --test generators/web/forecast/score.test.js`
Expected: FAIL — first new case returns null (current guard), second/third differ.

- [ ] **Step 3: Replace `scoreDemand`**

```js
// C. 수요 (-2..+2).
// 우선순위: frontloading+양(+) 또는 ≥5%&accelerating → +2; peak_approaching는 크기 무관 +1(보합 가드 앞);
// 그 외 ±2%는 보합=0. 모멘텀이 결측이면 m 기반 규칙은 건너뛴다(계절성/프론트로딩만으로 판단).
function scoreDemand(d) {
  if (!d) return null;
  const m = d.export_momentum_yoy_pct;
  const hasM = m != null;
  const peak = d.seasonality_flag === 'peak_approaching';
  if (!hasM && !peak && !d.frontloading_flag) return null; // 전부 결측
  if ((hasM && m >= 5 && d.momentum_trend === 'accelerating') || (d.frontloading_flag && hasM && m > 0)) return 2;
  if (peak) return 1;
  if (!hasM) return 0; // 모멘텀 결측 + (frontloading만) → 보합
  if (Math.abs(m) <= 2) return 0;
  if (m > 0 && (d.momentum_trend === 'stable' || d.momentum_trend === 'accelerating')) return 1;
  if (m <= -5 && d.momentum_trend === 'decelerating') return -2;
  if (d.momentum_trend === 'decelerating' || m < 0) return -1;
  return 0;
}
```

- [ ] **Step 4: Run full suite to confirm pass (existing + new)**

Run: `node --test generators/web/forecast/`
Expected: PASS. Existing demand tests still hold: `{m:6,accelerating}`→2, `{m:1,stable}`→0, `{m:3,stable}`→1, `{m:-6,decelerating}`→-2, `{seasonality:'peak_approaching', m:1}`→1.

- [ ] **Step 5: Commit**

```bash
git add generators/web/forecast/score.js generators/web/forecast/score.test.js
git commit -m "fix(forecast): scoreDemand handles momentum-absent (seasonality/frontloading only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1: calendar seasonality helper

**Files:**
- Create: `generators/web/forecast/calendar.js`
- Test: `generators/web/forecast/calendar.test.js`

- [ ] **Step 1: Failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seasonalityFlag } = require('./calendar');

const d = (iso) => new Date(`${iso}T00:00:00Z`);

test('Jun/Jul → peak_approaching (ahead of Aug–Oct US peak)', () => {
  assert.equal(seasonalityFlag(d('2026-06-15')), 'peak_approaching');
  assert.equal(seasonalityFlag(d('2026-07-01')), 'peak_approaching');
});
test('Aug–Oct → peak', () => {
  assert.equal(seasonalityFlag(d('2026-09-10')), 'peak');
});
test('Dec → peak_approaching (pre-CNY frontloading)', () => {
  assert.equal(seasonalityFlag(d('2026-12-20')), 'peak_approaching');
});
test('Mar → none', () => {
  assert.equal(seasonalityFlag(d('2026-03-15')), 'none');
});
```

- [ ] **Step 2: Run → fail** (`node --test generators/web/forecast/calendar.test.js`).

- [ ] **Step 3: Implement**

```js
'use strict';
// 달력 기반 성수기 플래그(외부 데이터 불필요, 상수). Decision 3 cheap win.
// 근거: 미주/유럽 해상 성수기 8~10월 → 6~7월 선행 부킹; 춘절 전(12월) 공장 가동중단 대비 프론트로딩.
// CNY는 매년 변동(1월말~2월) — v1은 12월을 선행 근사로 둔다(분기 보정 시 정교화).
function seasonalityFlag(date) {
  const m = date.getUTCMonth() + 1; // 1..12
  if (m === 6 || m === 7) return 'peak_approaching';
  if (m >= 8 && m <= 10) return 'peak';
  if (m === 12) return 'peak_approaching';
  return 'none';
}

module.exports = { seasonalityFlag };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`git add generators/web/forecast/calendar.js generators/web/forecast/calendar.test.js`; message `feat(forecast): calendar seasonality flag`).

---

### Task 2: rate_series transform

Generic over `{ value, change_pct, date }` points (works for both monthly KITA `feu`/`feu_chg`/`year_mon` and weekly `value`/`change_pct`/`week_date`).

**Files:**
- Create: `generators/web/forecast/inputs/rate-series.js`
- Test: `generators/web/forecast/inputs/rate-series.test.js`

- [ ] **Step 1: Failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trend3p, percentile, buildRateSeries } = require('./rate-series');

test('trend3p: 3 consecutive positive change_pct → up_3', () => {
  assert.equal(trend3p([{ change_pct: 2 }, { change_pct: 1 }, { change_pct: 3 }]), 'up_3');
});
test('trend3p: 2 of 3 positive → up_2', () => {
  assert.equal(trend3p([{ change_pct: 2 }, { change_pct: -1 }, { change_pct: 3 }]), 'up_2');
});
test('trend3p: all negative → down_3', () => {
  assert.equal(trend3p([{ change_pct: -2 }, { change_pct: -1 }, { change_pct: -3 }]), 'down_3');
});
test('trend3p: fewer than 3 points → mixed', () => {
  assert.equal(trend3p([{ change_pct: 2 }]), 'mixed');
});

test('percentile: latest is max → 100', () => {
  assert.equal(percentile(100, [10, 50, 100]), 100);
});
test('percentile: latest mid → ~67', () => {
  assert.equal(percentile(50, [10, 50, 100]), 67);
});

test('buildRateSeries: assembles from desc points', () => {
  const points = [
    { value: 2850, change_pct: 6.2, date: '2026-05' },
    { value: 2684, change_pct: 3.0, date: '2026-04' },
    { value: 2606, change_pct: 1.5, date: '2026-03' },
  ];
  const rs = buildRateSeries(points, { unit: 'USD/FEU', asof: new Date('2026-06-05T00:00:00Z') });
  assert.equal(rs.latest, 2850);
  assert.equal(rs.unit, 'USD/FEU');
  assert.equal(rs.mom_pct, 6.2);
  assert.equal(rs.trend_3p, 'up_3');
  assert.equal(rs.percentile_52w, 100);
  assert.equal(rs.vs_normal_band, 'above');
  assert.equal(rs.asof_age_days >= 0, true);
});
test('buildRateSeries: empty → null', () => {
  assert.equal(buildRateSeries([], { unit: 'x', asof: new Date() }), null);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```js
'use strict';
// rate_series 조립 — {value, change_pct, date} 포인트 배열(최신순)에서 파생.
// date는 'YYYY-MM' | 'YYYY-MM-DD' | Date 허용.

function toDate(d) {
  if (d instanceof Date) return d;
  const s = String(d);
  const iso = s.length === 7 ? `${s}-01` : s; // 'YYYY-MM' → 월초
  return new Date(`${iso}T00:00:00Z`);
}

// 최근 3개 포인트의 change_pct 부호로 추세 분류.
function trend3p(points) {
  const last3 = points.slice(0, 3).map((p) => p.change_pct).filter((v) => v != null);
  if (last3.length < 3) return 'mixed';
  const pos = last3.filter((v) => v > 0).length;
  const neg = last3.filter((v) => v < 0).length;
  if (pos === 3) return 'up_3';
  if (neg === 3) return 'down_3';
  if (pos === 2) return 'up_2';
  if (neg === 2) return 'down_2';
  return 'mixed';
}

// latest 값의 백분위(<= latest 비율). 정수 반올림.
function percentile(latest, values) {
  const vals = values.filter((v) => v != null);
  if (!vals.length) return null;
  const le = vals.filter((v) => v <= latest).length;
  return Math.round((le / vals.length) * 100);
}

function buildRateSeries(points, { unit, asof }) {
  if (!points || !points.length) return null;
  const sorted = [...points].sort((a, b) => toDate(b.date) - toDate(a.date));
  const latest = sorted[0];
  const values = sorted.map((p) => p.value).filter((v) => v != null);
  const pct = percentile(latest.value, values);
  let band = 'within';
  if (pct != null && pct >= 70) band = 'above';
  else if (pct != null && pct <= 30) band = 'below';
  const ageDays = Math.round((asof - toDate(latest.date)) / 86400000);
  return {
    latest: latest.value,
    unit,
    mom_pct: latest.change_pct,
    trend_3p: trend3p(sorted),
    percentile_52w: pct,
    vs_normal_band: band,
    asof_age_days: ageDays,
  };
}

module.exports = { trend3p, percentile, buildRateSeries, toDate };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): rate_series transform (trend_3p, percentile, age)`).

---

### Task 3: blank_sailing transform + fetch

**Files:**
- Create: `generators/web/forecast/inputs/blank-sailing.js`
- Test: `generators/web/forecast/inputs/blank-sailing.test.js`

- [ ] **Step 1: Failing tests** (pure transform only)

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBlankSailing } = require('./blank-sailing');

const asof = new Date('2026-06-05T00:00:00Z');

test('rising blank_pct → expanding, ratio carried, tracker_quoted', () => {
  const rows = [
    { week_start: '2026-06-01', blank_pct: 12, source: 'Drewry' },
    { week_start: '2026-05-25', blank_pct: 8, source: 'Drewry' },
  ];
  const bs = buildBlankSailing(rows, asof);
  assert.equal(bs.source_type, 'tracker_quoted');
  assert.equal(bs.ratio_pct, 12);
  assert.equal(bs.direction, 'expanding');
  assert.equal(bs.magnitude_class, 'moderate'); // 7..15
  assert.equal(bs.geo_scope, 'trade_level_proxy');
  assert.equal(bs.signal_age_days, 4);
});
test('falling blank_pct → easing; >=15 major', () => {
  const rows = [
    { week_start: '2026-06-01', blank_pct: 16 },
    { week_start: '2026-05-25', blank_pct: 20 },
  ];
  const bs = buildBlankSailing(rows, asof);
  assert.equal(bs.direction, 'easing');
  assert.equal(bs.magnitude_class, 'major');
});
test('flat (±1pp) → stable', () => {
  const bs = buildBlankSailing([{ week_start: '2026-06-01', blank_pct: 6 }, { week_start: '2026-05-25', blank_pct: 6.5 }], asof);
  assert.equal(bs.direction, 'stable');
  assert.equal(bs.magnitude_class, 'minor');
});
test('no rows → source_type none', () => {
  assert.equal(buildBlankSailing([], asof).source_type, 'none');
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** (transform + fetch wrapper)

```js
'use strict';
// supply.blank_sailing 조립 — blank_sailings 테이블(주간 이력)에서 결정적으로.
// region 'East Asia' = transpacific proxy(한국발). 방향은 전주 대비 blank_pct 변화로.

function magnitudeClass(ratio) {
  if (ratio == null) return 'unknown';
  if (ratio >= 15) return 'major';
  if (ratio >= 7) return 'moderate';
  return 'minor';
}

// rows: blank_sailings 행(최신순). asof: Date.
function buildBlankSailing(rows, asof) {
  if (!rows || !rows.length) return { source_type: 'none' };
  const sorted = [...rows].sort((a, b) => new Date(b.week_start) - new Date(a.week_start));
  const latest = sorted[0];
  const prev = sorted[1];
  let direction = 'stable';
  if (prev && latest.blank_pct != null && prev.blank_pct != null) {
    const delta = latest.blank_pct - prev.blank_pct;
    if (delta > 1) direction = 'expanding';
    else if (delta < -1) direction = 'easing';
  }
  const ageDays = Math.round((asof - new Date(`${latest.week_start}T00:00:00Z`)) / 86400000);
  return {
    source_type: 'tracker_quoted',
    ratio_pct: latest.blank_pct != null ? latest.blank_pct : null,
    direction,
    magnitude_class: magnitudeClass(latest.blank_pct),
    independent_sources: 1,
    geo_scope: 'trade_level_proxy',
    signal_age_days: ageDays,
  };
}

// region='East Asia' 최근 8주를 읽어 transform.
async function fetchBlankSailing(supabase, asof = new Date()) {
  const { data } = await supabase
    .from('blank_sailings')
    .select('week_start,region,blank_pct,source')
    .eq('region', 'East Asia')
    .order('week_start', { ascending: false })
    .limit(8);
  return buildBlankSailing(data || [], asof);
}

module.exports = { buildBlankSailing, fetchBlankSailing, magnitudeClass };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): blank_sailing input from blank_sailings table`).

---

### Task 4: fuel (cost) transform + fetch

**Files:**
- Create: `generators/web/forecast/inputs/fuel.js`
- Test: `generators/web/forecast/inputs/fuel.test.js`

- [ ] **Step 1: Failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFuel } = require('./fuel');

const asof = new Date('2026-06-05T00:00:00Z');

test('mom from latest vs ~30d prior', () => {
  const rows = [
    { obs_date: '2026-06-04', price_usd: 600 },
    { obs_date: '2026-05-06', price_usd: 550 }, // ~29d prior
    { obs_date: '2026-04-01', price_usd: 500 },
  ];
  const f = buildFuel(rows, asof);
  assert.equal(Math.round(f.fuel_mom_pct), 9); // (600-550)/550 ≈ 9.09
  assert.equal(f.fuel_obs_lag_weeks <= 1, true);
});
test('insufficient history → null', () => {
  assert.equal(buildFuel([{ obs_date: '2026-06-04', price_usd: 600 }], asof), null);
});
test('empty → null', () => {
  assert.equal(buildFuel([], asof), null);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```js
'use strict';
// cost(유가) 조립 — bunker_prices VLSFO/Singapore 일간에서 MoM.
// 최신가 vs 약 28일 전(이전 관측 중 28일 이상 과거인 가장 가까운 행) 비교.

function buildFuel(rows, asof) {
  if (!rows || rows.length < 2) return null;
  const sorted = [...rows]
    .filter((r) => r.price_usd != null)
    .sort((a, b) => new Date(b.obs_date) - new Date(a.obs_date));
  if (sorted.length < 2) return null;
  const latest = sorted[0];
  const latestDate = new Date(`${latest.obs_date}T00:00:00Z`);
  const prior = sorted.find((r) => (latestDate - new Date(`${r.obs_date}T00:00:00Z`)) >= 28 * 86400000);
  if (!prior) return null;
  const momPct = ((latest.price_usd - prior.price_usd) / prior.price_usd) * 100;
  const lagWeeks = Math.round(((asof - latestDate) / 86400000 / 7) * 10) / 10;
  return { fuel_mom_pct: Math.round(momPct * 10) / 10, fuel_obs_lag_weeks: lagWeeks };
}

async function fetchFuel(supabase, asof = new Date()) {
  const { data } = await supabase
    .from('bunker_prices')
    .select('obs_date,price_usd,grade,port')
    .eq('grade', 'VLSFO')
    .eq('port', 'Singapore')
    .order('obs_date', { ascending: false })
    .limit(45);
  return buildFuel(data || [], asof);
}

module.exports = { buildFuel, fetchFuel };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): fuel cost input from bunker_prices VLSFO`).

---

### Task 5: demand transform + fetch

**Files:**
- Create: `generators/web/forecast/inputs/demand.js`
- Test: `generators/web/forecast/inputs/demand.test.js`

- [ ] **Step 1: Failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { exportMomentum, frontloadingFlag, buildDemand } = require('./demand');

const asof = new Date('2026-06-05T00:00:00Z');

test('exportMomentum: YoY from period totals', () => {
  const totals = [
    { period: '2026-05', total: 110 },
    { period: '2025-05', total: 100 },
  ];
  const r = exportMomentum(totals);
  assert.equal(r.yoy_pct, 10);
});
test('exportMomentum: no prior-year match → null', () => {
  assert.equal(exportMomentum([{ period: '2026-05', total: 110 }]).yoy_pct, null);
});

test('frontloadingFlag: policy effective within 60d → true', () => {
  assert.equal(frontloadingFlag([{ effective_date: '2026-07-01' }], asof), true);
});
test('frontloadingFlag: nothing imminent → false', () => {
  assert.equal(frontloadingFlag([{ effective_date: '2026-12-01' }], asof), false);
});

test('buildDemand: combines momentum + seasonality + frontloading', () => {
  const totals = [
    { period: '2026-05', total: 106 }, { period: '2026-04', total: 104 }, { period: '2026-03', total: 103 },
    { period: '2025-05', total: 100 }, { period: '2025-04', total: 100 }, { period: '2025-03', total: 100 },
  ];
  const d = buildDemand({ totals, policies: [{ effective_date: '2026-07-01' }], asof });
  assert.equal(d.export_momentum_yoy_pct, 6);
  assert.equal(d.seasonality_flag, 'none'); // June 5 → none (calendar)
  assert.equal(d.frontloading_flag, true);
  assert.ok(['accelerating', 'stable', 'decelerating'].includes(d.momentum_trend));
});
test('buildDemand: no totals but seasonality-only still returns object', () => {
  const d = buildDemand({ totals: [], policies: [], asof: new Date('2026-06-15T00:00:00Z') });
  assert.equal(d.export_momentum_yoy_pct, null);
  assert.equal(d.seasonality_flag, 'peak_approaching');
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```js
'use strict';
// demand 조립 — trade_statistics 국가합산 YoY + 달력 성수기 + 정책기반 프론트로딩.
const { seasonalityFlag } = require('../calendar');

function priorYear(period) {
  const [y, m] = period.split('-');
  return `${Number(y) - 1}-${m}`;
}

// totals: [{period:'YYYY-MM', total}] (정렬 무관). 최신 period의 YoY와 최근 3개월 추세.
function exportMomentum(totals) {
  if (!totals || !totals.length) return { yoy_pct: null, trend: null };
  const map = new Map(totals.map((t) => [t.period, t.total]));
  const periods = [...map.keys()].sort().reverse(); // 최신순
  const latest = periods[0];
  const yoyOf = (p) => {
    const cur = map.get(p);
    const prev = map.get(priorYear(p));
    if (cur == null || prev == null || prev === 0) return null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };
  const yoy = yoyOf(latest);
  // 추세: 최근 3개월 YoY 비교
  const yoys = periods.slice(0, 3).map(yoyOf).filter((v) => v != null);
  let trend = null;
  if (yoys.length >= 2) {
    if (yoys[0] > yoys[yoys.length - 1] + 0.5) trend = 'accelerating';
    else if (yoys[0] < yoys[yoys.length - 1] - 0.5) trend = 'decelerating';
    else trend = 'stable';
  }
  return { yoy_pct: yoy, trend };
}

function frontloadingFlag(policies, asof) {
  if (!policies || !policies.length) return false;
  const horizon = new Date(asof.getTime() + 60 * 86400000);
  return policies.some((p) => {
    if (!p.effective_date) return false;
    const eff = new Date(`${p.effective_date}T00:00:00Z`);
    return eff >= asof && eff <= horizon;
  });
}

function buildDemand({ totals, policies, asof }) {
  const mom = exportMomentum(totals);
  return {
    export_momentum_yoy_pct: mom.yoy_pct,
    momentum_trend: mom.trend,
    seasonality_flag: seasonalityFlag(asof),
    frontloading_flag: frontloadingFlag(policies, asof),
  };
}

// trade_statistics에서 국가합산 월별 export_usd 총액(YoY 위해 24개월) → buildDemand.
async function fetchDemand(supabase, asof = new Date()) {
  const since = `${asof.getUTCFullYear() - 2}-01`;
  const { data: rows } = await supabase
    .from('trade_statistics')
    .select('period,export_usd')
    .eq('stat_type', 'country')
    .gte('period', since);
  const sums = new Map();
  for (const r of rows || []) {
    if (r.export_usd == null) continue;
    sums.set(r.period, (sums.get(r.period) || 0) + Number(r.export_usd));
  }
  const totals = [...sums.entries()].map(([period, total]) => ({ period, total }));
  const { data: policies } = await supabase
    .from('policies')
    .select('effective_date')
    .gte('effective_date', asof.toISOString().slice(0, 10));
  return buildDemand({ totals, policies: policies || [], asof });
}

module.exports = { exportMomentum, frontloadingFlag, buildDemand, fetchDemand };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): demand input (export YoY + seasonality + frontloading)`).

---

### Task 6: targets (two-track declarations)

**Files:**
- Create: `generators/web/forecast/targets.js`
- Test: `generators/web/forecast/targets.test.js`

- [ ] **Step 1: Failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WEEKLY_TARGETS, horizonDate, MAJOR_DEST_KEYWORDS } = require('./targets');

test('weekly targets: KCCI primary, SCFI secondary, ocean/weekly', () => {
  const codes = WEEKLY_TARGETS.map((t) => t.metric_ref);
  assert.deepEqual(codes, ['KCCI', 'SCFI']);
  assert.ok(WEEKLY_TARGETS.every((t) => t.mode === 'ocean' && t.cadence === 'weekly'));
});
test('horizonDate: asof + weeks', () => {
  assert.equal(horizonDate(new Date('2026-06-05T00:00:00Z'), 4), '2026-07-03');
});
test('major dest keywords non-empty', () => {
  assert.ok(MAJOR_DEST_KEYWORDS.length >= 2);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```js
'use strict';
// 두 트랙 타깃 선언. 주간(주력): freight_indices 한국발 지수. 월간: KITA 항로(데이터 기반 발견).
// 각 타깃: { metric_ref, source, mode, cadence, horizon_weeks, label }

const WEEKLY_TARGETS = [
  { metric_ref: 'KCCI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'KCCI 종합(한국발 해상)' },
  { metric_ref: 'SCFI', source: 'freight_indices', mode: 'ocean', cadence: 'weekly', horizon_weeks: 4, label: 'SCFI 종합' },
];

// 월간 KITA 항로는 데이터에서 발견(아래 fetchMonthlyTargets). 주요 도착지 키워드(부분일치)로 한정.
const MAJOR_DEST_KEYWORDS = ['로스앤젤레스', 'LA', '뉴욕', 'New York', '로테르담', 'Rotterdam', '함부르크', 'Hamburg'];

function horizonDate(asof, weeks) {
  const d = new Date(asof.getTime() + weeks * 7 * 86400000);
  return d.toISOString().slice(0, 10);
}

// kita_sea_rates에서 ≥3개월 데이터 + 주요 도착지인 (origin,dest) 항로를 월간 타깃으로.
async function fetchMonthlyTargets(supabase) {
  const { data } = await supabase
    .from('kita_sea_rates')
    .select('origin,dest,year_mon');
  const byLane = new Map();
  for (const r of data || []) {
    const key = `${r.origin}__${r.dest}`;
    byLane.set(key, (byLane.get(key) || 0) + 1);
  }
  const targets = [];
  for (const [key, count] of byLane.entries()) {
    if (count < 3) continue;
    const [origin, dest] = key.split('__');
    if (!MAJOR_DEST_KEYWORDS.some((k) => dest.includes(k))) continue;
    targets.push({
      metric_ref: `kita_sea_rates:${origin}-${dest}`,
      source: 'kita_sea_rates', origin, dest,
      mode: 'ocean', cadence: 'monthly', horizon_weeks: 4,
      label: `${origin}→${dest}`,
    });
  }
  return targets;
}

module.exports = { WEEKLY_TARGETS, MAJOR_DEST_KEYWORDS, horizonDate, fetchMonthlyTargets };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): two-track target declarations`).

---

### Task 7: assembleInput orchestration + read-only smoke

**Files:**
- Create: `generators/web/forecast/assemble.js`
- Create: `generators/web/forecast/smoke-assemble.js` (read-only script — prints assembled inputs + score; no DB writes)
- Modify: `package.json` (add `forecast:smoke`)

- [ ] **Step 1: Implement assemble.js**

```js
'use strict';
// 타깃 1개 → scoreForecast 입력 객체 조립(공통 supply/cost/demand + 타깃별 rate_series).
const { buildRateSeries } = require('./inputs/rate-series');
const { fetchBlankSailing } = require('./inputs/blank-sailing');
const { fetchFuel } = require('./inputs/fuel');
const { fetchDemand } = require('./inputs/demand');
const { horizonDate } = require('./targets');

async function fetchRateSeries(supabase, target, asof) {
  if (target.source === 'freight_indices') {
    const { data } = await supabase
      .from('freight_indices')
      .select('value,change_pct,week_date')
      .eq('index_code', target.metric_ref)
      .order('week_date', { ascending: false })
      .limit(52);
    const points = (data || []).map((r) => ({ value: r.value, change_pct: r.change_pct, date: r.week_date }));
    return buildRateSeries(points, { unit: 'index', asof });
  }
  // kita_sea_rates
  const { data } = await supabase
    .from('kita_sea_rates')
    .select('feu,feu_chg,year_mon')
    .eq('origin', target.origin)
    .eq('dest', target.dest)
    .order('year_mon', { ascending: false })
    .limit(13);
  const points = (data || []).map((r) => ({ value: r.feu, change_pct: r.feu_chg, date: r.year_mon }));
  return buildRateSeries(points, { unit: 'USD/FEU', asof });
}

// 공통 입력(supply/cost/demand)은 타깃마다 재조회를 피하려 호출부에서 1회 만들어 주입할 수 있음.
async function assembleInput(supabase, target, { asof = new Date(), shared } = {}) {
  const rate_series = await fetchRateSeries(supabase, target, asof);
  const supply = shared?.supply ?? { blank_sailing: await fetchBlankSailing(supabase, asof) };
  const cost = shared?.cost ?? await fetchFuel(supabase, asof);
  const demand = shared?.demand ?? await fetchDemand(supabase, asof);
  return {
    metric_ref: target.metric_ref,
    label: target.label,
    mode: target.mode,
    cadence: target.cadence,
    horizon_date: horizonDate(asof, target.horizon_weeks),
    rate_series,
    supply,
    cost,
    demand,
    pricing_actions: null,
  };
}

// 공통 입력 1회 조립(여러 타깃 공유).
async function buildShared(supabase, asof = new Date()) {
  return {
    supply: { blank_sailing: await fetchBlankSailing(supabase, asof) },
    cost: await fetchFuel(supabase, asof),
    demand: await fetchDemand(supabase, asof),
  };
}

module.exports = { assembleInput, buildShared, fetchRateSeries };
```

- [ ] **Step 2: Implement smoke-assemble.js** (read-only; verifies end-to-end against the real DB, prints, writes nothing)

```js
'use strict';
// 읽기 전용 스모크: 모든 타깃의 입력을 조립하고 scoreForecast 결과를 출력. DB 쓰기 없음.
// 실행: node generators/web/forecast/smoke-assemble.js
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { WEEKLY_TARGETS, fetchMonthlyTargets } = require('./targets');
const { assembleInput, buildShared } = require('./assemble');
const { scoreForecast } = require('./score');

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const asof = new Date();
  const shared = await buildShared(supabase, asof);
  const monthly = await fetchMonthlyTargets(supabase);
  const targets = [...WEEKLY_TARGETS, ...monthly];
  console.log(`타깃 ${targets.length}개 (주간 ${WEEKLY_TARGETS.length} · 월간 ${monthly.length})`);
  for (const t of targets) {
    const input = await assembleInput(supabase, t, { asof, shared });
    const r = scoreForecast(input);
    if (r.abstain) {
      console.log(`⏸️  ${t.label} [${t.metric_ref}] → abstain: ${r.reason}`);
    } else {
      console.log(`📈 ${t.label} [${t.metric_ref}] → ${r.direction}/${r.strength} ${r.expected_range_pct ?? ''} (comp ${r.composite_score}, conf ${r.confidence}) flags:[${r.data_quality_flags.join('; ')}]`);
    }
  }
}

main().catch((e) => { console.error('smoke 실패:', e.message); process.exit(1); });
```

- [ ] **Step 3: Add npm script** to `package.json`:

```json
"forecast:smoke": "node generators/web/forecast/smoke-assemble.js",
```

- [ ] **Step 4: Run unit suite** (`node --test generators/web/forecast/`) — all green (no new unit tests for assemble; it's I/O glue covered by the smoke).

- [ ] **Step 5: (Manual, optional) run the smoke** `npm run forecast:smoke` against the DB to eyeball real outputs — read-only, safe. Do not block the commit on data availability (abstain output is expected where data is sparse).

- [ ] **Step 6: Commit** (`feat(forecast): assembleInput orchestration + read-only smoke`).

---

## Self-Review notes

- **Decision 2 (two tracks):** `WEEKLY_TARGETS` (KCCI/SCFI) + `fetchMonthlyTargets` (KITA lanes, data-discovered, major-dest filtered). Each carries `cadence` consumed by Plan A's `STALE_DAYS`. KCCI per-lane weekly remains backlog (no per-lane KCCI codes in `freight_indices` yet).
- **Decision 3 (partial data):** every transform returns `null`/`{source_type:'none'}` when its table is empty → Plan A reweights and records `data_quality_flags`. `seasonalityFlag` + policy-derived `frontloading_flag` are the calendar/policy cheap wins; `scoreDemand` (Task 0) now scores seasonality-only demand. Trade-stats YoY needs ≥13 months — sparse data simply yields `export_momentum=null` (handled).
- **No LLM, no DB writes** anywhere in Plan B — pure transforms + read-only fetches + read-only smoke. E factor (pricing GRI/PSS) is intentionally `null` here (carrier_advisories integration is a Plan C/backlog item).
- **Type consistency:** assembled object keys match exactly what `scoreForecast(input)` reads (`mode`, `cadence`, `rate_series`, `supply.blank_sailing`, `cost`, `demand`, `pricing_actions`).
- **Pricing/E factor + news_derived supply (LLM Stage 1)** deferred to keep Plan B deterministic; noted for Plan C/backlog.
