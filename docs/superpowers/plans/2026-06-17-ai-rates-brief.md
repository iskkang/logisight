# AI Rates Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the templated home "운임 인텔리전스 브리프" with a weekly AI-written analysis: a backend pipeline computes the signal numbers and a DeepSeek pass writes the prose into a `rates_brief` table; the home reads it and falls back to the existing template when absent/stale.

**Architecture:** Two repos. **logisight** (backend, CommonJS, `node --test`): pure `signals.js` (ported from the frontend `server/signals.ts`) + `prompt.js`, an orchestrator `generate-rates-brief.js`, a `rates_brief` migration, and a `rates-brief.yml` cron. **logisight-core** (frontend, TanStack Start, `vitest`): a server fn to read the latest brief and a `RatesBrief` that renders AI prose or falls back to `narrate()`.

**Tech Stack:** Node.js (CommonJS) + `node --test`, `@supabase/supabase-js`, DeepSeek (`generators/lib/deepseek` → `callDeepSeekJson`), GitHub Actions; React + vitest (frontend).

**Reference spec:** `docs/superpowers/specs/2026-06-17-ai-rates-brief-design.md`.

---

## File Structure

```
logisight/
  generators/web/rates-brief/
    lib/signals.js          # ported pure signal computations
    lib/signals.test.js
    lib/prompt.js           # DeepSeek message builder (pure)
    lib/prompt.test.js
    generate-rates-brief.js # orchestrator [I/O]
  supabase/migrations/<ts>_rates_brief.sql
  .github/workflows/rates-brief.yml
logisight-core/
  src/lib/api/rates-brief.ts
  src/lib/api/rates-brief.functions.ts
  src/components/dashboard/RatesBrief.tsx   # add `prose` prop
  src/routes/index.tsx                      # HomeRatesBrief: read brief + fallback
```

---

## Task 1: Ported signal computations (`lib/signals.js`)

**Files:**
- Create: `generators/web/rates-brief/lib/signals.js`
- Test: `generators/web/rates-brief/lib/signals.test.js`

- [ ] **Step 1: Write the failing test**

```js
// generators/web/rates-brief/lib/signals.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOceanPressure, computeGlobalMomentum, computeAir, computeBunker } = require('./signals');

test('ocean pressure: caution at 75th pct with rising 3w avg', () => {
  const dates = ['2026-04-27', '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01', '2026-06-08', '2026-06-15'];
  const kcci = [2000, 2100, 2200, 2300, 2478, 2675, 3042, 3349].map((v, i) => ({ week_date: dates[i], value: v }));
  const s = computeOceanPressure(kcci);
  assert.equal(s.state, 'caution');
  assert.equal(s.pct, 75);
  assert.equal(s.avgLast, 3022);
  assert.equal(Math.round(s.wow * 10) / 10, 29.9);
  assert.match(s.basis, /백분위 75%/);
});

test('global momentum: SCFI +9.5% / WCI +3.4% aligned -> caution', () => {
  // computeGlobalMomentum 는 각 시계열 5점 이상 필요. 마지막 두 점이 MoM을 결정.
  const dates = ['2026-05-04', '2026-05-11', '2026-05-18', '2026-06-01', '2026-06-08'];
  const scfi = [2400, 2500, 2571, 2726, 2985.22].map((v, i) => ({ week_date: dates[i], value: v }));
  const wci = [3200, 3300, 3400, 3433, 3549].map((v, i) => ({ week_date: dates[i], value: v }));
  const s = computeGlobalMomentum(scfi, wci);
  assert.equal(Math.round(s.scfiMoM * 10) / 10, 9.5);
  assert.equal(Math.round(s.wciMoM * 10) / 10, 3.4);
  assert.equal(s.aligned, true);
  assert.equal(s.state, 'caution');
});

test('air: drops |MoM|>200 and reports the largest real move', () => {
  const s = computeAir(127.0, '인천→첸나이', 75);
  assert.equal(s.state, 'caution'); // |MoM|>=10 && oceanPct>=70
  assert.match(s.basis, /\+127\.0%/);
  assert.equal(computeAir(3718, '인천→x', 75), null); // 비현실 → null
});

test('bunker: VLSFO MoM', () => {
  assert.equal(computeBunker(-5.0).state, 'observe');
  assert.equal(computeBunker(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/web/rates-brief/lib/signals.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```js
