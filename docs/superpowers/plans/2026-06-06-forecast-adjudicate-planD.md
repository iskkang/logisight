# Forecast Pipeline — Plan D: Auto-Adjudication

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** At/after a published forecast's `horizon_date`, fetch the `metric_ref` realized value, compute `realized_pct` vs `metric_value_at_publish`, deterministically classify the outcome (hit/partial/miss) against the predicted direction+range, and auto-resolve the row — leaving `outcome_note` null so the frontend shows "복기 작성 중" for miss/partial until an editor writes it.

**Architecture:** Pure `classifyOutcome` (direction+range+realized% → hit/partial/miss) is the testable heart. `fetchActual` resolves the realized value for a `metric_ref` (freight_indices code OR `kita_sea_rates:origin-dest`). `adjudicate.js` orchestrates: query due published rows → realized% → classify → update (service role; outcome/realized_pct/resolved_at/status only — all mutable post-publish per the immutability trigger). Adjudication NEVER edits the prose/scoring fields. Hit-rate is computed over ALL published (no sample exclusion) — Plan D only writes outcomes; the hit-rate readout is the existing frontend footer.

**Tech Stack:** Node.js (CommonJS), `node:test`, `@supabase/supabase-js` (service role) + `ws` polyfill.

**Repo:** Pipeline `C:\Users\DELL\Documents\logisight`. Builds on the `forecasts` schema (Plan A migration) + Plan C drafts.

**Run-time note (NOT implementation):** Running `adjudicate.js` writes `outcome`/`resolved_at` to published rows. The implementer must NOT run it. Unit tests use fakes — zero network/DB.

**Methodology (CLAUDE.md):** adjudication is auto-confirmed (Decision ①); `outcome_note` (복기) is an editorial act left to the editor. Outcomes are immutable once resolved except `outcome_note` (the trigger allows it). Hit-rate = published 전수, no exclusion.

---

### Task 1: classifyOutcome (pure)

**Files:**
- Create: `generators/web/forecast/adjudicate/outcome.js`
- Test: `generators/web/forecast/adjudicate/outcome.test.js`

- [ ] **Step 1: Failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyOutcome } = require('./outcome');

// up, 예측 범위 +3~7
const up = { direction: 'up', range_low_pct: 3, range_high_pct: 7 };
test('up: realized within band → hit', () => {
  assert.equal(classifyOutcome(up, 5), 'hit');
  assert.equal(classifyOutcome(up, 3), 'hit');
  assert.equal(classifyOutcome(up, 7), 'hit');
});
test('up: right direction, outside band → partial', () => {
  assert.equal(classifyOutcome(up, 1.5), 'partial'); // 올랐지만 밴드 미만
  assert.equal(classifyOutcome(up, 9), 'partial');   // 예상보다 더 상승
});
test('up: wrong direction (<=0) → miss', () => {
  assert.equal(classifyOutcome(up, 0), 'miss');
  assert.equal(classifyOutcome(up, -2), 'miss');
});

// down, 예측 범위 -7~-3
const down = { direction: 'down', range_low_pct: -7, range_high_pct: -3 };
test('down: within band → hit', () => {
  assert.equal(classifyOutcome(down, -5), 'hit');
});
test('down: right direction, outside band → partial', () => {
  assert.equal(classifyOutcome(down, -1), 'partial');
  assert.equal(classifyOutcome(down, -9), 'partial');
});
test('down: wrong direction (>=0) → miss', () => {
  assert.equal(classifyOutcome(down, 0), 'miss');
  assert.equal(classifyOutcome(down, 2), 'miss');
});

