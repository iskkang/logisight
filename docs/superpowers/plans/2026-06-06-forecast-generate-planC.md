# Forecast Pipeline — Plan C: Generation (narrate + draft insert)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn each target's Plan B input + Plan A verdict into a reviewed-ready `forecasts` draft: the LLM writes ONLY the prose (statement + impact_note), a deterministic validator checks the prose against the computed verdict (Decision 1b), and rows are inserted as `status='draft'` for the editor publish-gate.

**Architecture:** `narrate.js` builds the prompt (pure), calls the LLM (raw fetch, injected as a function so it's testable with a fake), and validates the returned prose deterministically — regenerate once on mismatch, else leave prose empty for the editor. `generate.js` orchestrates assemble→score→narrate→upsert across all targets. The LLM writes prose only; all numbers/direction come from code. No new scoring logic.

**Tech Stack:** Node.js (CommonJS), `node:test`, Claude API via raw `fetch` (model `claude-opus-4-8`, adaptive thinking — matching the repo's existing `callClaude` pattern), `@supabase/supabase-js` (service role).

**Repo:** Pipeline `C:\Users\DELL\Documents\logisight`. Builds on Plan A (`score.js`) + Plan B (`assemble.js`, `targets.js`).

**Roadmap position:** A (scoring) ✅, B (inputs) ✅, **C (generation, this doc)**, D (auto-adjudication, next).

**Run-time note (NOT part of implementation):** Running `generate.js` spends Anthropic credits and writes draft rows; it also requires the `20260607000000_forecasts_scoring.sql` migration applied. The implementer must NOT run it. Unit tests use a fake `callLLM` and never touch the network or DB.

---

### Task 1: narrate (prompt + deterministic validation + retry)

**Files:**
- Create: `generators/web/forecast/narrate.js`
- Test: `generators/web/forecast/narrate.test.js`

- [ ] **Step 1: Failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNarratePrompt, validateProse, narrate } = require('./narrate');

const verdict = {
  direction: 'up', strength: '상승 가능성 높음', composite_score: 1.6,
  expected_range_pct: '+3~7', confidence: 'high',
  factor_scores: [{ factor: 'supply', score: 1 }], data_quality_flags: [],
};
const input = {
  metric_ref: 'KCCI', label: 'KCCI 종합', cadence: 'weekly', horizon_date: '2026-07-03',
  rate_series: { latest: 1200, mom_pct: 4.0 },
  supply: { blank_sailing: { ratio_pct: 12, direction: 'expanding' } },
  cost: { fuel_mom_pct: 9 }, demand: { export_momentum_yoy_pct: 6 },
};

test('buildNarratePrompt: system enforces constraints, user carries facts', () => {
  const { system, user } = buildNarratePrompt(input, verdict);
  assert.match(system, /확률|가능성/);
  assert.match(system, /때문에/); // 금지어로 명시
  assert.match(system, /현상.*원인.*배경.*전망/s);
  assert.match(user, /KCCI/);
  assert.match(user, /up|상승/);
  assert.match(user, /\+3~7/);
});

test('validateProse: good prose passes', () => {
  const r = validateProse({
    statement: '한국발 해상운임은 향후 2~4주 추가 상승 가능성이 높은 것으로 추정된다.',
    impact_note: 'FEU당 비용 상승 압력 → 7월 부킹 앞당겨 검토.',
    direction_echo: 'up',
  }, verdict);
  assert.equal(r.ok, true);
});
test('validateProse: direction mismatch fails', () => {
  const r = validateProse({ statement: '상승 가능성', impact_note: 'x', direction_echo: 'down' }, verdict);
  assert.equal(r.ok, false);
});
test('validateProse: causal-certainty phrase fails', () => {
  const r = validateProse({ statement: '결항 때문에 오른다', impact_note: 'x', direction_echo: 'up' }, verdict);
  assert.equal(r.ok, false);
});
test('validateProse: no hedge marker fails', () => {
  const r = validateProse({ statement: '운임이 오른다', impact_note: 'x', direction_echo: 'up' }, verdict);
  assert.equal(r.ok, false);
});
test('validateProse: empty statement fails', () => {
  const r = validateProse({ statement: '', impact_note: 'x', direction_echo: 'up' }, verdict);
  assert.equal(r.ok, false);
});

test('narrate: returns prose when LLM output validates', async () => {
  const fake = async () => JSON.stringify({
    statement: '상승 가능성이 높은 것으로 추정된다.', impact_note: 'FEU 비용 상승 → 부킹 검토.', direction_echo: 'up',
  });
  const r = await narrate(fake, input, verdict);
  assert.equal(r.needs_editor, false);
  assert.match(r.statement, /추정/);
});
test('narrate: regenerates once then falls back to editor on persistent mismatch', async () => {
  let calls = 0;
  const fake = async () => { calls++; return JSON.stringify({ statement: '내린다', impact_note: 'x', direction_echo: 'down' }); };
  const r = await narrate(fake, input, verdict);
  assert.equal(calls, 2); // 최초 + 재시도 1회
  assert.equal(r.needs_editor, true);
  assert.equal(r.statement, null);
});
test('narrate: unparseable LLM output → editor fallback', async () => {
  const fake = async () => 'not json at all';
  const r = await narrate(fake, input, verdict);
  assert.equal(r.needs_editor, true);
});
```

- [ ] **Step 2: Run → fail** (`node --test generators/web/forecast/narrate.test.js`).

- [ ] **Step 3: Implement**

```js
'use strict';
// 전망 산문 생성 — LLM은 statement/impact_note만 작성. 방향·수치는 코드(verdict)에서 온다.
// 검증(Decision 1b): LLM이 echo한 방향이 verdict와 일치 + 금지어 없음 + 확률 표현 존재. 1회 재생성 후 실패 시 산문 없는 draft.

const FORBIDDEN = ['때문에', '확실', '반드시', '틀림없', '분명히'];
const HEDGES = ['가능성', '추정', '정합', '전망', '예상', '우세', '보인다', '보임'];

function buildNarratePrompt(input, verdict) {
  const system = [
    '당신은 한국 화주·포워더를 위한 물류 인텔리전스 애널리스트다. 아래 계산된 판정과 근거 수치만 사용해 산문을 쓴다.',
    '규칙(엄수):',
    '- statement는 "현상 → 원인 → 배경 → 전망" 흐름의 자연스러운 산문(라벨/소제목 금지).',
    '- 방향·범위·수치를 새로 만들지 마라. 주어진 판정(direction/expected_range_pct)과 근거 수치만 사용.',
    '- 단정·인과 단정 금지("때문에"·"확실"·"반드시" 등 불가). 확률·추정 표현 강제("가능성"·"추정"·"정합").',
    '- 선행/후행 판정 금지.',
    '- impact_note는 독자 단위 3단 변환 필수: 지수 변화 → FEU/kg당 비용·리드타임 영향(구간) → 권장 행동 1개.',
    '- 출력은 JSON 하나: {"statement":"...","impact_note":"...","direction_echo":"up|flat|down"}. direction_echo는 주어진 판정 방향을 그대로 반향.',
  ].join('\n');

  const facts = {
    지표: input.metric_ref, 라벨: input.label, 케이던스: input.cadence, horizon: input.horizon_date,
    판정: { 방향: verdict.direction, 강도: verdict.strength, 예상범위: verdict.expected_range_pct, 신뢰도: verdict.confidence },
    근거: {
      최신값: input.rate_series && input.rate_series.latest,
      변화율: input.rate_series && input.rate_series.mom_pct,
      결항: input.supply && input.supply.blank_sailing,
      유가MoM: input.cost && input.cost.fuel_mom_pct,
      수출모멘텀: input.demand && input.demand.export_momentum_yoy_pct,
    },
  };
  const user = `다음 판정과 근거로 전망 산문을 작성하라(JSON만 출력).\n${JSON.stringify(facts, null, 2)}`;
  return { system, user };
}

function safeParse(raw) {
  try {
    let t = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const s = t.indexOf('{'); const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    return JSON.parse(t);
  } catch (_) { return null; }
}

function validateProse(parsed, verdict) {
  const issues = [];
  if (!parsed) return { ok: false, issues: ['파싱 실패'] };
  const s = typeof parsed.statement === 'string' ? parsed.statement.trim() : '';
  const note = typeof parsed.impact_note === 'string' ? parsed.impact_note.trim() : '';
  if (!s) issues.push('statement 비어있음');
  if (!note) issues.push('impact_note 비어있음');
  if (parsed.direction_echo !== verdict.direction) issues.push(`방향 불일치(${parsed.direction_echo} ≠ ${verdict.direction})`);
  if (s && FORBIDDEN.some((w) => s.includes(w))) issues.push('인과/단정 표현 포함');
  if (s && !HEDGES.some((w) => s.includes(w))) issues.push('확률/추정 표현 없음');
  return { ok: issues.length === 0, issues };
}

// callLLM: async ({system,user}) => string. 검증 통과까지 1회 재생성, 실패 시 산문 없는 draft.
async function narrate(callLLM, input, verdict, { maxRetries = 1 } = {}) {
  const prompt = buildNarratePrompt(input, verdict);
  let last = { issues: ['미실행'] };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await callLLM(prompt);
    const parsed = safeParse(raw);
    const v = validateProse(parsed, verdict);
    last = v;
    if (v.ok) return { statement: parsed.statement.trim(), impact_note: parsed.impact_note.trim(), needs_editor: false };
  }
  return { statement: null, impact_note: null, needs_editor: true, validation_issues: last.issues };
}

