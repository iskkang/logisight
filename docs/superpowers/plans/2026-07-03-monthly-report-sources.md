# Monthly Report 데이터 소스 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월간 리포트를 **라벨=발행월 / 데이터=직전 완료월로 분리**(발행월 데이터 배제)하고, `maritime_news`의 external 원문을 병합해 뉴스 소스를 넓힌다.

> **⚠️ 갱신 (2026-07-04) — 라벨/데이터 분리:** 아래 Task 1~2는 라벨 `MONTH`을 "직전 완료월"로 잡았으나,
> 확정 요구에 따라 이후 커밋 `75fa385`에서 **라벨=발행(현재)월, 데이터 상한=직전월 말일**로 분리됨.
> 현재 코드 진실:
> - `report-month.js` export = `{ resolveMonth, monthEndISO, prevMonthOf }` (구 `prevCompletedMonth` 제거).
> - `resolveMonth(argv, today)` 기본값 = **현재월**(라벨). `run-section.js`: `WEEK_END = monthEndISO(prevMonthOf(MONTH))`.
> - 결과: `2026-07` 라벨 + 6월말 데이터 상한. 검증 통과(prod run 커밋 `4fa8e56`).
> 아래 Task 본문은 최초 구현 이력이며, 최신 동작은 이 배너와 스펙 문서를 기준으로 볼 것.

**Architecture:** 순수 함수(월 계산·정규화·랭킹)는 `node:test`로 TDD하고, Supabase I/O는 `.env.local` 기반 통합 스크립트로 검증한다. `run-section.js`가 오케스트레이션 지점 — 대상 월/월말일을 계산해 지수 로더에 상한으로 전달하고, `maritime_news` 아이템을 파일 아이템 풀에 병합한다. 수집 파이프라인(collectors)은 건드리지 않는다.

**Tech Stack:** Node.js (CommonJS), `@supabase/supabase-js`, `node:test`/`node:assert`, `dotenv`.

## Global Constraints

- 테스트 러너: `node:test` + `node:assert/strict`. 콜로케이트 `*.test.js`. 실행 `node --test <경로>`.
- 모든 Supabase 로더는 **env 가드**: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 없으면 조회 없이 안전값 반환(전체 실행 안 죽임).
- **발행월 데이터 불혼입 불변식**: 지수·뉴스 모두 `<= 타깃월 말일` 상한. 타깃월 = 직전 완료월.
- 신규 인자·옵션은 **선택적·하위호환**(기존 호출부 무변경으로 동작).
- Karpathy 원칙: 요청 범위 외 리팩터 금지, 최소 변경, 기존 스타일 준수.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 날짜 계산은 UTC 기준(`Date.UTC`)으로 로컬 타임존 영향 배제.

---

### Task 1: 월 계산 유틸 `report-month.js`

**Files:**
- Create: `generators/report/lib/report-month.js`
- Test: `generators/report/lib/report-month.test.js`

**Interfaces:**
- Produces:
  - `prevCompletedMonth(today: Date) -> 'YYYY-MM'` — 현재월의 직전 달.
  - `monthEndISO(month: 'YYYY-MM') -> 'YYYY-MM-DD'` — 해당 월 말일.
  - `resolveMonth(argv: string[], today: Date) -> 'YYYY-MM'` — `--month=YYYY-MM` 있으면 그 값, 없으면 `prevCompletedMonth(today)`.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `generators/report/lib/report-month.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prevCompletedMonth, monthEndISO, resolveMonth } = require('./report-month');

test('prevCompletedMonth: 7월 초 실행 → 직전 6월', () => {
  assert.equal(prevCompletedMonth(new Date('2026-07-03T00:00:00Z')), '2026-06');
});

test('prevCompletedMonth: 1월 실행 → 전년 12월로 롤오버', () => {
  assert.equal(prevCompletedMonth(new Date('2026-01-15T00:00:00Z')), '2025-12');
});

test('prevCompletedMonth: 월 첫날 실행도 직전월', () => {
  assert.equal(prevCompletedMonth(new Date('2026-07-01T00:00:00Z')), '2026-06');
});

test('monthEndISO: 6월 → 06-30', () => {
  assert.equal(monthEndISO('2026-06'), '2026-06-30');
});

test('monthEndISO: 2월(윤년 아님) → 02-28', () => {
  assert.equal(monthEndISO('2026-02'), '2026-02-28');
});

test('monthEndISO: 12월 → 12-31', () => {
  assert.equal(monthEndISO('2025-12'), '2025-12-31');
});

test('resolveMonth: --month 오버라이드 우선', () => {
  assert.equal(resolveMonth(['--month=2026-05', 'ocean'], new Date('2026-07-03T00:00:00Z')), '2026-05');
});

test('resolveMonth: --month 없으면 직전 완료월', () => {
  assert.equal(resolveMonth(['--all'], new Date('2026-07-03T00:00:00Z')), '2026-06');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test generators/report/lib/report-month.test.js`
