# Weekly Report Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated weekly executive logistics report generator that injects deterministic freight-index tables, generates prose via one DeepSeek call with LLM-judged signal lights, writes a reviewable draft, and publishes to PDF + web.

**Architecture:** `generators/weekly-report/` mirrors the monthly report but lighter. Code deterministically builds index tables (from `freight_indices` DB + caches) and news candidates; one DeepSeek JSON call produces prose + signal lights; `assemble.js` merges JSON prose with code-built tables into a draft markdown (`status: draft`). After human approval, `weekly-report-pdf.js` renders a PDF and `publish-weekly-report.js` upserts to a `weekly_reports` table.

**Tech Stack:** Node.js (CommonJS), `node --test`, `@supabase/supabase-js`, `marked` + `puppeteer-core` (PDF), DeepSeek (`generators/lib/deepseek`), GitHub Actions.

**Reference:** Spec `docs/superpowers/specs/2026-06-16-weekly-report-generator-design.md`. Golden sample `content/drafts/weekly-report-2026-W24.md`.

---

## File Structure

```
generators/weekly-report/
  sections.config.js        # 5 section defs (id, title, table kind, news keywords)
  WEEKLY_REPORT_STYLE.md     # prose/style rules (noun-ending, no hanja/jargon, source-cite)
  lib/
    week.js                  # ISO week + reporting period (pure)
    news-filter.js           # filter+dedup news candidates per section (pure)
    air-table.js             # iata-cargo.json -> markdown air table (pure)
    weekly-data.js           # assemble all data (DB + caches + news) [I/O]
    prompt.js                # build DeepSeek system+user messages (pure)
    assemble.js              # llmJson + tables -> final markdown (pure)
  generate-weekly-report.js  # orchestrator [I/O]
  weekly-report-pdf.js       # approved md -> pdf
  publish-weekly-report.js   # approved md -> weekly_reports table + storage
generators/weekly-report/lib/*.test.js   # node:test unit tests
supabase/migrations/<ts>_weekly_reports.sql
.github/workflows/weekly-report.yml
content/weekly-report/                    # draft output dir (.gitkeep)
```

Tests live beside the unit under test (matches `generators/web/lib/*.test.js`).

---

## Task 1: ISO week + reporting period (`lib/week.js`)

**Files:**
- Create: `generators/weekly-report/lib/week.js`
- Test: `generators/weekly-report/lib/week.test.js`

- [ ] **Step 1: Write the failing test**

```js
// generators/weekly-report/lib/week.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isoWeek, reportingPeriod } = require('./week');

test('isoWeek: Sunday 2026-06-14 is 2026-W24', () => {
  const w = isoWeek(new Date('2026-06-14T05:00:00Z'));
  assert.equal(w.id, '2026-W24');
  assert.equal(w.week, 24);
  assert.equal(w.year, 2026);
});

test('reportingPeriod: week containing 2026-06-14 is Mon 06/08 .. Sun 06/14', () => {
  const p = reportingPeriod(new Date('2026-06-14T05:00:00Z'));
  assert.equal(p.start, '06/08');
  assert.equal(p.end, '06/14');
  assert.equal(p.startISO, '2026-06-08');
  assert.equal(p.endISO, '2026-06-14');
});

test('reportingPeriod: a Wednesday still maps to its Mon..Sun', () => {
  const p = reportingPeriod(new Date('2026-06-10T00:00:00Z'));
  assert.equal(p.startISO, '2026-06-08');
  assert.equal(p.endISO, '2026-06-14');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/weekly-report/lib/week.test.js`
Expected: FAIL — `Cannot find module './week'`.

- [ ] **Step 3: Write minimal implementation**

```js
// generators/weekly-report/lib/week.js
'use strict';
// ISO 8601 주차 + 보고기간(해당 주의 월~일). 입력 Date는 UTC 기준으로 다룬다.

function atUTCMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// ISO: 월요일=0..일요일=6
function isoDow(d) { return (d.getUTCDay() + 6) % 7; }

function isoWeek(date) {
  const d = atUTCMidnight(date);
  // 목요일로 이동해 ISO 연도/주차 결정
  d.setUTCDate(d.getUTCDate() - isoDow(d) + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - isoDow(firstThursday) + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  const year = d.getUTCFullYear();
  return { year, week, id: `${year}-W${String(week).padStart(2, '0')}` };
}

function reportingPeriod(date) {
  const d = atUTCMidnight(date);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - isoDow(d));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const mm = (x) => String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = (x) => String(x.getUTCDate()).padStart(2, '0');
  const iso = (x) => `${x.getUTCFullYear()}-${mm(x)}-${dd(x)}`;
  return {
    start: `${mm(monday)}/${dd(monday)}`,
    end: `${mm(sunday)}/${dd(sunday)}`,
    startISO: iso(monday),
    endISO: iso(sunday),
  };
}

module.exports = { isoWeek, reportingPeriod };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/weekly-report/lib/week.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add generators/weekly-report/lib/week.js generators/weekly-report/lib/week.test.js
git commit -m "feat(weekly-report): ISO week + reporting period util"
```

---

## Task 2: Section config (`sections.config.js`)