module.exports = { buildNarratePrompt, validateProse, narrate, safeParse, FORBIDDEN, HEDGES };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): narrate (LLM prose-only + deterministic validation + retry)`).

---

### Task 2: verdict→row mapping (pure)

**Files:**
- Create: `generators/web/forecast/row.js`
- Test: `generators/web/forecast/row.test.js`

- [ ] **Step 1: Failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapVerdictToRow, buildBasis } = require('./row');

const input = {
  metric_ref: 'KCCI', cadence: 'weekly', horizon_date: '2026-07-03',
  rate_series: { latest: 1200, mom_pct: 4.0 },
  supply: { blank_sailing: { ratio_pct: 12, direction: 'expanding' } },
  cost: { fuel_mom_pct: 9 }, demand: { export_momentum_yoy_pct: 6 },
};
const verdict = {
  direction: 'up', strength: '상승 가능성 높음', composite_score: 1.6,
  range_low_pct: 3, range_high_pct: 7, expected_range_pct: '+3~7', confidence: 'high',
  factor_scores: [{ factor: 'supply', score: 1, weight: 0.3, missing: false }],
  data_quality_flags: [], model_version: 'v1.1',
};
const prose = { statement: '상승 가능성', impact_note: 'FEU 비용 상승', needs_editor: false };

test('buildBasis: includes key numbers as strings', () => {
  const b = buildBasis(input);
  assert.ok(Array.isArray(b));
  assert.ok(b.some((s) => s.includes('1200')));
  assert.ok(b.some((s) => s.includes('12')));
});

test('mapVerdictToRow: maps verdict+prose+input → forecasts row', () => {
  const row = mapVerdictToRow(input, verdict, prose);
  assert.equal(row.module, 'rates');
  assert.equal(row.metric_ref, 'KCCI');
  assert.equal(row.cadence, 'weekly');
  assert.equal(row.horizon_date, '2026-07-03');
  assert.equal(row.direction, 'up');
  assert.equal(row.composite_score, 1.6);
  assert.equal(row.range_low_pct, 3);
  assert.equal(row.model_version, 'v1.1');
  assert.equal(row.metric_value_at_publish, 1200);
  assert.equal(row.status, 'draft');
  assert.equal(row.statement, '상승 가능성');
  assert.equal(Array.isArray(row.basis), true);
});
test('mapVerdictToRow: needs_editor prose → placeholder statement, draft', () => {
  const row = mapVerdictToRow(input, verdict, { statement: null, impact_note: null, needs_editor: true });
  assert.equal(row.status, 'draft');
  assert.match(row.statement, /검수/); // 에디터 작성 안내 placeholder
  assert.equal(row.impact_note, null);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

```js
'use strict';
// verdict + prose + input → forecasts 행(status='draft'). 순수 함수.
const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';