// generators/web/rates-brief/lib/signals.js
'use strict';
// logisight-core/src/server/signals.ts 의 compute* 로직 포팅(CommonJS, 순수).
// 입력 시계열: [{week_date|period, value}], 정렬은 내부에서 수행.

function pctile(values, current) {
  if (!values.length) return 0;
  const below = values.filter((v) => v <= current).length;
  return Math.round((below / values.length) * 100);
}
function momChange(series) {
  if (series.length < 2) return null;
  const s = [...series].sort((a, b) => String(a.k).localeCompare(String(b.k)));
  const l = s[s.length - 1], p = s[s.length - 2];
  if (l.value == null || p.value == null || p.value === 0) return null;
  return ((l.value - p.value) / p.value) * 100;
}

// 해상: KCCI 최근 3주 평균의 52주 백분위 + 직전 3주 평균比 WoW
function computeOceanPressure(kcciSeries, asOf) {
  const valid = kcciSeries.filter((p) => p.value != null).sort((a, b) => a.week_date.localeCompare(b.week_date));
  if (valid.length < 6) return null;
  const last3 = valid.slice(-3).map((p) => p.value);
  const prev3 = valid.slice(-6, -3).map((p) => p.value);
  const avgLast = last3.reduce((s, v) => s + v, 0) / 3;
  const avgPrev = prev3.reduce((s, v) => s + v, 0) / 3;
  const wow = avgPrev === 0 ? 0 : ((avgLast - avgPrev) / avgPrev) * 100;
  const pct = pctile(valid.map((p) => p.value), avgLast);
  let state = 'normal';
  if (pct >= 80 && wow > 0) state = 'alert';
  else if (pct >= 70 && wow > 0) state = 'caution';
  else if (pct >= 60) state = 'observe';
  return {
    label: '해상 운임 압력', state, pct, wow, avgLast,
    basis: `KCCI 3주 평균 ${Math.round(avgLast).toLocaleString()} — 52주 백분위 ${pct}%, 직전 3주 평균比 ${wow >= 0 ? '+' : ''}${wow.toFixed(1)}%`,
    sources: ['KCCI'], asOf: asOf ?? valid.at(-1).week_date, confidence: valid.length >= 12 ? 'high' : 'medium',
  };
}

// 글로벌: SCFI·WCI 각 시계열 마지막 두 점 MoM, 부호 정합
function computeGlobalMomentum(scfiSeries, wciSeries, asOf) {
  const scfi = scfiSeries.filter((p) => p.value != null).sort((a, b) => a.week_date.localeCompare(b.week_date));
  const wci = wciSeries.filter((p) => p.value != null).sort((a, b) => a.week_date.localeCompare(b.week_date));
  if (scfi.length < 5) return null;
  const scfiMoM = momChange(scfi.map((p) => ({ k: p.week_date, value: p.value })));
  if (scfiMoM == null) return null;
  const wciMoM = wci.length >= 5 ? momChange(wci.map((p) => ({ k: p.week_date, value: p.value }))) : null;
  const aligned = wciMoM != null && Math.sign(scfiMoM) === Math.sign(wciMoM);
  const mag = Math.abs(scfiMoM);
  let state = 'normal';
  if (mag >= 10) state = aligned ? 'alert' : 'caution';
  else if (mag >= 5) state = aligned ? 'caution' : 'observe';
  const alignText = wciMoM != null ? `WCI MoM ${wciMoM >= 0 ? '+' : ''}${wciMoM.toFixed(1)}%와 방향 ${aligned ? '정합' : '비정합'}` : 'WCI 데이터 없음';
  return {
    label: '글로벌 운임 모멘텀', state, scfiMoM, wciMoM, aligned,
    basis: `SCFI MoM ${scfiMoM >= 0 ? '+' : ''}${scfiMoM.toFixed(1)}% — ${alignText}`,
    sources: ['SCFI', ...(wciMoM != null ? ['WCI'] : [])], asOf: asOf ?? scfi.at(-1).week_date, confidence: aligned ? 'high' : 'medium',
  };
}