Expected: FAIL — `Cannot find module './report-month'`.

- [ ] **Step 3: 최소 구현 작성**

Create `generators/report/lib/report-month.js`:

```js
'use strict';
// 월간 리포트 대상 월 계산 — 직전 완료월 타깃, 발행월 데이터 배제용 월말일 계산.
// 모든 계산 UTC 기준(로컬 타임존 영향 배제).

function prevCompletedMonth(today) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  d.setUTCDate(0); // 현재월 1일의 하루 전 = 직전월 말일
  return d.toISOString().slice(0, 7);
}

function monthEndISO(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // m(1-indexed)을 0-indexed로 넘기면 다음달, day 0 = 그 달 말일
  return d.toISOString().slice(0, 10);
}

function resolveMonth(argv, today) {
  const arg = argv.find(a => a.startsWith('--month='));
  return arg ? arg.split('=')[1] : prevCompletedMonth(today);
}

module.exports = { prevCompletedMonth, monthEndISO, resolveMonth };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test generators/report/lib/report-month.test.js`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: 커밋**

```bash
git add generators/report/lib/report-month.js generators/report/lib/report-month.test.js
git commit -m "feat(monthly): 직전 완료월·월말일 계산 유틸 (report-month)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 대상 월 타깃팅 배선 (run-section.js + assemble)

**Files:**
- Modify: `generators/report/run-section.js:27-29,37-40`
- Modify: `generators/report/assemble-monthly-report.js:16-18`

**Interfaces:**
- Consumes: `resolveMonth`, `prevCompletedMonth` from `./lib/report-month` (Task 1).
- Produces: 두 스크립트의 기본 `MONTH` = 직전 완료월, `--month=YYYY-MM` 오버라이드 지원. `run-section.js`가 `const MONTH`을 이후 Task 3/5에서 사용.

- [ ] **Step 1: run-section.js — require 추가 및 MONTH 계산 교체**

Modify `generators/report/run-section.js`. 상단 require 블록(파일 상단 `const SECTIONS = require('./sections.config');` 부근)에 추가:

```js
const { resolveMonth, monthEndISO } = require('./lib/report-month');
```

기존 (`:27-29`):

```js
const TODAY   = new Date().toISOString().slice(0, 10);
const MONTH   = TODAY.slice(0, 7);
const OUT_DIR = path.resolve(__dirname, `../../content/monthly-report/${MONTH}`);
```

교체 후:

```js
const TODAY   = new Date().toISOString().slice(0, 10);
const MONTH   = resolveMonth(process.argv.slice(2), new Date());
const OUT_DIR = path.resolve(__dirname, `../../content/monthly-report/${MONTH}`);
```

- [ ] **Step 2: run-section.js — args 파싱에서 --month를 섹션 ID로 오인하지 않도록 보정**

기존 (`:37-40`):

```js
  const args      = process.argv.slice(2);
  const runAll    = args.includes('--all');
  const force     = args.includes('--force');
  const sectionId = args.find(a => !a.startsWith('--'));