function buildBasis(input) {
  const b = [];
  const rs = input.rate_series;
  if (rs) b.push(`${input.metric_ref} 최신 ${rs.latest} (변화율 ${rs.mom_pct ?? 'n/a'}%)`);
  const bsig = input.supply && input.supply.blank_sailing;
  if (bsig && bsig.ratio_pct != null) b.push(`결항률 ${bsig.ratio_pct}% (${bsig.direction})`);
  if (input.cost && input.cost.fuel_mom_pct != null) b.push(`VLSFO MoM ${input.cost.fuel_mom_pct}%`);
  if (input.demand && input.demand.export_momentum_yoy_pct != null) b.push(`수출 YoY ${input.demand.export_momentum_yoy_pct}%`);
  return b;
}

function mapVerdictToRow(input, verdict, prose) {
  return {
    module: 'rates',
    metric_ref: input.metric_ref,
    cadence: input.cadence,
    horizon_date: input.horizon_date,
    direction: verdict.direction,
    strength: verdict.strength,
    composite_score: verdict.composite_score,
    range_low_pct: verdict.range_low_pct,
    range_high_pct: verdict.range_high_pct,
    expected_range_pct: verdict.expected_range_pct,
    confidence: verdict.confidence,
    factor_scores: verdict.factor_scores,
    data_quality_flags: verdict.data_quality_flags,
    model_version: verdict.model_version,
    metric_value_at_publish: input.rate_series ? input.rate_series.latest : null,
    basis: buildBasis(input),
    statement: prose.needs_editor ? EDITOR_PLACEHOLDER : prose.statement,
    impact_note: prose.needs_editor ? null : prose.impact_note,
    status: 'draft',
  };
}

