# Forecast Pipeline — Plan B (v1.3): Expanded Input Assemblers

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sequential only (NO parallel). Each task: self-contained brief (this plan's task section + the SSOT section + CLAUDE.md constraints) → `node --test` green + acceptance check → next.

**SSOT:** `freight-rate-forecast-prompt.md v1.3` + `blank-sailing-news-pipeline.md v1.0`. Scoring rules (A–E, weights, composite, confidence, abstain) are **unchanged from v1.1** → Plan A `score.js`/`config` reused as-is. v1.3 deltas are **input_schema enrichment** + `watch_points` output + (Plan C) style/heuristics/validation.

**Goal:** Assemble the fuller v1.3 `<input_schema>` per target — adding `blank_sailing.evidence`, `supply.notes`, `pricing_actions`, `cost.surcharge_events`, `context_events`, `context_headlines`, `modal_shift_trigger`, `data_freshness` — from real pipeline tables, so KCCI weekly + KITA monthly targets assemble a 5-factor JSON with missing-count **2 → 0–1**.

**Repo:** Pipeline `C:\Users\DELL\Documents\logisight`. Builds on existing `generators/web/forecast/` (Plan A + Plan B v1.1).

**Grounding (verified 2026-06-06, read-only DB):**
- `freight_indices`: KCCI/SCFI/CCFI present + **per-lane KCCI weekly codes** (KCCI_USWC, KCCI_NEU, KCCI_MED, KCCI_USEC, …) + SCFI_USWC/USEC/EU. → weekly track promotable to lane level.
- `trade_statistics`: provisional_exp/imp **empty** (only stat_type='item' present) → T0-1 builds but yields 결측 until `trade_provisional` collector runs.
- `carrier_advisories` GRI/PSS: **not captured** (0/313 maritime_news titles match) → T0-4 = admin-form path + report.
- MPCI/congestion: **no table** → T0-3 = notes empty + backlog.

**CLAUDE.md constraints (apply to every task):** no dummy/old-value substitution on collect failure → 결측 (weight redistribution); record every new/linked source in `data_updates` (dataset, updated_at, status); one workflow file per responsibility (no merging); scraping limited to free public headline figures (no login bypass / paid content); ocean/air mode-group separation; air rate 4-element display rule (downstream); no causal 단정 (narrate/Plan C).

---

## Task order (sequential)

T0-6 → T0-5 → T0-2 → T0-1 → context_headlines → watch_points migration → T0-3 → T0-4 → T0-7 → T1-2 → T1-1. (Deterministic/no-dep first; external-fetch + LLM last.)

---

### T0-6: data_release_calendar constants

**Files:** Create `generators/web/forecast/data-release-calendar.js` (+ `.test.js`).

**Spec:** 발표 캘린더 상수 — 관세청 잠정(11·21일경)·확정(15일), KCCI(주간), Drewry 결항(주간)·우회(격주), IATA 제트유(주간), NRF GPT(월간). `watch_points.due` 자동 채움 기반. **발표 요일은 추정 하드코딩 금지** — 빌드 시 각 소스 페이지에서 확인해 상수에 기록하고 확인 일자를 주석으로 남길 것.

- [ ] **Step 1: failing test** (`data-release-calendar.test.js`)

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RELEASE_CALENDAR, nextDue } = require('./data-release-calendar');

test('calendar has the SSOT datasets', () => {
  const ids = RELEASE_CALENDAR.map((r) => r.id);
  for (const k of ['kcta_provisional', 'kcta_final', 'kcci_weekly', 'drewry_blank', 'drewry_diversion', 'iata_jet'])
    assert.ok(ids.includes(k), `missing ${k}`);
});
test('nextDue: monthly day-of-month → next occurrence on/after asof', () => {
  const r = { cadence: 'monthly', day_of_month: 15 };
  assert.equal(nextDue(r, new Date('2026-06-06T00:00:00Z')), '2026-06-15');
  assert.equal(nextDue(r, new Date('2026-06-20T00:00:00Z')), '2026-07-15');
});
test('nextDue: weekly weekday → next occurrence', () => {
  // weekday 1 = Monday
  assert.equal(nextDue({ cadence: 'weekly', weekday: 1 }, new Date('2026-06-06T00:00:00Z')), '2026-06-08');
});
```

- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement.** Before writing the weekday/day values, FETCH each source's public page and confirm the actual release weekday; record it in the constant with an inline `// confirmed 2026-06-DD: <evidence>` comment. Do NOT guess. Structure:

```js
'use strict';
// 발표 캘린더. 각 항목의 weekday/day_of_month는 소스 페이지에서 확인 후 기록(확인일자 주석 필수).
// cadence: 'weekly'(weekday 0=일..6=토) | 'monthly'(day_of_month) | 'biweekly'(anchor + weekday)
const RELEASE_CALENDAR = [
  // 관세청 10일 잠정: 통상 11·21일경 + 익월 1일경(말일분). // confirm at build
  { id: 'kcta_provisional', label: '관세청 10일 잠정 수출', cadence: 'monthly', day_of_month: 11, source: '관세청' },
  { id: 'kcta_final', label: '관세청 월간 확정', cadence: 'monthly', day_of_month: 15, source: '관세청' },
  { id: 'kcci_weekly', label: 'KCCI 주간', cadence: 'weekly', weekday: null /* confirm */, source: 'KOBC/KCCI' },
  { id: 'drewry_blank', label: 'Drewry 결항 트래커', cadence: 'weekly', weekday: null /* confirm */, source: 'Drewry' },
  { id: 'drewry_diversion', label: 'Drewry Red Sea 우회', cadence: 'biweekly', weekday: null /* confirm */, source: 'Drewry' },
  { id: 'iata_jet', label: 'IATA 제트유 모니터', cadence: 'weekly', weekday: null /* confirm */, source: 'IATA/Platts' },
];
function pad(n) { return String(n).padStart(2, '0'); }
function nextDue(rule, asof) {
  const d = new Date(asof);
  if (rule.cadence === 'monthly') {
    let y = d.getUTCFullYear(); let m = d.getUTCMonth();
    if (d.getUTCDate() > rule.day_of_month) { m += 1; if (m > 11) { m = 0; y += 1; } }
    return `${y}-${pad(m + 1)}-${pad(rule.day_of_month)}`;
  }
  if (rule.weekday == null) return null;
  const cur = d.getUTCDay();
  const add = (rule.weekday - cur + 7) % 7 || 7; // 다음 해당 요일(당일 제외 시 7)
  const nd = new Date(d.getTime() + add * 86400000);
  return nd.toISOString().slice(0, 10);
}
module.exports = { RELEASE_CALENDAR, nextDue };
```

**Acceptance:** tests pass; every `weekday: null /* confirm */` either filled with a source-confirmed value + dated comment, OR left null with the dataset flagged in the report as "발표 요일 미확인". Record `data_updates` not applicable (constants).
- [ ] **Step 4: run → pass. Commit** `feat(forecast): data_release_calendar constants`.

---

### T0-5: seasonality + frontloading (extend existing `calendar.js`)

**Spec:** 달력 상수(성수기·춘절·골든위크) → `seasonality_flag` (peak_approaching|peak|**off**|none); `frontloading_flag` ← policies 시행 D−60. v1.3 enum adds `off` (post-peak) vs current `none`.

- [ ] **Step 1: add failing tests** to `calendar.test.js`:

```js
test('Nov → off (post-peak wind-down)', () => {
  assert.equal(seasonalityFlag(d('2026-11-15')), 'off');
});
```

- [ ] **Step 3: extend `seasonalityFlag`** to return `'off'` for the post-peak months (Nov) per SSOT; keep Jun/Jul→peak_approaching, Aug–Oct→peak, Dec→peak_approaching (pre-CNY), else none. frontloading already in `demand.js`. Confirm at build that the off-window matches SSOT intent; comment.

**Acceptance:** enum ∈ {peak_approaching, peak, off, none}; existing tests still green.
- [ ] **Commit** `feat(forecast): seasonality off-flag (v1.3 enum)`.

---

### T0-2: spot–contract spread (SCFI/KCCI vs CCFI) — H3 input

**Files:** Create `generators/web/forecast/inputs/spread.js` (+ test).

**Spec:** SCFI/KCCI(현물) vs CCFI(계약) 스프레드 + **8주 지속 플래그**. 점수 아님 → `context_events` 서사·H3 입력으로. SSOT H3: 현물이 계약 위 8주↑ → 계약가 상방 압력.