**Files:**
- Create: `generators/weekly-report/sections.config.js`
- Test: `generators/weekly-report/sections.config.test.js`

- [ ] **Step 1: Write the failing test**

```js
// generators/weekly-report/sections.config.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SECTIONS = require('./sections.config');

test('exactly 5 sections in fixed order', () => {
  assert.deepEqual(SECTIONS.map(s => s.id), ['overview', 'ocean', 'air', 'logistics', 'trade']);
});

test('ocean section tracks freight indices and has keywords', () => {
  const ocean = SECTIONS.find(s => s.id === 'ocean');
  assert.equal(ocean.table, 'ocean');
  assert.ok(ocean.keywords.includes('freight'));
});

test('logistics and trade have no injected table', () => {
  assert.equal(SECTIONS.find(s => s.id === 'logistics').table, null);
  assert.equal(SECTIONS.find(s => s.id === 'trade').table, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/weekly-report/sections.config.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// generators/weekly-report/sections.config.js
'use strict';
// 주간 리포트 5섹션 고정. table: 'ocean'|'air'|'summary'|null (코드 주입 표 종류).
const SECTIONS = [
  {
    id: 'overview', title: '1. 주간 글로벌 시황 정리', table: 'summary',
    keywords: ['hormuz', 'iran', 'rate', 'scfi', 'kcci', 'tariff', 'blank', 'market pulse'],
  },
  {
    id: 'ocean', title: '2. 해상', table: 'ocean',
    keywords: ['freight', 'rate', 'scfi', 'kcci', 'wci', 'ccfi', 'bdi', 'container',
      'blank sailing', 'surcharge', 'pss', 'fak', 'gri', 'hormuz', 'red sea',
      'cma', 'maersk', 'msc', 'hapag', 'cosco', 'market pulse', 'capacity'],
  },
  {
    id: 'air', title: '3. 항공', table: 'air',
    keywords: ['air cargo', 'airfreight', 'air freight', 'iata', 'tac', 'bai',
      'belly', 'charter', 'express', 'e-commerce', 'capacity', 'demand', 'cargolux'],
  },
  {
    id: 'logistics', title: '4. 물류 사업 전반', table: null,
    keywords: ['acqui', 'merger', 'm&a', 'invest', 'digital', 'forwarder',
      'integrat', 'subsidiary', 'partnership', 'logistics provider', '3pl'],
  },
  {
    id: 'trade', title: '5. 무역', table: null,
    keywords: ['tariff', 'trade', 'sanction', 'iran', 'geopolit', 'policy',
      'customs', 'export control', 'panama', 'reflag', 'wto', 'fta', 'ustr', 'cbp'],
  },
];
module.exports = SECTIONS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/weekly-report/sections.config.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add generators/weekly-report/sections.config.js generators/weekly-report/sections.config.test.js
git commit -m "feat(weekly-report): 5-section config"
```

---

## Task 3: News filter (`lib/news-filter.js`)

**Files:**
- Create: `generators/weekly-report/lib/news-filter.js`
- Test: `generators/weekly-report/lib/news-filter.test.js`

- [ ] **Step 1: Write the failing test**

```js
// generators/weekly-report/lib/news-filter.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterNews } = require('./news-filter');

const now = new Date('2026-06-14T00:00:00Z');
const items = [
  { title: 'Container freight rates continue march northwards', source: 'Seatrade', url: 'u1', published_at: '2026-06-12T00:00:00Z' },
  { title: 'Old rate news', source: 'X', url: 'u2', published_at: '2026-05-01T00:00:00Z' }, // too old
  { title: 'Container freight rates continue march northwards', source: 'Seatrade', url: 'u3', published_at: '2026-06-12T00:00:00Z' }, // dup title
  { title: 'Random offshore wind story', source: 'Y', url: 'u4', published_at: '2026-06-13T00:00:00Z' }, // no keyword
];

test('keeps recent, keyword-matching, title-deduped items', () => {
  const out = filterNews(items, ['freight', 'rate'], now, 7);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'u1');
});

test('limit caps results', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    ({ title: `freight story ${i}`, source: 'S', url: `u${i}`, published_at: '2026-06-12T00:00:00Z' }));
  assert.equal(filterNews(many, ['freight'], now, 7, 3).length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/weekly-report/lib/news-filter.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// generators/weekly-report/lib/news-filter.js
'use strict';
// 섹션 키워드로 최근 N일 뉴스 필터 + 제목 dedup. 순수 함수.

function filterNews(items, keywords, now, days = 7, limit = 12) {
  const since = now.getTime() - days * 86400000;
  const kw = keywords.map(k => k.toLowerCase());
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    if (!it || !it.title || !it.url) continue;
    if (it.published_at) {
      const t = Date.parse(it.published_at);
      if (!isNaN(t) && t < since) continue;
    }
    const hay = `${it.title} ${it.summary_en || ''}`.toLowerCase();
    if (kw.length && !kw.some(k => hay.includes(k))) continue;
    if (seen.has(it.title)) continue;
    seen.add(it.title);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { filterNews };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/weekly-report/lib/news-filter.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add generators/weekly-report/lib/news-filter.js generators/weekly-report/lib/news-filter.test.js
git commit -m "feat(weekly-report): per-section news filter"
```