module.exports = { mapVerdictToRow, buildBasis, EDITOR_PLACEHOLDER };
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`feat(forecast): verdict→draft row mapping`).

---

### Task 3: LLM client + generate orchestration

**Files:**
- Create: `generators/web/forecast/llm.js` (raw-fetch Claude client; no unit test — I/O)
- Create: `generators/web/forecast/generate.js` (orchestration + CLI)
- Test: `generators/web/forecast/generate.test.js` (orchestration with fakes)
- Modify: `package.json` (repoint `generate:forecasts` to the new pipeline)

- [ ] **Step 1: Implement llm.js** (reuses the repo's existing `callClaude` shape)

```js
'use strict';
// Claude Messages API (raw fetch) — 저장소 LLM 클라이언트 패턴과 동일. 산문 1건 생성용.
async function callClaude({ system, user }, { maxTokens = 1500 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-8', max_tokens: maxTokens,
      thinking: { type: 'adaptive' }, system, messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('Anthropic HTTP ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
module.exports = { callClaude };
```

- [ ] **Step 2: Implement generate.js**

```js
'use strict';
// 주간 전망 생성: 타깃 조립 → 채점 → (비-abstain) 산문 → forecasts upsert(draft).
// 실행: node generators/web/forecast/generate.js  (또는 npm run generate:forecasts)
// 발행은 프론트 /admin/forecasts 검수 큐에서만.
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { WEEKLY_TARGETS, fetchMonthlyTargets } = require('./targets');
const { assembleInput, buildShared } = require('./assemble');
const { scoreForecast } = require('./score');
const { narrate } = require('./narrate');
const { mapVerdictToRow } = require('./row');
const { callClaude } = require('./llm');

// 핵심 루프 — supabase/callLLM 주입(테스트 가능).
async function generateDrafts(supabase, callLLM, { asof = new Date() } = {}) {
  const shared = await buildShared(supabase, asof);
  const monthly = await fetchMonthlyTargets(supabase);
  const targets = [...WEEKLY_TARGETS, ...monthly];
  const res = { total: targets.length, inserted: 0, abstained: 0, needsEditor: 0, errors: 0 };
  for (const t of targets) {
    const input = await assembleInput(supabase, t, { asof, shared });
    const verdict = scoreForecast(input);
    if (verdict.abstain) { res.abstained++; continue; }
    const prose = await narrate(callLLM, input, verdict);
    if (prose.needs_editor) res.needsEditor++;
    const row = mapVerdictToRow(input, verdict, prose);
    const { error } = await supabase.from('forecasts').upsert(row, { onConflict: 'metric_ref,horizon_date,model_version' });
    if (error) { res.errors++; console.error(`❌ upsert [${t.metric_ref}]: ${error.message}`); }
    else { res.inserted++; console.log(`✅ draft [${t.metric_ref}] ${verdict.direction} ${verdict.expected_range_pct ?? ''}${prose.needs_editor ? ' (에디터 작성 필요)' : ''}`); }
  }
  return res;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const res = await generateDrafts(supabase, callClaude);
  console.log(`📊 ${res.inserted}/${res.total} draft 적재 · abstain ${res.abstained} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('generate 실패:', e.message); process.exit(1); });
}