- [ ] **Step 1: failing tests** — pure transform on two index series:

```js
const { buildSpread } = require('./spread');
test('spread: spot above contract, 8w persistence → flag', () => {
  // 9 weeks where spot index level > contract level
  const spot = Array.from({length:9},(_,i)=>({ value: 1100+i, date: `2026-0${''}`.length?null:null }));
  // (use real-ish dates)
});
```

(Write the test with 9 weekly points each for spot+contract; assert `{ spread_pct, above_weeks, persistent_8w: true, direction }`.)

- [ ] **Step 3: implement** `buildSpread(spotPoints, contractPoints)`:
  - Align by week_date; `spread_pct = (spotLatest − contractLatest)/contractLatest × 100`.
  - `above_weeks` = consecutive most-recent weeks where spot level > contract level; `persistent_8w = above_weeks >= 8` (sign-symmetric for below).
  - Return `{ spread_pct, above_weeks, persistent_8w, direction: 'spot_above'|'spot_below'|'aligned' }`. Null/`{available:false}` if either series < 8 points.
  - `fetchSpread(supabase, spotCode, contractCode='CCFI')` reads freight_indices for both.
  - Emit into assembled input as a `context_events` string e.g. `현물-계약 스프레드 +Y% (N주 지속)` — NOT a factor score.

**Acceptance:** KCCI vs CCFI spread computes; persistence flag correct at the 8-week boundary; result lands in `context_events`, never in `factor_scores`.
- [ ] **Commit** `feat(forecast): spot-contract spread (H3 input)`.

---

### T0-1: demand by region (관세청 10일 잠정)

**Files:** `generators/web/forecast/inputs/demand-region.js` (+ test). Extends existing `demand.js`.

**Spec:** trade_statistics `provisional_exp` 행을 권역(EU·미주·CIS·중동·동남아)으로 매핑 → `export_momentum_yoy_pct`·`momentum_trend`. 확정치(item/country)는 검증·백업. **데이터 현재 비어있음 → 결측 반환 정상.**

- [ ] **Step 1: failing tests** — pure: `regionOf(countryCode)` map + `buildRegionDemand(rows, region, asof)` YoY from provisional totals (reuse `exportMomentum` logic from `demand.js`).
- [ ] **Step 3: implement** the country→region map (derive from `collectors/trade_provisional.ts` EXP_COUNTRY_MAP; read it at build), aggregate provisional_exp `export_usd` per region per period, YoY vs prior-year same 잠정 구간. Return `{ export_momentum_yoy_pct, momentum_trend }` or nulls (결측) when no provisional rows. Record `data_updates('trade_provisional', …)` when present.

**Acceptance:** region map covers EU/미주/CIS/중동/동남아; with current empty provisional data returns nulls (결측) without throwing; when data present, YoY matches manual calc. Note in report: collector run needed to populate.
- [ ] **Commit** `feat(forecast): region demand from 관세청 provisional`.

---

### context_headlines (v1.3 input) + watch_points migration

**context_headlines:** in `assemble.js`, build `context_headlines: [{title, source, published}]` from maritime_news last-14d filtered by the target's route/trade keywords (lane origin/dest + trade lane terms). Cap 8. (narrate v1.3 will consume; scores unaffected.)
- [ ] Test `buildContextHeadlines(newsRows, target)` filters by keyword + caps. Commit.

**watch_points migration (Plan C precondition):**
- [ ] Create `supabase/migrations/20260607010000_forecasts_watch_points.sql`: `alter table forecasts add column if not exists watch_points jsonb;` + extend the immutability guard to include `watch_points`. **File + commit only — user applies** (per established flow).

---

### T0-3: supply.notes from MPCI — NO DATA

**Spec:** MPCI 혼잡도 → effective_capacity 보조 신호(notes, 점수 아님). **No MPCI table exists.**
- [ ] Wire `supply.notes` passthrough in assemble (array, default `[]`). Add `buildSupplyNotes(mpciRows=[])` returning structured strings when present. With no source → empty + **report backlog: "MPCI 혼잡도 데이터 소스 없음"**. No score impact (notes only).
- [ ] Commit `feat(forecast): supply.notes wiring (MPCI source pending — backlog)`.

---

### T0-4: pricing_actions (GRI/PSS) — admin-form path