```

`sectionId`는 이미 `--`로 시작하는 인자를 제외하므로 `--month=...`는 자동 제외됨 — **변경 불필요**. 확인만 하고 넘어간다(정상 동작 보장).

- [ ] **Step 3: assemble-monthly-report.js — require 추가 및 MONTH 계산 교체**

Modify `generators/report/assemble-monthly-report.js`. 상단 require에 추가:

```js
const { resolveMonth } = require('./lib/report-month');
```

기존 (`:16-18`, 현재 형태):

```js
const TODAY    = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find(a => a.startsWith('--month='));
const MONTH    = monthArg ? monthArg.split('=')[1] : TODAY.slice(0, 7);
```

교체 후:

```js
const TODAY    = new Date().toISOString().slice(0, 10);
const MONTH    = resolveMonth(process.argv.slice(2), new Date());
```

(주의: `monthArg` 지역변수를 제거했으니 파일 내 다른 참조가 없는지 확인 — 없으면 그대로, 있으면 남겨둔다.)

- [ ] **Step 4: 검증 — 타깃 월 계산이 배선됐는지 확인**

Run:
```bash
node -e "const {resolveMonth}=require('./generators/report/lib/report-month'); console.log('default:', resolveMonth([], new Date('2026-07-03T00:00:00Z'))); console.log('override:', resolveMonth(['--month=2026-05'], new Date('2026-07-03T00:00:00Z')));"
```
Expected 출력:
```
default: 2026-06
override: 2026-05
```
그리고 배선 확인:
```bash
grep -n "resolveMonth" generators/report/run-section.js generators/report/assemble-monthly-report.js
```
Expected: 두 파일 모두 require + `MONTH = resolveMonth(...)` 라인이 보임.

- [ ] **Step 5: 커밋**

```bash
git add generators/report/run-section.js generators/report/assemble-monthly-report.js
git commit -m "feat(monthly): 기본 대상 월을 직전 완료월로 (run-section·assemble, --month 오버라이드)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 지수 조회 월말일 상한 (발행월 데이터 배제)

**Files:**
- Modify: `generators/report/lib/ocean-indices.js:31-52,117-128`
- Modify: `generators/report/lib/index-factsheet.js:88-98`
- Modify: `generators/report/lib/intra-asia.js:30-35,155-159`
- Modify: `generators/report/run-section.js` (weekEnd 계산 및 전달)

**Interfaces:**
- Consumes: `monthEndISO` from `./lib/report-month` (Task 1), `MONTH` (Task 2).
- Produces:
  - `buildOceanIndices({ weekEnd } = {}) -> { blocks, factText }` — weekEnd 있으면 freight_indices `week_date <= weekEnd`.
  - `buildIntraAsia({ force, weekEnd } = {}) -> payload | null`.
  - `loadIndexFactsheet({ weekEnd } = {}) -> rows | null`.
  - weekEnd 미전달 시 상한 없음(하위호환).

- [ ] **Step 1: ocean-indices.js — loadGroup에 weekEnd 상한 추가**

Modify `generators/report/lib/ocean-indices.js`. `loadGroup`(현 `:31`)을 weekEnd 파라미터 받도록:

기존:
```js
async function loadGroup(codes) {
  const { data, error } = await sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', codes)
    .order('week_date', { ascending: false })
    .limit(codes.length * 14);   // up to ~12 weeks + buffer per code
```

교체:
```js
async function loadGroup(codes, weekEnd) {
  let q = sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', codes);
  if (weekEnd) q = q.lte('week_date', weekEnd);
  const { data, error } = await q
    .order('week_date', { ascending: false })
    .limit(codes.length * 14);   // up to ~12 weeks + buffer per code
```

- [ ] **Step 2: ocean-indices.js — buildOceanIndices가 weekEnd를 받아 전파**

기존(`:117-128`):
```js
async function buildOceanIndices() {
  const [[kcci, scfi, ccfi, wci, bdi], blankData, intraData] = await Promise.all([
    Promise.all([
      loadGroup(KCCI_ORDER),
      loadGroup(SCFI_ORDER),
      loadGroup(CCFI_ORDER),
      loadGroup(WCI_ORDER),
      loadGroup(BDI_ORDER),
    ]),
    buildBlankSailings(),
    buildIntraAsia(),
  ]);
```