module.exports = { generateDrafts };
```

- [ ] **Step 3: Failing test** (`generate.test.js`) — orchestration with a fake supabase + fake LLM (no network/DB)

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateDrafts } = require('./generate');

// 최소 가짜 supabase: blank_sailings/bunker_prices/trade_statistics/policies/kita_sea_rates/freight_indices/forecasts
function fakeSupabase(captured) {
  const data = {
    freight_indices: [
      { index_code: 'KCCI', value: 1200, change_pct: 4, week_date: todayMinus(2) },
      { index_code: 'KCCI', value: 1150, change_pct: 3, week_date: todayMinus(9) },
      { index_code: 'KCCI', value: 1110, change_pct: 2, week_date: todayMinus(16) },
      { index_code: 'SCFI', value: 1000, change_pct: 1, week_date: todayMinus(2) },
    ],
    blank_sailings: [
      { region: 'East Asia', blank_pct: 12, week_start: todayMinus(3) },
      { region: 'East Asia', blank_pct: 8, week_start: todayMinus(10) },
    ],
    bunker_prices: [
      { grade: 'VLSFO', port: 'Singapore', price_usd: 600, obs_date: todayMinus(1) },
      { grade: 'VLSFO', port: 'Singapore', price_usd: 550, obs_date: todayMinus(30) },
    ],
    trade_statistics: [], policies: [], kita_sea_rates: [],
  };
  function from(table) {
    let rows = (data[table] || []).slice();
    const api = {
      select() { return api; },
      eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
      gte(col, val) { rows = rows.filter((r) => String(r[col]) >= String(val)); return api; },
      order() { return api; },
      limit() { return Promise.resolve({ data: rows }); },
      then(res) { return Promise.resolve({ data: rows }).then(res); }, // await 지원
      async upsert(row) { captured.push(row); return { error: null }; },
    };
    return api;
  }
  return { from };
}
function todayMinus(d) { return new Date(Date.now() - d * 86400000).toISOString().slice(0, 10); }

test('generateDrafts: scores targets and upserts drafts (fake LLM/DB)', async () => {
  const captured = [];
  const fakeLLM = async () => JSON.stringify({ statement: '상승 가능성이 높은 것으로 추정된다.', impact_note: 'FEU 비용 상승 → 부킹 검토.', direction_echo: 'up' });
  const res = await generateDrafts(fakeSupabase(captured), fakeLLM, { asof: new Date() });
  assert.equal(res.total >= 2, true);
  assert.equal(captured.every((r) => r.status === 'draft'), true);
  assert.equal(captured.length, res.inserted);
});
```

> Note: the fake supabase query builder must support both `await builder.limit(...)` and `await builder` (the input fetchers vary). The `then`/`limit` shims above cover both. If a fetcher uses a method not shimmed, add it minimally — do not change `assemble.js`.

- [ ] **Step 4: Run → pass.** (`node --test generators/web/forecast/generate.test.js`)

- [ ] **Step 5: Repoint npm script** in `package.json`:

```json
"generate:forecasts": "node generators/web/forecast/generate.js",
```

(The old `generators/web/generate-forecasts.js` is superseded by the scored two-track pipeline. Leave the file in place but no longer referenced; deletion is a separate cleanup decision.)

- [ ] **Step 6: Run the full suite** (`node --test generators/web/forecast/`) — all green. Do NOT run `generate.js` / `npm run generate:forecasts` (spends credits + writes DB).

- [ ] **Step 7: Commit** (`feat(forecast): generate orchestration (assemble→score→narrate→draft) + LLM client`).

---

## Self-Review notes

- **Decision 1b (validation loop):** `validateProse` checks direction echo + forbidden causal-certainty phrases + required hedge marker; `narrate` regenerates once, then emits a `needs_editor` draft with a placeholder statement so the editor writes it. Prose is never published automatically (draft only).
- **LLM writes prose only.** All direction/range/composite/factor numbers come from the verdict (`mapVerdictToRow`), never the LLM.
- **Draft-only + publish gate intact:** every row is `status='draft'`; publishing stays in the frontend `/admin/forecasts` editor queue. Dedup via `upsert onConflict 'metric_ref,horizon_date,model_version'` (matches the Plan A unique index).
- **metric_value_at_publish** is captured at draft time (`rate_series.latest`) as the % baseline; if the publish-time value should be used instead, the frontend publish action can overwrite it during the draft→published transition (allowed by the immutability trigger). Noted for Plan D.
- **Testability:** `narrate`/`generateDrafts` take `callLLM`/`supabase` as injected params → unit-tested with fakes, zero network/DB. `llm.js` (real Claude client) and `main()` are the only I/O, not unit-tested.
- **Out of scope (Plan D / backlog):** auto-adjudication, frontend publish-time `metric_value_at_publish` capture, E-factor (GRI/PSS) and news_derived supply.