**Spec:** carrier_advisories GRI/PSS 캡처 확인 → 있으면 announcements 매핑, **없으면 admin 입력 폼 경로로 보고.** Verified: **not captured.**
- [ ] `buildPricingActions(advisoryRows)` parses GRI/PSS/인하 from advisory titles → `{ announcements:[{type,effective,magnitude}], historical_success_rate:null }`. With current data → empty (결측). 
- [ ] Report: GRI not captured → recommend admin input form (add `pricing_actions` fields to `/admin/forecasts` draft editor, Plan C/backlog). 
- [ ] Commit `feat(forecast): pricing_actions parser (GRI capture absent — admin-form path)`.

---

### T0-7: blank_sailing — drewry-headline + news_derived (Stage 1/2)

**Files:** extend `inputs/blank-sailing.js`. **SSOT:** `blank-sailing-news-pipeline.md` — 14일 만료, trade_level_proxy 라벨, 독립 출처 수, Stage1 추출 + Stage2 집계.

- [ ] Add `evidence:[{source,published,claim}]` to the existing `buildBlankSailing` output (from blank_sailings rows: source, week_start, claim string).
- [ ] **news_derived fallback:** when `blank_sailings` table is stale/empty, tag maritime_news for 결항 keywords (blank sailing/void/cancelled sailing/결항) last-14d → **Stage 1** per-article LLM extraction (trade, direction, magnitude_class, data_origin) → **Stage 2** rule aggregate (independent_sources = distinct data_origin; direction vote; 14-day expiry → source_type='none'). Produces `source_type='news_derived'` blank_sailing with `geo_scope='trade_level_proxy'`, `confidence 상한 중간`.
- [ ] Tests: evidence shape; Stage2 aggregation (independent_sources, direction vote, expiry). Stage1 (LLM) tested with a fake extractor.

**Acceptance:** tracker_quoted path unchanged + evidence added; news_derived path aggregates per SSOT (14-day expiry, proxy label, independent-source count); LLM injected (testable). 
- [ ] Commit `feat(forecast): blank_sailing evidence + news_derived Stage1/2`.

---

### T1-2: IATA Jet Fuel Price Monitor (air cost)

**Spec:** 주간 헤드라인 수치만. 표기 시 출처(IATA/S&P Global Platts) 의무, 시계열 원본 재배포 금지. 항공 cost 팩터 입력.
- [ ] At build, FETCH the IATA Jet Fuel Price Monitor public page; confirm structure; parse the headline index/price + WoW. Selectors written against the live page (no guessing). Persist to a small `jet_fuel` table (migration) or `data_updates`. `buildAirFuel()` → `cost.fuel_mom_pct` (air). Source attribution stored.
- [ ] Commit `feat(forecast): IATA jet fuel monitor (air cost)`.

---

### T1-1: Drewry Red Sea Diversion Tracker (H5)

**Spec:** 격주 파서 — 기존 `drewry-headline.js` 확장. 수에즈/희망봉 비중 → `effective_capacity_chg_pct`(H5 입력, SSOT: 우회 확대 = 유효 선복 −10~15%).
- [ ] At build, FETCH the Drewry diversion tracker public page; parse suez/cape share headline. Map diversion share → `effective_capacity_chg_pct` per SSOT band. Biweekly cadence (data_release_calendar).
- [ ] Commit `feat(forecast): Drewry diversion → effective_capacity (H5)`.

---

## Completion criteria (per the spec)

- KCCI weekly target (promote to a lane code, e.g. `KCCI_USWC`) + one KITA monthly lane: assembled 5-factor input JSON includes correct 결측 labels and **missing-count 2 → 0–1** (cost fills as bunker history reaches 28d; pricing remains 결측 via admin-form path → 1).
- Each assembler: pure function + one **real-DB smoke** (shape verification, read-only).
- Report: GRI capture result (done: not captured), 발표 요일 confirmation (per T0-6 build), backlog list (MPCI, NRF GPT, Eurostat/PMI, 한국 매체).

## Out of scope (backlog — record only)
MPCI 데이터 소스, NRF GPT, Eurostat/PMI, 한국 매체 소스. narrate v1.3 (style_rules/H1–H10/narration_validation + MODEL_VERSION 'v1.3') = **Plan C**.