교체:
```js
async function buildOceanIndices({ weekEnd } = {}) {
  const [[kcci, scfi, ccfi, wci, bdi], blankData, intraData] = await Promise.all([
    Promise.all([
      loadGroup(KCCI_ORDER, weekEnd),
      loadGroup(SCFI_ORDER, weekEnd),
      loadGroup(CCFI_ORDER, weekEnd),
      loadGroup(WCI_ORDER, weekEnd),
      loadGroup(BDI_ORDER, weekEnd),
    ]),
    buildBlankSailings(),
    buildIntraAsia({ weekEnd }),
  ]);
```

(주의: `buildBlankSailings()`는 향후 5주 전망(future)이라 상한 미적용 — 그대로 둔다.)

- [ ] **Step 3: intra-asia.js — loadIntraRoutes/buildIntraAsia에 weekEnd 상한**

Modify `generators/report/lib/intra-asia.js`. `loadIntraRoutes`(현 `:30`):

기존:
```js
async function loadIntraRoutes() {
  const { data, error } = await sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', INTRA_CODES)
    .order('week_date', { ascending: false })
    .limit(INTRA_CODES.length * 14);
```

교체:
```js
async function loadIntraRoutes(weekEnd) {
  let q = sb().from('freight_indices')
    .select('index_code,week_date,value')
    .in('index_code', INTRA_CODES);
  if (weekEnd) q = q.lte('week_date', weekEnd);
  const { data, error } = await q
    .order('week_date', { ascending: false })
    .limit(INTRA_CODES.length * 14);
```

`buildIntraAsia`(현 `:155`):

기존:
```js
async function buildIntraAsia({ force = false } = {}) {
```
```js
  const byCode = await loadIntraRoutes();
```

교체:
```js
async function buildIntraAsia({ force = false, weekEnd } = {}) {
```
```js
  const byCode = await loadIntraRoutes(weekEnd);
```

- [ ] **Step 4: index-factsheet.js — loadIndexFactsheet에 weekEnd 상한**

Modify `generators/report/lib/index-factsheet.js`. `loadIndexFactsheet`(현 `:88`):

기존:
```js
async function loadIndexFactsheet() {
  if (!supabase) {
    console.warn('⚠️ Supabase 미설정 — 지표 수치 없이 진행');
    return null;
  }
  const since = new Date(Date.now() - 80 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('freight_indices')
    .select('index_code,value,week_date,change_pct')
    .gte('week_date', since)
    .order('week_date', { ascending: false });
```

교체:
```js
async function loadIndexFactsheet({ weekEnd } = {}) {
  if (!supabase) {
    console.warn('⚠️ Supabase 미설정 — 지표 수치 없이 진행');
    return null;
  }
  const since = new Date(Date.now() - 80 * 86400000).toISOString().slice(0, 10);
  let q = supabase
    .from('freight_indices')
    .select('index_code,value,week_date,change_pct')
    .gte('week_date', since);
  if (weekEnd) q = q.lte('week_date', weekEnd);
  const { data, error } = await q
    .order('week_date', { ascending: false });
```

(주의: `weekly-data.js`가 `loadIndexFactsheet()`를 인자 없이 호출 — weekEnd 미전달로 하위호환 유지됨. 변경 불필요.)

- [ ] **Step 5: run-section.js — weekEnd 계산 후 지수 빌더에 전달**

Modify `generators/report/run-section.js`. `MONTH` 계산 직후(Task 2에서 만든 라인 근처)에 추가:

```js
const WEEK_END = monthEndISO(MONTH);   // 발행월 데이터 배제용 지수 상한
```

`loadIndexFactsheet` 호출(현 `:62`):
기존: `const indexRows  = await loadIndexFactsheet();`
교체: `const indexRows  = await loadIndexFactsheet({ weekEnd: WEEK_END });`