// 항공: MoM(이미 계산된 값) + 해상 압력 연계. |MoM|>200은 데이터 오류로 제외(null).
function computeAir(airMoM, routeLabel, oceanPct, asOf) {
  if (airMoM == null || Math.abs(airMoM) > 200) return null;
  const highOcean = oceanPct != null && oceanPct >= 70;
  let state = 'normal';
  if (Math.abs(airMoM) >= 10 && highOcean) state = 'caution';
  else if (Math.abs(airMoM) >= 10) state = 'observe';
  return {
    label: `항공 운임 변동 (${routeLabel})`, state, airMoM,
    basis: `MoM ${airMoM >= 0 ? '+' : ''}${airMoM.toFixed(1)}%${highOcean ? ' — 해상 압력 높음, 모달 전환 가능성 추정' : ''}`,
    sources: ['KITA 항공'], asOf: asOf ?? null, confidence: highOcean ? 'medium' : 'low',
  };
}

// 벙커: VLSFO MoM
function computeBunker(vlsfoMoM, asOf) {
  if (vlsfoMoM == null) return null;
  let state = 'normal';
  if (Math.abs(vlsfoMoM) >= 10) state = 'caution';
  else if (Math.abs(vlsfoMoM) >= 5) state = 'observe';
  return {
    label: '벙커 비용', state, vlsfoMoM,
    basis: `VLSFO MoM ${vlsfoMoM >= 0 ? '+' : ''}${vlsfoMoM.toFixed(1)}% — 부대비용 영향 추정`,
    sources: ['VLSFO'], asOf: asOf ?? null, confidence: 'medium',
  };
}

module.exports = { pctile, momChange, computeOceanPressure, computeGlobalMomentum, computeAir, computeBunker };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/web/rates-brief/lib/signals.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add generators/web/rates-brief/lib/signals.js generators/web/rates-brief/lib/signals.test.js
git commit -m "feat(rates-brief): port signal computations (pure)"
```

---

## Task 2: Prompt builder (`lib/prompt.js`)

**Files:**
- Create: `generators/web/rates-brief/lib/prompt.js`
- Test: `generators/web/rates-brief/lib/prompt.test.js`

`buildMessages(signals, meta)` → `{ system, messages }` for `callDeepSeekJson`. `signals` = array of signal objects (nulls filtered by caller). `meta = { asOf }`.

- [ ] **Step 1: Write the failing test**

```js
// generators/web/rates-brief/lib/prompt.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessages } = require('./prompt');