// flat (range null) — ±1% 이내 적중
const flat = { direction: 'flat', range_low_pct: null, range_high_pct: null };
test('flat: |realized|<=1 → hit, else miss', () => {
  assert.equal(classifyOutcome(flat, 0.5), 'hit');
  assert.equal(classifyOutcome(flat, -1), 'hit');
  assert.equal(classifyOutcome(flat, 3), 'miss');
});
test('null realized → null (cannot judge)', () => {
  assert.equal(classifyOutcome(up, null), null);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```js
'use strict';
// 예측(direction + range) vs 실측 변화율(realizedPct) → 'hit' | 'partial' | 'miss' | null.
// 문서 규칙: 범위 안=적중, 방향만 맞음=부분, 방향 틀림=비적중. flat은 ±1% 이내=적중.
function classifyOutcome(forecast, realizedPct) {
  if (realizedPct == null || Number.isNaN(realizedPct)) return null;
  const { direction, range_low_pct: lo, range_high_pct: hi } = forecast;
  if (direction === 'flat') return Math.abs(realizedPct) <= 1 ? 'hit' : 'miss';
  if (direction === 'up') {
    if (lo != null && hi != null && realizedPct >= lo && realizedPct <= hi) return 'hit';
    return realizedPct > 0 ? 'partial' : 'miss';
  }
  if (direction === 'down') {
    if (lo != null && hi != null && realizedPct >= lo && realizedPct <= hi) return 'hit';
    return realizedPct < 0 ? 'partial' : 'miss';
  }
  return null;
}

module.exports = { classifyOutcome };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): classifyOutcome (hit/partial/miss)`).

---

### Task 2: fetchActual (realized value for a metric_ref)

**Files:**
- Create: `generators/web/forecast/adjudicate/fetch-actual.js`
- Test: `generators/web/forecast/adjudicate/fetch-actual.test.js`

- [ ] **Step 1: Failing tests** (pure parse + selection; fetch wrapper not unit-tested)

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMetricRef, pickRealized } = require('./fetch-actual');

test('parseMetricRef: freight index code', () => {
  assert.deepEqual(parseMetricRef('KCCI'), { kind: 'index', code: 'KCCI' });
});
test('parseMetricRef: kita lane', () => {
  assert.deepEqual(parseMetricRef('kita_sea_rates:부산-로스앤젤레스'),
    { kind: 'kita', origin: '부산', dest: '로스앤젤레스' });
});