`buildOceanIndices` 호출(현 `:90`):
기존: `const built  = await buildOceanIndices();`
교체: `const built  = await buildOceanIndices({ weekEnd: WEEK_END });`

- [ ] **Step 6: 통합 검증 — 6월 상한 시 7월 데이터 미포함 (Supabase 필요)**

`.env.local`에 Supabase 자격이 있으면 실행. scratch 스크립트 작성:

```bash
cat > /tmp/verify-weekend.js <<'EOF'
const { buildOceanIndices } = require('./generators/report/lib/ocean-indices');
(async () => {
  const weekEnd = '2026-05-31';
  const r = await buildOceanIndices({ weekEnd });
  const weeks = [...r.factText.matchAll(/\((\d{4}-\d{2}-\d{2})\)/g)].map(m => m[1]);
  const bad = weeks.filter(w => w > weekEnd);
  console.log('발견 주차 수:', weeks.length, '| 상한 초과:', bad.length, bad.slice(0, 5));
  if (bad.length) { console.error('FAIL: 상한 초과 주차 존재'); process.exit(1); }
  console.log('PASS: 모든 주차 <= ' + weekEnd);
})();
EOF
node /tmp/verify-weekend.js
```
Expected: `PASS: 모든 주차 <= 2026-05-31`. (Supabase 미설정이면 factText가 비어 weeks=0 → PASS로 통과하되, 콘솔에 "Supabase 데이터 없음" 경고. 이 경우 자격 채워 재확인.)

- [ ] **Step 7: 커밋**

```bash
git add generators/report/lib/ocean-indices.js generators/report/lib/intra-asia.js generators/report/lib/index-factsheet.js generators/report/run-section.js
git commit -m "feat(monthly): 지수 조회에 타깃월 말일 상한 — 발행월 데이터 배제

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `maritime-news-feed.js` — external 원문 로더 + 정규화/랭킹/dedup

**Files:**
- Create: `generators/report/lib/maritime-news-feed.js`
- Test: `generators/report/lib/maritime-news-feed.test.js`

**Interfaces:**
- Produces:
  - `normalizeMaritimeRow(row) -> Item` — `{ title, summary_en, content, source, url, published_at, category: null, section: null }`.
  - `dedupeByUrl(items) -> Item[]` — url 기준 첫 등장 유지(url 없는 항목은 유지).
  - `rankAndCap(items, cap) -> Item[]` — 최신순(published_at desc) 1차 + 분량(summary_en+content 길이) desc 2차, 상위 `cap`개.
  - `loadMaritimeNewsItems({ monthEnd }) -> Promise<Item[]>` — `maritime_news` where `agent_type='external'`, `published_at ∈ [monthEnd−45d, monthEnd]`. env 미설정 시 `[]`.
- Consumes: 없음(런타임에 `@supabase/supabase-js`, `dotenv`).

- [ ] **Step 1: 실패하는 테스트 작성 (순수 함수만)**

Create `generators/report/lib/maritime-news-feed.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMaritimeRow, dedupeByUrl, rankAndCap } = require('./maritime-news-feed');

test('normalizeMaritimeRow: summary→summary_en 매핑, category/section null', () => {
  const row = {
    title: 'Rates surge on Asia-Europe',
    summary: 'Spot rates jumped 12%',
    content: 'Long body text...',
    source: 'The Loadstar',
    url: 'https://x/1',
    published_at: '2026-06-20T00:00:00Z',
    category: '해상',
    agent_type: 'external',
  };
  const it = normalizeMaritimeRow(row);
  assert.equal(it.title, 'Rates surge on Asia-Europe');
  assert.equal(it.summary_en, 'Spot rates jumped 12%');
  assert.equal(it.content, 'Long body text...');
  assert.equal(it.source, 'The Loadstar');
  assert.equal(it.url, 'https://x/1');
  assert.equal(it.published_at, '2026-06-20T00:00:00Z');
  assert.equal(it.category, null);
  assert.equal(it.section, null);
});