---

## Task 4: Air table builder (`lib/air-table.js`)

**Files:**
- Create: `generators/weekly-report/lib/air-table.js`
- Test: `generators/weekly-report/lib/air-table.test.js`

- [ ] **Step 1: Write the failing test**

```js
// generators/weekly-report/lib/air-table.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAirTable } = require('./air-table');

const iata = {
  data: {
    asOf: '2026-06',
    headline: { clf_level: 46, clf_ppt: 1.9 },
    regions: [
      { region: '전체(글로벌)', ctk_yoy: 4, actk_yoy: -0.4 },
      { region: '중동', ctk_yoy: -18.2, actk_yoy: -22.9 },
    ],
  },
};

test('builds markdown table with region rows and source line', () => {
  const { table, factText } = buildAirTable(iata);
  assert.match(table, /전체\(글로벌\)/);
  assert.match(table, /\+4/);
  assert.match(table, /-18\.2/);
  assert.match(factText, /2026-06/);
});

test('missing data returns honest placeholder', () => {
  const { table } = buildAirTable(null);
  assert.match(table, /미수집/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/weekly-report/lib/air-table.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// generators/weekly-report/lib/air-table.js
'use strict';
// IATA iata-cargo.json -> 항공 권역 마크다운 표 + factText. 순수 함수.

function fmt(n) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n}%`;
}

function buildAirTable(iata) {
  const d = iata && iata.data;
  if (!d || !Array.isArray(d.regions) || !d.regions.length) {
    return { table: '_IATA 항공 데이터 미수집_', factText: '' };
  }
  const head = '| 권역 | 수요 CTK(YoY) | 공급 ACTK(YoY) |\n|---|---|---|';
  const rows = d.regions.map(r => `| ${r.region} | ${fmt(r.ctk_yoy)} | ${fmt(r.actk_yoy)} |`);
  const clf = d.headline
    ? ` 글로벌 적재율(CLF) ${d.headline.clf_level}%(${fmt(d.headline.clf_ppt).replace('%', '%p')}).`
    : '';
  const table = [head, ...rows].join('\n');
  const factText = `출처: IATA Air Cargo Market Analysis(iata-cargo, asOf ${d.asOf}).${clf}`;
  return { table, factText };
}

module.exports = { buildAirTable };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/weekly-report/lib/air-table.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add generators/weekly-report/lib/air-table.js generators/weekly-report/lib/air-table.test.js
git commit -m "feat(weekly-report): IATA air table builder"
```

---

## Task 5: Ocean table builder (`lib/ocean-table.js`)

**Files:**
- Create: `generators/weekly-report/lib/ocean-table.js`
- Test: `generators/weekly-report/lib/ocean-table.test.js`

Reuses the row shape returned by `generators/report/lib/index-factsheet.js` `loadIndexFactsheet()`:
`{ code, value, week_date, unit, wow, mom }`.

- [ ] **Step 1: Write the failing test**

```js
// generators/weekly-report/lib/ocean-table.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOceanTable } = require('./ocean-table');

const rows = [
  { code: 'SCFI', value: 2985.22, week_date: '2026-06-08', unit: 'point', wow: 9.5 },
  { code: 'KCCI', value: 3042, week_date: '2026-06-08', unit: 'point', wow: 13.7 },
  { code: 'BDI', value: 3114, week_date: '2026-06-01', unit: 'point', wow: -3.5 },
];

test('renders index rows with WoW arrows and basis date', () => {
  const { table } = buildOceanTable(rows);
  assert.match(table, /SCFI 종합/);
  assert.match(table, /▲ \+9\.5%/);
  assert.match(table, /▼ -3\.5%/);
  assert.match(table, /06\/08/);
});