test('pickRealized: first row on/after horizon (rows desc by date)', () => {
  const rows = [
    { value: 1300, date: '2026-07-06' },
    { value: 1280, date: '2026-07-03' }, // == horizon
    { value: 1200, date: '2026-06-26' },
  ];
  // horizon 2026-07-03 → 그 시점 이후 가장 이른 관측(=horizon 당일/직후)
  assert.equal(pickRealized(rows, '2026-07-03'), 1280);
});
test('pickRealized: none on/after horizon → null (아직 도래 안함)', () => {
  const rows = [{ value: 1200, date: '2026-06-26' }];
  assert.equal(pickRealized(rows, '2026-07-03'), null);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```js
'use strict';
// metric_ref → 실측값. 'KCCI'/'SCFI'(freight_indices) 또는 'kita_sea_rates:origin-dest'.

function parseMetricRef(ref) {
  if (ref && ref.startsWith('kita_sea_rates:')) {
    const [origin, dest] = ref.slice('kita_sea_rates:'.length).split('-');
    return { kind: 'kita', origin, dest };
  }
  return { kind: 'index', code: ref };
}

// rows: [{value, date}] 최신순. horizon 당일 또는 그 직후의 가장 이른 관측을 실측으로.
function pickRealized(rows, horizonDate) {
  const onOrAfter = (rows || [])
    .filter((r) => r.value != null && String(r.date) >= String(horizonDate))
    .sort((a, b) => String(a.date).localeCompare(String(b.date))); // 오름차순
  return onOrAfter.length ? onOrAfter[0].value : null;
}

async function fetchActual(supabase, metricRef, horizonDate) {
  const m = parseMetricRef(metricRef);
  if (m.kind === 'index') {
    const { data } = await supabase
      .from('freight_indices')
      .select('value,week_date')
      .eq('index_code', m.code)
      .order('week_date', { ascending: false })
      .limit(20);
    return pickRealized((data || []).map((r) => ({ value: r.value, date: r.week_date })), horizonDate);
  }
  const { data } = await supabase
    .from('kita_sea_rates')
    .select('feu,year_mon')
    .eq('origin', m.origin)
    .eq('dest', m.dest)
    .order('year_mon', { ascending: false })
    .limit(6);
  // year_mon은 'YYYYMM' → 비교 위해 'YYYY-MM-01'로 정규화
  const norm = (ym) => `${String(ym).slice(0, 4)}-${String(ym).slice(4, 6)}-01`;
  return pickRealized((data || []).map((r) => ({ value: r.feu, date: norm(r.year_mon) })), horizonDate);
}

module.exports = { parseMetricRef, pickRealized, fetchActual };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): fetchActual (realized value per metric_ref)`).

---

### Task 3: adjudicate orchestration

**Files:**
- Create: `generators/web/forecast/adjudicate.js`
- Test: `generators/web/forecast/adjudicate.test.js`
- Modify: `package.json` (`adjudicate:forecasts`)

- [ ] **Step 1: Implement adjudicate.js**

```js
'use strict';
// 자동 판정: horizon 도래 + 미판정(published, outcome null) 전망의 실측값으로 outcome 자동 확정.
// outcome_note는 비워둠(에디터 복기). 실행: node generators/web/forecast/adjudicate.js
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { classifyOutcome } = require('./adjudicate/outcome');
const { fetchActual } = require('./adjudicate/fetch-actual');

function round2(v) { return Math.round(v * 100) / 100; }

// supabase 주입(테스트 가능). 도래·미판정 published 전망을 판정.
async function adjudicateDue(supabase, { asof = new Date() } = {}) {
  const today = asof.toISOString().slice(0, 10);
  const { data: rows, error } = await supabase
    .from('forecasts')
    .select('id,metric_ref,horizon_date,direction,range_low_pct,range_high_pct,metric_value_at_publish')
    .eq('status', 'published')
    .is('outcome', null)
    .lte('horizon_date', today);
  if (error) throw new Error(error.message);
  const res = { due: (rows || []).length, resolved: 0, pending: 0, errors: 0 };
  for (const f of rows || []) {
    const actual = await fetchActual(supabase, f.metric_ref, f.horizon_date);
    if (actual == null || f.metric_value_at_publish == null || f.metric_value_at_publish === 0) {
      res.pending++; // 실측 아직 없음 → 다음 회차 재시도
      continue;
    }
    const realizedPct = round2(((actual - f.metric_value_at_publish) / f.metric_value_at_publish) * 100);
    const outcome = classifyOutcome(f, realizedPct);
    if (!outcome) { res.pending++; continue; }
    const { error: uerr } = await supabase
      .from('forecasts')
      .update({ outcome, realized_pct: realizedPct, status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', f.id);
    if (uerr) { res.errors++; console.error(`❌ update [${f.metric_ref}]: ${uerr.message}`); }
    else { res.resolved++; console.log(`✅ ${f.metric_ref} ${f.direction} → ${outcome} (실측 ${realizedPct}%)${outcome !== 'hit' ? ' · 복기 작성 중' : ''}`); }
  }
  return res;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const res = await adjudicateDue(supabase);
  console.log(`📊 도래 ${res.due} · 판정 ${res.resolved} · 보류(실측대기) ${res.pending} · 오류 ${res.errors}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('adjudicate 실패:', e.message); process.exit(1); });
}