test('normalizeMaritimeRow: summary 없으면 summary_en 빈 문자열', () => {
  const it = normalizeMaritimeRow({ title: 'T', url: 'u', source: 's' });
  assert.equal(it.summary_en, '');
  assert.equal(it.content, '');
});

test('dedupeByUrl: 같은 url 첫 등장만 유지', () => {
  const items = [
    { url: 'https://a', title: '1' },
    { url: 'https://a', title: '2' },
    { url: 'https://b', title: '3' },
  ];
  const out = dedupeByUrl(items);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(i => i.title), ['1', '3']);
});

test('dedupeByUrl: url 없는 항목은 모두 유지', () => {
  const items = [{ title: 'x' }, { title: 'y' }];
  assert.equal(dedupeByUrl(items).length, 2);
});

test('rankAndCap: 최신순 정렬 + cap 적용', () => {
  const items = [
    { title: 'old', published_at: '2026-06-01', summary_en: 'aa', content: '' },
    { title: 'new', published_at: '2026-06-25', summary_en: 'a', content: '' },
    { title: 'mid', published_at: '2026-06-10', summary_en: 'a', content: '' },
  ];
  const out = rankAndCap(items, 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(i => i.title), ['new', 'mid']);
});

test('rankAndCap: 동일 날짜면 분량 긴 것 우선', () => {
  const items = [
    { title: 'short', published_at: '2026-06-10', summary_en: 'a', content: '' },
    { title: 'long',  published_at: '2026-06-10', summary_en: 'a', content: 'xxxxxxxxxx' },
  ];
  const out = rankAndCap(items, 2);
  assert.deepEqual(out.map(i => i.title), ['long', 'short']);
});

test('rankAndCap: cap이 항목 수보다 크면 전부 반환', () => {
  const items = [{ title: 'a', published_at: '2026-06-01', summary_en: '', content: '' }];
  assert.equal(rankAndCap(items, 40).length, 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test generators/report/lib/maritime-news-feed.test.js`
Expected: FAIL — `Cannot find module './maritime-news-feed'`.

- [ ] **Step 3: 최소 구현 작성**

Create `generators/report/lib/maritime-news-feed.js`:

```js
'use strict';
// maritime_news(external 원문)를 월간 리포트 아이템 풀로 로드·정규화.
// latest-news.json 아이템과 병합해 뉴스 소스를 확장(발행월 데이터 배제 상한 적용).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { createClient } = require('@supabase/supabase-js');

const LOOKBACK_DAYS = 45;

function normalizeMaritimeRow(row) {
  return {
    title:        row.title || '',
    summary_en:   row.summary || '',
    content:      row.content || '',
    source:       row.source || '',
    url:          row.url || '',
    published_at: row.published_at || null,
    category:     null, // latest-news.json 카테고리 체계와 달라 키워드 매칭 경로로만 분류
    section:      null,
  };
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (it.url) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
    }
    out.push(it);
  }
  return out;
}

function substanceLen(it) {
  return (it.summary_en || '').length + (it.content || '').length;
}

function rankAndCap(items, cap) {
  return [...items]
    .sort((a, b) => {
      const da = a.published_at || '';
      const db = b.published_at || '';
      if (db !== da) return db < da ? -1 : 1;          // 최신순
      return substanceLen(b) - substanceLen(a);         // 동일 날짜: 분량 긴 것 우선
    })
    .slice(0, cap);
}

async function loadMaritimeNewsItems({ monthEnd }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('  maritime-news-feed: Supabase 미설정 — 병합 스킵');
    return [];
  }
  const end   = new Date(`${monthEnd}T23:59:59Z`);
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 86400000);
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from('maritime_news')
    .select('title,summary,content,source,url,category,agent_type,published_at')
    .eq('agent_type', 'external')
    .gte('published_at', start.toISOString())
    .lte('published_at', end.toISOString())
    .order('published_at', { ascending: false })
    .limit(1000);
  if (error) { console.warn('  maritime-news-feed: 조회 실패:', error.message); return []; }
  const items = (data || []).map(normalizeMaritimeRow);
  console.log(`  maritime-news-feed: external ${items.length}건 로드 (${monthEnd} 기준 −${LOOKBACK_DAYS}d)`);
  return items;
}