test('null rows -> honest placeholder', () => {
  assert.match(buildOceanTable(null).table, /미수집/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/weekly-report/lib/ocean-table.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// generators/weekly-report/lib/ocean-table.js
'use strict';
// freight_indices 행 배열 -> 해상 INDEX 마크다운 표. 순수 함수.
const LABEL = {
  SCFI: 'SCFI 종합', SCFI_USWC: 'SCFI 미주서안', SCFI_USEC: 'SCFI 미주동안',
  SCFI_EU: 'SCFI 유럽', KCCI: 'KCCI 종합', CCFI: 'CCFI 종합', WCI: 'WCI 종합', BDI: 'BDI',
};

function chg(p) {
  if (p == null) return '—';
  const dir = p > 0.05 ? '▲ ' : p < -0.05 ? '▼ ' : '';
  return `${dir}${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function mmdd(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

function buildOceanTable(rows) {
  const valid = (rows || []).filter(r => r && r.value != null);
  if (!valid.length) return { table: '_해상 지표 데이터 미수집_', factText: '' };
  const head = '| 지수 | 최신값 | 기준일 | 전주 대비 |\n|---|---|---|---|';
  const body = valid.map(r =>
    `| ${LABEL[r.code] || r.code} | ${r.value}${r.unit === '$/FEU' ? '달러/FEU' : 'pt'} | ${mmdd(r.week_date)} | ${chg(r.wow)} |`);
  const table = [head, ...body].join('\n');
  return { table, factText: '출처: freight_indices(SCFI·KCCI·CCFI·WCI·BDI).' };
}

module.exports = { buildOceanTable };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/weekly-report/lib/ocean-table.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add generators/weekly-report/lib/ocean-table.js generators/weekly-report/lib/ocean-table.test.js
git commit -m "feat(weekly-report): ocean index table builder"
```

---

## Task 6: Style guide doc (`WEEKLY_REPORT_STYLE.md`)

**Files:**
- Create: `generators/weekly-report/WEEKLY_REPORT_STYLE.md`

- [ ] **Step 1: Write the style guide**

```markdown
# 주간 리포트 문체 규칙

- **명사형 종결 필수.** 예: "변동성 확대 예상", "단기 과열 구간 진입". `~된다/~한다/~이다/~우세하다` 등 서술형 어미 금지.
- **두괄식.** 모든 섹션·문단은 결론 먼저, 근거는 뒤.
- **수치 출처 필수.** 모든 수치 뒤 `(SCFI, 06/08)` 형식 출처 또는 `[ASSUMPTION]`. 추측을 사실처럼 단정 금지.
- **어려운 한자 약물 금지** (弗·億·比·美·亞·北·前倒·脫出). 한글로: 달러·억·대비·미국·아시아.
- **불분명 외래어 금지** (헤지 등). 풀어서 서술.
- **신호등은 리스크 수준** (🟢 안정 / 🟡 관망 / 🔴 주의). 이모지로만. 가격 등락색과 무관.
- **뉴스는 결론 뒷받침용 3건만 선별.**
- 핵심 수치 굵게. 전주 대비 증감은 `▲/▼ +X.X%`.
```

- [ ] **Step 2: Commit**

```bash
git add generators/weekly-report/WEEKLY_REPORT_STYLE.md
git commit -m "docs(weekly-report): style guide"
```

---

## Task 7: Prompt builder (`lib/prompt.js`)

**Files:**
- Create: `generators/weekly-report/lib/prompt.js`
- Test: `generators/weekly-report/lib/prompt.test.js`

`buildMessages(weeklyData)` returns `{ system, messages }` for `callDeepSeekJson`. `weeklyData` shape:
`{ weekId, period:{start,end}, sections:[{ id, title, table, factText, news:[{title,source}] }] }`.
The LLM must return JSON keyed by section id plus `execSummary`.

- [ ] **Step 1: Write the failing test**

```js
// generators/weekly-report/lib/prompt.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessages } = require('./prompt');

const wd = {
  weekId: '2026-W24', period: { start: '06/08', end: '06/14' },
  sections: [
    { id: 'ocean', title: '2. 해상', table: '| 지수 |...|', factText: '출처: freight_indices',
      news: [{ title: 'Container freight rates continue march northwards', source: 'Seatrade' }] },
  ],
};

test('system prompt carries style + signal rules', () => {
  const { system } = buildMessages(wd);
  assert.match(system, /명사형 종결/);
  assert.match(system, /🟢|신호등/);
});

test('user message injects week, tables, and news candidates; demands JSON', () => {
  const { messages } = buildMessages(wd);
  const u = messages[0].content;
  assert.match(u, /2026-W24/);
  assert.match(u, /Container freight rates/);
  assert.match(u, /JSON/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/weekly-report/lib/prompt.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// generators/weekly-report/lib/prompt.js
'use strict';
// 주간 리포트 DeepSeek 메시지 빌더. 표는 주입(재생성 금지), 산문·신호등만 생성.

const SYSTEM = `당신은 한국 중견 물류기업 경영기획팀의 전략 기획 전문가다.
주간 글로벌 물류 리포트를 두괄식 + 신호등으로 작성한다.

문체 규칙:
- 명사형 종결 필수(예: "변동성 확대 예상", "단기 과열 구간 진입"). ~된다/~한다/~이다/~우세하다 어미 금지.
- 어려운 한자 약물(弗·億·比·美·亞·北·前倒·脫出) 금지, 한글(달러·대비·미국·아시아).
- 불분명 외래어(헤지 등) 금지.
- 모든 수치 뒤 출처(괄호) 또는 [ASSUMPTION]. 추측을 사실처럼 단정 금지.

신호등(리스크 수준, 이모지로만):
- 🟢 안정/우호, 🟡 관망/혼조, 🔴 주의/경보.
주입된 수치·뉴스를 근거로 섹션별·종합 신호등을 직접 판단한다.

각 섹션은 결론(명사형) → 배경 → 분석 → 시사점 순. 표는 주입된 것을 그대로 쓰고 재생성하지 않는다.
뉴스는 각 섹션 결론을 뒷받침하는 것만 최대 3건 선별한다.`;

function buildMessages(weeklyData) {
  const blocks = weeklyData.sections.map(s => {
    const news = (s.news || []).map((n, i) => `  ${i + 1}. ${n.title} [${n.source}]`).join('\n') || '  (없음)';
    return `### ${s.title} (id: ${s.id})
표:
${s.table || '(표 없음)'}
${s.factText || ''}
후보 뉴스:
${news}`;
  }).join('\n\n');

  const user = `주차: ${weeklyData.weekId} (보고기간 ${weeklyData.period.start}~${weeklyData.period.end})

아래 섹션별 주입 데이터로 리포트 산문을 작성하라.

${blocks}

반드시 아래 JSON만 출력하라(표는 포함하지 말 것):
{
  "execSummary": [{"topic":"해상","signal":"🔴","basis":"근거 1문장(명사형)"}, ...(섹션별 1행)],
  "overview": {"signal":"🟡","conclusion":"명사형 종합 결론","events":["핵심 이벤트(명사형) 3~5개"],"background":"...","analysis":"...","implication":"..."},
  "sections": {
    "ocean": {"signal":"🔴","conclusion":"명사형 결론","background":"...","analysis":"...","implication":"...","news":[{"title":"...","source":"...","note":"결론 뒷받침 근거"}],"sowhat":"한국 화주 So-what(명사형)"},
    "air": {...}, "logistics": {...}, "trade": {...}
  }
}`;

  return { system: SYSTEM, messages: [{ role: 'user', content: user }] };
}

module.exports = { buildMessages };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/weekly-report/lib/prompt.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add generators/weekly-report/lib/prompt.js generators/weekly-report/lib/prompt.test.js
git commit -m "feat(weekly-report): DeepSeek prompt builder"
```

---

## Task 8: Markdown assembler (`lib/assemble.js`)

**Files:**
- Create: `generators/weekly-report/lib/assemble.js`
- Test: `generators/weekly-report/lib/assemble.test.js`

Merges code-built tables (`weeklyData`) with LLM prose (`llmJson`) into the final markdown matching the golden sample layout.

- [ ] **Step 1: Write the failing test**

```js
// generators/weekly-report/lib/assemble.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleMarkdown } = require('./assemble');

const wd = {
  weekId: '2026-W24', period: { start: '06/08', end: '06/14' }, generatedAt: '2026-06-14',
  sections: [
    { id: 'overview', title: '1. 주간 글로벌 시황 정리', table: null, factText: '' },
    { id: 'ocean', title: '2. 해상', table: '| 지수 | 최신값 |\n|---|---|\n| SCFI | 2985 |', factText: '출처: freight_indices' },
  ],
};
const llm = {
  execSummary: [{ topic: '해상', signal: '🔴', basis: '운임 급등' }],
  overview: { signal: '🟡', events: ['운임 급등'], background: 'b', analysis: 'a', implication: 'i' },
  sections: { ocean: { signal: '🔴', conclusion: '과열 구간 진입', background: 'b', analysis: 'a', implication: 'i', news: [{ title: 'T', source: 'S', note: 'n' }], sowhat: '조기 부킹 권고' } },
};

test('produces frontmatter draft + cover + exec summary + injected ocean table', () => {
  const md = assembleMarkdown(wd, llm);
  assert.match(md, /status: draft/);
  assert.match(md, /# 24주차 글로벌 물류 시황/);
  assert.match(md, /## Executive Summary/);
  assert.match(md, /\| SCFI \| 2985 \|/);       // injected table verbatim
  assert.match(md, /과열 구간 진입/);             // llm conclusion
  assert.match(md, /➔/);                          // sowhat marker
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test generators/weekly-report/lib/assemble.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// generators/weekly-report/lib/assemble.js
'use strict';
// weeklyData(코드 표) + llmJson(산문) -> 최종 마크다운. 순수 함수.

function weekNum(weekId) { return Number(weekId.split('-W')[1]); }

function assembleMarkdown(weeklyData, llm) {
  const { weekId, period, generatedAt, sections } = weeklyData;
  const wn = weekNum(weekId);
  const L = [];

  L.push('---');
  L.push('status: draft');
  L.push(`week: ${weekId}`);
  L.push(`period: ${period.start}~${period.end}`);
  L.push(`generated_at: ${generatedAt}`);
  L.push('---', '');

  L.push(`# ${wn}주차 글로벌 물류 시황`, '');
  L.push('| 항목 | 내용 |', '|---|---|');
  L.push(`| 작성일 | ${generatedAt} |`);
  L.push('| 작성자 | 경영기획팀 |');
  L.push('| 보고대상 | 임원회의 |');
  L.push(`| 보고기간 | ${period.start} ~ ${period.end} (${wn}주차) |`, '');

  L.push('---', '', '## Executive Summary', '');
  L.push('| 주제 | 결론(신호등) | 핵심 근거 |', '|---|---|---|');
  for (const r of llm.execSummary || []) L.push(`| ${r.topic} | ${r.signal} | ${r.basis} |`);
  L.push('', '> ※ 신호등은 리스크 수준(🟢 안정 / 🟡 관망 / 🔴 주의)이며 가격 등락색과 무관.', '');

  // 1. overview
  const ov = llm.overview || {};
  L.push('---', '', `## ${sections.find(s => s.id === 'overview').title}`, '');
  L.push(`**결론: ${ov.conclusion || ''} (${ov.signal || ''}).**`, '');
  if (ov.events && ov.events.length) {
    L.push('### 핵심 이벤트', '');
    ov.events.forEach((e, i) => L.push(`${i + 1}. ${e}`));
    L.push('');
  }
  L.push('### 종합 해설', '');
  L.push(`- **배경:** ${ov.background || ''}`);
  L.push(`- **분석:** ${ov.analysis || ''}`);
  L.push(`- **시사점:** ${ov.implication || ''}`, '');

  // 2..5
  for (const sec of sections.filter(s => s.id !== 'overview')) {
    const p = (llm.sections || {})[sec.id] || {};
    L.push('---', '', `## ${sec.title}`, '');
    L.push(`**결론: ${p.conclusion || ''} (${p.signal || ''}).**`, '');
    if (sec.table) {
      L.push('### INDEX', '', sec.table, '');
      if (sec.factText) L.push(`> ${sec.factText}`, '');
    }
    L.push('### 이슈', '');
    L.push(`- **배경:** ${p.background || ''}`);
    L.push(`- **분석:** ${p.analysis || ''}`);
    L.push(`- **시사점:** ${p.implication || ''}`, '');
    if (p.news && p.news.length) {
      L.push('### 뉴스 (결론 뒷받침)', '');
      for (const n of p.news) L.push(`- ${n.title} — [${n.source}]${n.note ? ` *(${n.note})*` : ''}`);
      L.push('');
    }
    if (p.sowhat) L.push(`➔ **한국 화주 시사점:** ${p.sowhat}`, '');
  }

  return L.join('\n');
}

module.exports = { assembleMarkdown };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test generators/weekly-report/lib/assemble.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add generators/weekly-report/lib/assemble.js generators/weekly-report/lib/assemble.test.js
git commit -m "feat(weekly-report): markdown assembler"
```

---

## Task 9: Data assembly (`lib/weekly-data.js`) [I/O]

**Files:**
- Create: `generators/weekly-report/lib/weekly-data.js`

Integration module (DB + cache + file). No unit test (I/O); verified via the smoke run in Task 10.

- [ ] **Step 1: Implement**

```js
// generators/weekly-report/lib/weekly-data.js
'use strict';
const fs = require('fs');
const path = require('path');
const SECTIONS = require('../sections.config');
const { filterNews } = require('./news-filter');
const { buildOceanTable } = require('./ocean-table');
const { buildAirTable } = require('./air-table');
const { isoWeek, reportingPeriod } = require('./week');
const { loadIndexFactsheet } = require('../../report/lib/index-factsheet');

const ROOT = path.resolve(__dirname, '../../..');
const NEWS_PATH = path.join(ROOT, 'content/drafts/latest-news.json');

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')); } catch { return null; }
}

// latest-news.json -> 섹션 키워드 입력용 통합 풀
function newsPool(news) {
  return [
    ...(news.shipping || []), ...(news.air || []), ...(news.rail || []),
    ...(news.trade || []), ...(news.risk || []), ...(news.carrier_advisory || []),
  ];
}

async function assembleWeeklyData(supabase, now = new Date()) {
  const period = reportingPeriod(now);
  const weekId = isoWeek(now).id;
  const generatedAt = now.toISOString().slice(0, 10);

  const indexRows = supabase ? await loadIndexFactsheet().catch(() => null) : null;
  const iata = readJson('outputs/cache/iata-cargo.json');
  const news = readJson('content/drafts/latest-news.json') || {};
  const pool = newsPool(news);

  const sections = SECTIONS.map(sec => {
    let table = null, factText = '';
    if (sec.table === 'ocean') ({ table, factText } = buildOceanTable(indexRows));
    else if (sec.table === 'air') ({ table, factText } = buildAirTable(iata));
    const newsItems = filterNews(pool, sec.keywords, now, 7, 8)
      .map(n => ({ title: n.title, source: n.source }));
    return { id: sec.id, title: sec.title, table, factText, news: newsItems };
  });

  return { weekId, period, generatedAt, sections };
}

module.exports = { assembleWeeklyData };
```

> Note: `loadIndexFactsheet` reads `process.env.SUPABASE_*` internally and returns the row array or null. The `supabase` arg here only gates whether to attempt it.

- [ ] **Step 2: Commit**

```bash
git add generators/weekly-report/lib/weekly-data.js
git commit -m "feat(weekly-report): data assembly (db + cache + news)"
```

---

## Task 10: Generator orchestrator (`generate-weekly-report.js`) [I/O]

**Files:**
- Create: `generators/weekly-report/generate-weekly-report.js`
- Modify: `package.json` (add script)

- [ ] **Step 1: Implement**

```js
// generators/weekly-report/generate-weekly-report.js
'use strict';
// 주간 리포트 초안 생성: 데이터 조립 -> DeepSeek -> 마크다운 -> content/weekly-report/YYYY-Www.md
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../lib/deepseek');
const { assembleWeeklyData } = require('./lib/weekly-data');
const { buildMessages } = require('./lib/prompt');
const { assembleMarkdown } = require('./lib/assemble');

const OUT_DIR = path.resolve(__dirname, '../../content/weekly-report');

async function main() {
  const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

  const wd = await assembleWeeklyData(supabase, new Date());
  const { system, messages } = buildMessages(wd);
  const llm = await callDeepSeekJson({ system, messages, max_tokens: 4096 });
  const md = assembleMarkdown(wd, llm);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${wd.weekId}.md`);
  fs.writeFileSync(out, md, 'utf-8');
  console.log(`✅ 주간 리포트 초안: ${out} (${wd.weekId}, ${wd.period.start}~${wd.period.end})`);
}

main().catch(e => { console.error('주간 리포트 생성 실패:', e.message); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

In `package.json` `scripts`, add:
```json
"weekly-report:generate": "node generators/weekly-report/generate-weekly-report.js",
```

- [ ] **Step 3: Smoke-run against live data**

Run: `npm run weekly-report:generate`
Expected: writes `content/weekly-report/2026-W2x.md`; console prints the path. Open the file and confirm: frontmatter `status: draft`, Executive Summary table, injected ocean/air tables, noun-ending prose, signal emojis.

- [ ] **Step 4: Commit**

```bash
git add generators/weekly-report/generate-weekly-report.js package.json
git commit -m "feat(weekly-report): generator orchestrator + npm script"
```

> Do NOT commit the generated draft here; it is reviewed/committed separately (Task 14 review flow).

---

## Task 11: PDF renderer (`weekly-report-pdf.js`)

**Files:**
- Create: `generators/weekly-report/weekly-report-pdf.js`
- Modify: `package.json` (add script)

Mirror the marked + puppeteer-core approach of `generators/report/monthly-report-pdf.js` (read that file first for the Chrome executable-path resolution and page CSS), but render the single weekly markdown.

- [ ] **Step 1: Implement**

```js
// generators/weekly-report/weekly-report-pdf.js
'use strict';
// 승인된 주간 리포트 마크다운 -> A4 PDF.
// 사용법: node generators/weekly-report/weekly-report-pdf.js --week=2026-W24
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '../..');
const weekArg = process.argv.find(a => a.startsWith('--week='));

function stripFrontmatter(md) {
  return md.replace(/^---[\s\S]*?---\s*/, '');
}

// monthly-report-pdf.js 와 동일한 Chrome 경로 해석을 사용한다.
function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH
    || process.env.CHROME_PATH
    || '/usr/bin/google-chrome';
}

async function main() {
  if (!weekArg) throw new Error('--week=YYYY-Www 필요');
  const week = weekArg.split('=')[1];
  const src = path.join(ROOT, 'content/weekly-report', `${week}.md`);
  const md = fs.readFileSync(src, 'utf-8');
  if (!/status:\s*approved/.test(md)) throw new Error(`승인되지 않음(status: approved 아님): ${src}`);

  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Pretendard','Malgun Gothic',sans-serif; font-size: 11pt; color: #222; line-height: 1.5; }
  h1 { font-size: 20pt; border-bottom: 2px solid #0070C0; padding-bottom: 6px; }
  h2 { font-size: 14pt; color: #0070C0; margin-top: 18px; }
  h3 { font-size: 12pt; margin-top: 12px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10pt; }
  th,td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; }
  th { background: #eef3f8; }
  blockquote { color: #666; font-size: 9.5pt; border-left: 3px solid #ccc; margin: 6px 0; padding-left: 8px; }
</style></head><body>${marked.parse(stripFrontmatter(md))}</body></html>`;

  const outDir = path.join(ROOT, 'content/published');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `weekly-report-${week}.pdf`);

  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: out, format: 'A4', printBackground: true });
  await browser.close();
  console.log(`✅ PDF: ${out}`);
}

main().catch(e => { console.error('PDF 생성 실패:', e.message); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

```json
"weekly-report:pdf": "node generators/weekly-report/weekly-report-pdf.js",
```

- [ ] **Step 3: Manual verify**

Temporarily set `status: approved` in a generated draft, then run:
`npm run weekly-report:pdf -- --week=2026-W2x`
Expected: `content/published/weekly-report-2026-W2x.pdf` exists and opens.

- [ ] **Step 4: Commit**

```bash
git add generators/weekly-report/weekly-report-pdf.js package.json
git commit -m "feat(weekly-report): markdown -> A4 PDF renderer"
```

---

## Task 12: `weekly_reports` table migration

**Files:**
- Create: `supabase/migrations/20260616000030_weekly_reports.sql`

- [ ] **Step 1: Write migration**

```sql
-- 030: 주간 리포트 게재 저장 (웹 노출 원본)
CREATE TABLE IF NOT EXISTS weekly_reports (
  week_id       TEXT PRIMARY KEY,          -- 'YYYY-Www'
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  title         TEXT NOT NULL,
  summary_json  JSONB,                     -- execSummary(신호등·근거) + 핵심수치
  body_md       TEXT NOT NULL,
  pdf_url       TEXT,
  published_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"     ON weekly_reports FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON weekly_reports FOR ALL   TO service_role USING (true);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260616000030_weekly_reports.sql
git commit -m "feat(db): weekly_reports table"
```

---

## Task 13: Publish script (`publish-weekly-report.js`)

**Files:**
- Create: `generators/weekly-report/publish-weekly-report.js`
- Modify: `package.json` (add script)

- [ ] **Step 1: Implement**

```js
// generators/weekly-report/publish-weekly-report.js
'use strict';
// 승인된 주간 리포트 -> weekly_reports upsert (+ pdf_url 있으면 기록).
// 사용법: node generators/weekly-report/publish-weekly-report.js --week=2026-W24 [--pdf-url=https://...]
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '../..');

function arg(name) { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; }

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return meta;
}

async function main() {
  const week = arg('week'); if (!week) throw new Error('--week=YYYY-Www 필요');
  const src = path.join(ROOT, 'content/weekly-report', `${week}.md`);
  const md = fs.readFileSync(src, 'utf-8');
  const meta = parseFrontmatter(md);
  if (meta.status !== 'approved') throw new Error(`승인되지 않음: ${src}`);

  const [ps, pe] = (meta.period || '').split('~');
  const year = week.split('-W')[0];
  const wn = Number(week.split('-W')[1]);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const row = {
    week_id: week,
    period_start: meta.period_start_iso || `${year}-01-01`, // 정밀 ISO는 frontmatter에 period_start_iso 있으면 사용
    period_end: meta.period_end_iso || `${year}-12-31`,
    title: `${wn}주차 글로벌 물류 시황`,
    body_md: md.replace(/^---[\s\S]*?---\s*/, ''),
    pdf_url: arg('pdf-url') || null,
    published_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('weekly_reports').upsert(row, { onConflict: 'week_id' });
  if (error) throw new Error(error.message);
  console.log(`✅ 웹 발행: weekly_reports/${week}`);
}

main().catch(e => { console.error('발행 실패:', e.message); process.exit(1); });
```

> The assembler (Task 8) must also emit `period_start_iso` / `period_end_iso` in frontmatter. Update `assemble.js` frontmatter block to add:
> `L.push(\`period_start_iso: ${weeklyData.period.startISO}\`);` and the matching end line, and add `startISO`/`endISO` passthrough in `weekly-data.js` `period` (already returned by `reportingPeriod`). Re-run Task 8 test (still passes — only adds lines).

- [ ] **Step 2: Add npm script**

```json
"weekly-report:publish": "node generators/weekly-report/publish-weekly-report.js",
```

- [ ] **Step 3: Commit**

```bash
git add generators/weekly-report/publish-weekly-report.js generators/weekly-report/lib/assemble.js package.json
git commit -m "feat(weekly-report): publish approved report to weekly_reports"
```

---

## Task 14: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/weekly-report.yml`

- [ ] **Step 1: Write workflow** (read `.github/workflows/daily-web-articles.yml` first to match the env/secret + node setup pattern)

```yaml
name: Weekly Report Draft

on:
  schedule:
    - cron: '0 5 * * 0'   # 일요일 14:00 KST (05:00 UTC)
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run weekly-report:generate
      - name: Commit draft
        run: |
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add content/weekly-report/*.md
          git commit -m "chore(weekly-report): draft $(date -u +%Y-W%V)" || echo "no changes"
          git push || echo "push skipped"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/weekly-report.yml
git commit -m "ci(weekly-report): Sunday 14:00 KST draft generation"
```

---

## Task 15: Review-flow doc + golden-sample regression note

**Files:**
- Modify: `generators/weekly-report/WEEKLY_REPORT_STYLE.md` (append review flow)

- [ ] **Step 1: Append the human review flow**

```markdown

## 발행 절차 (검토 게이트)
1. 일요일 워크플로가 `content/weekly-report/YYYY-Www.md` 초안(`status: draft`) 생성.
2. 사람이 검토·수정 후 frontmatter `status: draft` → `approved`.
3. `npm run weekly-report:pdf -- --week=YYYY-Www` → `content/published/weekly-report-YYYY-Www.pdf`.
4. `npm run weekly-report:publish -- --week=YYYY-Www [--pdf-url=...]` → 웹(`weekly_reports`) 게재.
```

- [ ] **Step 2: Commit**

```bash
git add generators/weekly-report/WEEKLY_REPORT_STYLE.md
git commit -m "docs(weekly-report): publish/review flow"
```

---

## Self-Review Notes (spec coverage)

- Spec §4 modules → Tasks 1–13. §5 sections → Task 2 + Task 8. §6 LLM signal → Task 7 prompt + Task 8 passthrough. §7 LLM rules → Task 6/7. §8 output (draft/PDF/web) → Tasks 10/11/13. §8.4 weekly_reports + edge fn: table+publish in Tasks 12–13; the Edge Function swap (`supabase/functions/reports/index.ts`) is **deferred** (spec §8.4 marks the frontend route out of scope) — the data contract (`weekly_reports`) is delivered. §9 schedule → Task 14. §10 week util → Task 1. §11 tests → Tasks 1–8 unit + Task 10 smoke.
- Open items (spec §13): Supabase Storage bucket for PDF hosting is not auto-created here; `--pdf-url` is passed manually for now. DeepSeek single-call consistency is validated in the Task 10 smoke run; if a section comes back empty, the fallback (split into 2 calls) is a follow-up, not in this plan.