module.exports = { adjudicateDue };
```

- [ ] **Step 2: Failing test** (`adjudicate.test.js`) — fake supabase

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { adjudicateDue } = require('./adjudicate');

function fakeSupabase({ forecasts, indices }, captured) {
  function from(table) {
    let rows = table === 'forecasts' ? forecasts.slice() : (indices || []).slice();
    const api = {
      select() { return api; },
      eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
      is(col, val) { rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val)); return api; },
      lte(col, val) { rows = rows.filter((r) => String(r[col]) <= String(val)); return api; },
      order() { return api; },
      limit() { return Promise.resolve({ data: rows }); },
      then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
      update(patch) { return { eq(_c, id) { captured.push({ id, patch }); return Promise.resolve({ error: null }); } }; },
    };
    return api;
  }
  return { from };
}

test('adjudicateDue: resolves a due forecast as hit and writes outcome', async () => {
  const captured = [];
  const forecasts = [{
    id: 'f1', metric_ref: 'KCCI', horizon_date: '2026-07-03', status: 'published', outcome: null,
    direction: 'up', range_low_pct: 3, range_high_pct: 7, metric_value_at_publish: 1000,
  }];
  const indices = [{ index_code: 'KCCI', value: 1050, week_date: '2026-07-03' }]; // +5% → hit
  const res = await adjudicateDue(fakeSupabase({ forecasts, indices }, captured), { asof: new Date('2026-07-10T00:00:00Z') });
  assert.equal(res.resolved, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].patch.outcome, 'hit');
  assert.equal(captured[0].patch.realized_pct, 5);
  assert.equal(captured[0].patch.status, 'resolved');
  assert.equal('outcome_note' in captured[0].patch, false); // 복기는 에디터 몫
});

test('adjudicateDue: actual not yet available → pending, no write', async () => {
  const captured = [];
  const forecasts = [{
    id: 'f2', metric_ref: 'KCCI', horizon_date: '2026-07-03', status: 'published', outcome: null,
    direction: 'up', range_low_pct: 3, range_high_pct: 7, metric_value_at_publish: 1000,
  }];
  const indices = [{ index_code: 'KCCI', value: 1020, week_date: '2026-06-26' }]; // horizon 이전뿐
  const res = await adjudicateDue(fakeSupabase({ forecasts, indices }, captured), { asof: new Date('2026-07-10T00:00:00Z') });
  assert.equal(res.pending, 1);
  assert.equal(captured.length, 0);
});
```

- [ ] **Step 3: Run → pass.** (`node --test generators/web/forecast/`)

- [ ] **Step 4: Add npm script** in `package.json`:

```json
"adjudicate:forecasts": "node generators/web/forecast/adjudicate.js",
```

- [ ] **Step 5: Run full suite** — all green. Do NOT run `adjudicate.js` (writes DB).

- [ ] **Step 6: Commit** (`feat(forecast): auto-adjudication orchestration + npm script`).

---

## Self-Review notes

- **Decision ① (auto-confirm + editorial 복기):** `adjudicateDue` writes `outcome`/`realized_pct`/`status='resolved'`/`resolved_at` only — never `outcome_note`. The frontend shows "복기 작성 중" for `outcome in ('miss','partial') AND outcome_note IS NULL` (frontend change, logisight-core; noted, not in this plan).
- **Immutability trigger compatibility:** updates touch only `outcome`/`realized_pct`/`status`/`resolved_at` — all allowed post-publish by `forecasts_guard_published`. Scoring/prose fields untouched.
- **Hit-rate integrity:** Plan D resolves ALL due published rows (no filtering/exclusion); `pending` rows (no realized value yet) are retried next run, never dropped.
- **metric_value_at_publish** baseline comes from the forecast row (captured at draft/publish by Plan C). realized% = (actual − baseline)/baseline.
- **Testability:** `classifyOutcome`/`pickRealized`/`parseMetricRef` pure-tested; `adjudicateDue` tested with a fake supabase (no network/DB). `main()` + `fetchActual`'s live query are the only I/O.
- **Out of scope:** `invalidation_condition` is free-text → not auto-evaluated (editor handles); frontend "복기 작성 중" display + scoring-field display in `/admin/forecasts`; cadence-specific re-runs (a single daily run covers both tracks since it keys off `horizon_date <= today`).