module.exports = { normalizeMaritimeRow, dedupeByUrl, rankAndCap, loadMaritimeNewsItems };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test generators/report/lib/maritime-news-feed.test.js`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: 통합 검증 — 시간 창 상·하한 (Supabase 필요)**

```bash
cat > /tmp/verify-maritime.js <<'EOF'
const { loadMaritimeNewsItems } = require('./generators/report/lib/maritime-news-feed');
(async () => {
  const monthEnd = '2026-06-30';
  const items = await loadMaritimeNewsItems({ monthEnd });
  console.log('로드:', items.length);
  const over  = items.filter(i => i.published_at && i.published_at.slice(0,10) > monthEnd);
  const under = items.filter(i => {
    if (!i.published_at) return false;
    const lo = new Date(new Date(monthEnd+'T23:59:59Z').getTime() - 45*86400000).toISOString().slice(0,10);
    return i.published_at.slice(0,10) < lo;
  });
  console.log('상한(7월) 초과:', over.length, '| 하한 미달:', under.length);
  if (over.length || under.length) { console.error('FAIL: 시간 창 위반'); process.exit(1); }
  console.log('PASS: 모든 기사 [monthEnd-45d, monthEnd] 이내');
})();
EOF
node /tmp/verify-maritime.js
```
Expected: `PASS: 모든 기사 [monthEnd-45d, monthEnd] 이내` (데이터 있으면 로드>0). Supabase 미설정이면 "병합 스킵" + 로드 0 → PASS.

- [ ] **Step 6: 커밋**

```bash
git add generators/report/lib/maritime-news-feed.js generators/report/lib/maritime-news-feed.test.js
git commit -m "feat(monthly): maritime_news external 원문 로더 + 정규화·dedup·랭킹

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: run-section.js 병합 + 섹션별 랭킹·캡 배선

**Files:**
- Modify: `generators/report/run-section.js:58,84`

**Interfaces:**
- Consumes: `loadMaritimeNewsItems`, `dedupeByUrl`, `rankAndCap` from `./lib/maritime-news-feed` (Task 4); `WEEK_END` (Task 3).
- Produces: 섹션 입력 아이템 = (파일 + maritime_news) dedup 후, 섹션별 `filterItems` → `rankAndCap(…, sec.maxItems ?? DEFAULT_CAP)`.

- [ ] **Step 1: require 및 기본 캡 상수 추가**

Modify `generators/report/run-section.js`. 상단 require에 추가:

```js
const { loadMaritimeNewsItems, dedupeByUrl, rankAndCap } = require('./lib/maritime-news-feed');
```

상수 영역(예: `WEEK_END` 선언 근처)에 추가:

```js
const DEFAULT_MONTHLY_ITEM_CAP = 40;   // ocean/air/rail 등 maxItems 미지정 섹션 상한
```

- [ ] **Step 2: 아이템 풀 병합 (파일 + maritime_news)**

기존(`:58`):
```js
  const allItems   = loadAllMonthlyItems();
```

교체:
```js
  const fileItems  = loadAllMonthlyItems();
  const extraItems = await loadMaritimeNewsItems({ monthEnd: WEEK_END });
  const allItems   = dedupeByUrl([...fileItems, ...extraItems]);
  console.log(`📰 아이템 풀: 파일 ${fileItems.length} + maritime ${extraItems.length} → dedup ${allItems.length}`);
```

- [ ] **Step 3: 섹션별 필터 결과에 랭킹·캡 적용**

기존(`:84`):
```js
    const items = sec.filterItems(allItems);
```

교체:
```js
    const items = rankAndCap(sec.filterItems(allItems), sec.maxItems ?? DEFAULT_MONTHLY_ITEM_CAP);
```

- [ ] **Step 4: 통합 검증 — 병합·캡 동작 (Supabase 필요, LLM 불필요)**