test('system carries style rules; user injects signal facts + demands JSON', () => {
  const signals = [
    { label: '해상 운임 압력', state: 'caution', basis: 'KCCI 3주 평균 3,022 — 52주 백분위 75%, 직전 3주 평균比 +29.9%' },
    { label: '글로벌 운임 모멘텀', state: 'caution', basis: 'SCFI MoM +9.5% — WCI MoM +3.4%와 방향 정합' },
  ];
  const { system, messages } = buildMessages(signals, { asOf: '2026-06-15' });
  assert.match(system, /명사형 종결/);
  assert.match(system, /한자/);
  const u = messages[0].content;
  assert.match(u, /백분위 75%/);
  assert.match(u, /2026-06-15/);
  assert.match(u, /JSON/);
  assert.match(u, /"headline"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/web/rates-brief/lib/prompt.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```js
// generators/web/rates-brief/lib/prompt.js
'use strict';
// 신호 사실을 주입해 DeepSeek가 섹션별 분석 문장을 쓰게 한다. 수치 창작 금지.

const SYSTEM = `당신은 한국 화주·포워더를 위한 운임 애널리스트다.
주어진 운임 신호(수치는 이미 계산됨)를 근거로 "운임 인텔리전스 브리프"의 분석 문장을 쓴다.

문체 규칙:
- 명사형 종결 필수(예: "상승 압력 지속 예상"). ~된다/~한다/~이다 어미 금지.
- 어려운 한자 약물(弗·億·比·美·亞·北·前倒·脫出) 금지, 한글(달러·대비·미국·아시아).
- 화주 관점에서 실무 시사점 포함.
- 주어진 수치만 인용한다. 수치를 새로 만들지 않는다.
각 섹션 2~3문장. 상관·추정 표현만 쓰고 인과 단정 금지.`;

function buildMessages(signals, meta) {
  const facts = signals.map((s) => `- [${s.label}] 상태=${s.state} · ${s.basis}`).join('\n');
  const user = `기준일: ${meta.asOf}

아래 신호를 근거로 브리프를 작성하라.
${facts}

반드시 아래 JSON만 출력하라(수치는 위 신호의 것만 인용):
{
  "headline": "이번 주 핵심을 한 문장(명사형)으로",
  "ocean":  "해상 운임 압력 분석 (백분위·증감 인용)",
  "global": "글로벌 SCFI·WCI 모멘텀 분석",
  "air":    "항공 운임 변동·모달 시사점 (신호 없으면 빈 문자열)",
  "outlook":"단기 전망·부킹/계약 시사점"
}`;
  return { system: SYSTEM, messages: [{ role: 'user', content: user }] };
}

module.exports = { buildMessages };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/web/rates-brief/lib/prompt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add generators/web/rates-brief/lib/prompt.js generators/web/rates-brief/lib/prompt.test.js
git commit -m "feat(rates-brief): DeepSeek prompt builder"
```

---

## Task 3: `rates_brief` migration

**Files:**
- Create: `supabase/migrations/20260617000031_rates_brief.sql`

- [ ] **Step 1: Write migration**

```sql
-- 031: AI 운임 인텔리전스 브리프 저장 (홈 화면 소스)
CREATE TABLE IF NOT EXISTS rates_brief (
  week_id      TEXT PRIMARY KEY,        -- 'YYYY-Www' (as_of 기준)
  as_of        DATE NOT NULL,           -- 최신 지수 날짜(KCCI latest)
  signals_json JSONB NOT NULL,          -- [{label,state,basis,...}]
  prose_json   JSONB NOT NULL,          -- {headline,ocean,global,air,outlook}
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rates_brief ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"     ON rates_brief FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON rates_brief FOR ALL   TO service_role USING (true);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260617000031_rates_brief.sql
git commit -m "feat(db): rates_brief table"
```

> Apply to the remote DB after merge via the Supabase Management API (project ref from SUPABASE_URL) or the dashboard SQL editor — the table must exist before the first generator run.

---

## Task 4: Generator orchestrator (`generate-rates-brief.js`)

**Files:**
- Create: `generators/web/rates-brief/generate-rates-brief.js`
- Modify: `package.json` (add script)

Reads freight_indices (KCCI/SCFI/WCI/VLSFO series) + kita_air_rates, computes signals, gets DeepSeek prose, upserts `rates_brief`. Air MoM uses the kg300 series (not the broken `chg300`), filtering |MoM|>200.

- [ ] **Step 1: Implement**

```js
// generators/web/rates-brief/generate-rates-brief.js
'use strict';
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../../lib/deepseek');
const S = require('./lib/signals');
const { buildMessages } = require('./lib/prompt');

function isoWeekId(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstTh = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstTh.setUTCDate(firstTh.getUTCDate() - ((firstTh.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d - firstTh) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function indexSeries(sb, code) {
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const { data } = await sb.from('freight_indices')
    .select('week_date,value').eq('index_code', code).gte('week_date', since)
    .order('week_date', { ascending: true });
  return (data || []).filter((r) => r.value != null);
}

async function airTopMoM(sb) {
  const { data } = await sb.from('kita_air_rates')
    .select('origin,dest,year_mon,kg300').order('year_mon', { ascending: false }).limit(400);
  if (!data || !data.length) return null;
  const latest = data[0].year_mon;
  const routes = [...new Set(data.filter((r) => r.year_mon === latest).map((r) => `${r.origin}→${r.dest}`))];
  const cands = [];
  for (const key of routes) {
    const [o, d] = key.split('→');
    const series = data.filter((r) => r.origin === o && r.dest === d).map((r) => ({ k: r.year_mon, value: r.kg300 }));
    const mom = S.momChange(series);
    if (mom != null && Math.abs(mom) <= 200) cands.push({ route: key, mom });
  }
  cands.sort((a, b) => Math.abs(b.mom) - Math.abs(a.mom));
  return cands[0] ?? null;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const [kcci, scfi, wci, vlsfo] = await Promise.all(
    ['KCCI', 'SCFI', 'WCI', 'VLSFO'].map((c) => indexSeries(sb, c)),
  );
  const asOf = kcci.at(-1)?.week_date ?? scfi.at(-1)?.week_date;
  if (!asOf) throw new Error('지수 데이터 없음');

  const ocean = S.computeOceanPressure(kcci, asOf);
  const global = S.computeGlobalMomentum(scfi, wci, asOf);
  const air0 = await airTopMoM(sb);
  const air = air0 ? S.computeAir(air0.mom, air0.route, ocean?.pct ?? null, asOf) : null;
  const vlsfoMoM = S.momChange(vlsfo.map((p) => ({ k: p.week_date, value: p.value })));
  const bunker = S.computeBunker(vlsfoMoM, asOf);

  const signals = [ocean, global, air, bunker].filter(Boolean);
  if (!signals.length) throw new Error('신호 없음');

  const { system, messages } = buildMessages(signals, { asOf });
  const prose = await callDeepSeekJson({ system, messages, max_tokens: 1500 });

  const row = {
    week_id: isoWeekId(asOf),
    as_of: asOf,
    signals_json: signals,
    prose_json: prose,
    generated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('rates_brief').upsert(row, { onConflict: 'week_id' });
  if (error) throw new Error(error.message);
  console.log(`✅ rates_brief: ${row.week_id} (as_of ${asOf}) — ${signals.length}개 신호`);
}

main().catch((e) => { console.error('rates-brief 생성 실패:', e.message); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

In `package.json` `scripts`, add:
```json
"rates-brief:generate": "node generators/web/rates-brief/generate-rates-brief.js",
```

- [ ] **Step 3: Smoke-run** (requires the migration applied)

Run: `npm run rates-brief:generate`
Expected: `✅ rates_brief: 2026-Wxx (as_of 2026-06-15) — N개 신호`. Then query `rates_brief` and confirm `prose_json` has headline/ocean/global/outlook in noun-ending Korean citing the injected numbers.

- [ ] **Step 4: Commit**

```bash
git add generators/web/rates-brief/generate-rates-brief.js package.json
git commit -m "feat(rates-brief): generator orchestrator + npm script"
```

---

## Task 5: Workflow (`rates-brief.yml`)

**Files:**
- Create: `.github/workflows/rates-brief.yml`

- [ ] **Step 1: Write workflow** (read `.github/workflows/forecast-generate.yml` first to match the secrets/node setup)

```yaml
name: Rates Intelligence Brief

on:
  schedule:
    - cron: '0 3 * * 2'   # 화 03:00 UTC — market-collectors(화 02:00) 직후
    - cron: '0 7 * * 5'   # 금 07:00 UTC — market-collectors(금 06:00) 직후
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run rates-brief:generate
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/rates-brief.yml
git commit -m "ci(rates-brief): Tue/Fri generation after collection"
```

---

## Task 6: Frontend read API (logisight-core)

**Files:**
- Create: `logisight-core/src/lib/api/rates-brief.ts`
- Create: `logisight-core/src/lib/api/rates-brief.functions.ts`

- [ ] **Step 1: Implement the server fn** (mirror `src/lib/api/briefing.functions.ts`)

```ts
// logisight-core/src/lib/api/rates-brief.functions.ts
import { createServerFn } from "@tanstack/react-start";
import { supabasePublicServer } from "@/integrations/supabase/public.server";
import type { RatesBriefRow } from "./rates-brief";

export const getLatestRatesBrief = createServerFn({ method: "GET" }).handler(
  async (): Promise<RatesBriefRow | null> => {
    const { data, error } = await supabasePublicServer
      .from("rates_brief")
      .select("week_id, as_of, signals_json, prose_json, generated_at")
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  },
);
```

- [ ] **Step 2: Implement the query options + types**

```ts
// logisight-core/src/lib/api/rates-brief.ts
import { queryOptions } from "@tanstack/react-query";
import { getLatestRatesBrief } from "./rates-brief.functions";

export type RatesBriefProse = {
  headline: string; ocean: string; global: string; air: string; outlook: string;
};
export type RatesBriefRow = {
  week_id: string;
  as_of: string;
  signals_json: { label: string; state: string; basis: string }[];
  prose_json: RatesBriefProse;
  generated_at: string | null;
};

export const latestRatesBriefQueryOptions = () =>
  queryOptions({
    queryKey: ["rates_brief", "latest"],
    queryFn: () => getLatestRatesBrief(),
    staleTime: 30 * 60 * 1000,
  });

// generated_at 이 10일 이내면 신선
export function isFresh(row: RatesBriefRow | null): boolean {
  if (!row?.generated_at) return false;
  return Date.now() - new Date(row.generated_at).getTime() <= 10 * 86400000;
}
```

- [ ] **Step 3: Commit**

```bash
cd logisight-core
git add src/lib/api/rates-brief.ts src/lib/api/rates-brief.functions.ts
git commit -m "feat(rates-brief): frontend read API"
```

---

## Task 7: Render AI prose with template fallback

**Files:**
- Modify: `logisight-core/src/components/dashboard/RatesBrief.tsx`
- Modify: `logisight-core/src/routes/index.tsx` (HomeRatesBrief, ~line 245-290)
- Test: `logisight-core/src/components/dashboard/RatesBrief.prose.test.tsx`

- [ ] **Step 1: Add a `prose` prop to RatesBrief**

In `RatesBrief.tsx`, extend `Props` and short-circuit to AI prose when provided:

```tsx
// add to Props:
//   prose?: { headline: string; ocean: string; global: string; air: string; outlook: string } | null;

// at the top of RatesBrief(), AFTER the `present.length === 0` guard, add:
  if (prose) {
    const items = [prose.ocean, prose.global, prose.air].filter((t) => t && t.trim());
    return (
      <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[dominant.state]}`} />
            <h2 className="text-sm font-semibold">운임 인텔리전스 브리프</h2>
          </div>
          <span className="text-[11px] text-muted-foreground">기준 {formatAsOf(asOf)}</span>
        </div>
        <p className="mt-2.5 text-[15px] font-semibold leading-relaxed text-foreground">{prose.headline}</p>
        <ul className="mt-3 space-y-2">
          {items.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[dominant.state]}`} />
              <span className="text-foreground/90">{t}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-md bg-status-observe/10 px-3 py-2 text-sm leading-relaxed">
          <span className="font-medium text-status-observe">전망 · </span>
          <span className="text-foreground/90">{prose.outlook}</span>
        </div>
        {sources.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">출처 {sources.join("·")}</p>}
      </section>
    );
  }
```

Update the function signature destructuring to include `prose`: `export function RatesBrief({ signals, asOf, scope, prose }: Props)`.

- [ ] **Step 2: Wire HomeRatesBrief to read the brief and fall back**

In `index.tsx`, the loader already runs `latestRatesBriefQueryOptions` (add it in Step 3). In `HomeRatesBrief`, after computing `oceanSignal/globalSignal/airModalSignal`, add:

```tsx
  // at top of HomeRatesBrief:
  const { data: brief } = useSuspenseQuery(latestRatesBriefQueryOptions());
  const fresh = isFresh(brief);

  // change the <RatesBrief .../> call to pass prose when fresh:
  <RatesBrief
    signals={[oceanSignal, globalSignal, airModalSignal]}
    asOf={fresh ? brief!.as_of.slice(0, 10) : (kcciStat?.latest_date?.slice(0, 10) ?? null)}
    prose={fresh ? brief!.prose_json : null}
  />
```

Add imports at the top of `index.tsx`:
```tsx
import { latestRatesBriefQueryOptions, isFresh } from "@/lib/api/rates-brief";
```

- [ ] **Step 3: Prefetch in the route loader**

In `index.tsx` `Route.loader`, add:
```tsx
    context.queryClient.ensureQueryData(latestRatesBriefQueryOptions());
```

- [ ] **Step 4: Write a render test for the fallback contract**

```tsx
// logisight-core/src/components/dashboard/RatesBrief.prose.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RatesBrief } from "./RatesBrief";

const sig = { label: "해상 운임 압력", state: "caution" as const, basis: "b", sources: ["KCCI"], asOf: "2026-06-15", confidence: "high" as const };

describe("RatesBrief prose", () => {
  it("renders AI prose when prose prop present", () => {
    render(<RatesBrief signals={[sig]} asOf="2026-06-15" prose={{ headline: "헤드라인X", ocean: "해상분석Y", global: "g", air: "", outlook: "전망Z" }} />);
    expect(screen.getByText("헤드라인X")).toBeTruthy();
    expect(screen.getByText("해상분석Y")).toBeTruthy();
    expect(screen.getByText(/전망Z/)).toBeTruthy();
  });
  it("falls back to template narration when prose absent", () => {
    render(<RatesBrief signals={[sig]} asOf="2026-06-15" prose={null} />);
    expect(screen.getByText(/한국발 해상 운임/)).toBeTruthy();
  });
});
```

> If `@testing-library/react` is not installed, add it: `bun add -d @testing-library/react @testing-library/jest-dom`. Confirm via `package.json` before running.

- [ ] **Step 5: Run frontend tests + typecheck**

Run: `cd logisight-core && npx vitest run src/components/dashboard/RatesBrief.prose.test.tsx && npx tsc --noEmit`
Expected: tests pass; no type errors in `RatesBrief.tsx` / `index.tsx` / `rates-brief.ts`.

- [ ] **Step 6: Commit**

```bash
cd logisight-core
git add src/components/dashboard/RatesBrief.tsx src/routes/index.tsx src/components/dashboard/RatesBrief.prose.test.tsx
git commit -m "feat(rates-brief): render AI prose with template fallback"
```

---

## Self-Review Notes (spec coverage)

- Spec §2 hybrid → Task 1 (numbers) + Task 4 (LLM prose). §2 structure kept → Task 7 prose layout (headline/ocean/global/air/outlook). §2 architecture → Tasks 3/4/6/7. §2 fallback → Task 6 `isFresh` + Task 7 prose-or-template branch.
- §4.1 signals port → Task 1 (golden test asserts pct=75/wow=+29.9/state matching the frontend logic). §4.2 table → Task 3. §4.3 frontend → Tasks 6–7. §4.4 air kg300/200% rule → Task 4 `airTopMoM` + Task 1 `computeAir`. §5 schedule → Task 5. §7 tests → Tasks 1/2/7 + Task 4 smoke.
- Deferred (spec §8): forecast AI + chg300 backend fix — not in this plan.
- Open: the migration must be applied to the remote DB before Task 4's smoke run (noted in Task 3). `@testing-library/react` install is conditional (noted in Task 7).