`buildOceanIndices`/`runSection`은 호출하지 않고, 병합·필터·캡 단계만 재현하는 scratch 스크립트로 확인(LLM 비용 0):

```bash
cat > /tmp/verify-merge.js <<'EOF'
const { loadAllMonthlyItems } = require('./generators/report/lib/index-factsheet');
const { loadMaritimeNewsItems, dedupeByUrl, rankAndCap } = require('./generators/report/lib/maritime-news-feed');
const SECTIONS = require('./generators/report/sections.config');
const { monthEndISO } = require('./generators/report/lib/report-month');
const DEFAULT = 40;
(async () => {
  const WEEK_END = monthEndISO('2026-06');
  const fileItems  = loadAllMonthlyItems();
  const extraItems = await loadMaritimeNewsItems({ monthEnd: WEEK_END });
  const allItems   = dedupeByUrl([...fileItems, ...extraItems]);
  console.log(`파일 ${fileItems.length} + maritime ${extraItems.length} → dedup ${allItems.length}`);
  let fail = false;
  for (const sec of SECTIONS) {
    const cap = sec.maxItems ?? DEFAULT;
    const items = rankAndCap(sec.filterItems(allItems), cap);
    const ok = items.length <= cap;
    console.log(`  [${sec.id}] ${items.length}건 (cap ${cap}) ${ok ? 'OK' : 'CAP 초과!'}`);
    if (!ok) fail = true;
  }
  if (fail) { console.error('FAIL'); process.exit(1); }
  console.log('PASS: 모든 섹션 캡 이하, 병합 동작');
})();
EOF
node /tmp/verify-merge.js
```
Expected: 각 섹션 `건수 <= cap`, 마지막 `PASS`. (`latest-news.json`은 리포지토리 `content/drafts/`에 있어야 함 — 없으면 `loadAllMonthlyItems`가 exit(1) 하므로, 없을 경우 `npm run collect:monthly` 선행 또는 파일 존재 확인.)

- [ ] **Step 5: 회귀 — 순수 함수 테스트 전체 통과**

Run: `node --test generators/report/lib/report-month.test.js generators/report/lib/maritime-news-feed.test.js`
Expected: PASS — 15 tests pass (8 + 7).

- [ ] **Step 6: 커밋**

```bash
git add generators/report/run-section.js
git commit -m "feat(monthly): maritime_news 병합 + 섹션별 최신순 랭킹·캡(기본 40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (작성자 체크리스트)

**1. 스펙 커버리지**
- Part 1.1 기본 타깃 월 = 직전 완료월 → Task 1(계산) + Task 2(배선). ✅
- Part 1.1 `--month` 오버라이드(run-section 신규) → Task 1 `resolveMonth` + Task 2. ✅
- Part 1.2 지수 월말일 상한(ocean/index/intra) → Task 3. ✅
- Part 2.1 maritime-news-feed 모듈(external, 45일 창, env 가드, 정규화) → Task 4. ✅
- Part 2.2 run-section 병합 + dedup → Task 5. ✅
- Part 2.3 랭킹·캡(최신+분량, 기본 40) → Task 4(함수) + Task 5(배선). ✅
- 비목표(전망 섹션·한글 큐레이션·LLM 스코어링·collect:monthly 무변경) → 어떤 태스크도 침범 안 함. ✅

**2. 플레이스홀더 스캔**: TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함. ✅

**3. 타입/시그니처 일관성**:
- `monthEndISO`, `resolveMonth` (Task 1) → Task 2/3/5에서 동일 이름 사용. ✅
- `buildOceanIndices({weekEnd})`, `buildIntraAsia({weekEnd})`, `loadIndexFactsheet({weekEnd})` (Task 3) → run-section 호출과 일치. ✅
- `normalizeMaritimeRow`/`dedupeByUrl`/`rankAndCap`/`loadMaritimeNewsItems` (Task 4) → Task 5 import·사용과 일치. ✅
- 아이템 shape(`summary_en`, `published_at`, `content`)이 `sections.config`의 `matches()`/`hasSubstance()`가 읽는 필드와 일치. ✅
