# Portwatch Diversion Auto-Collect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual Drewry Red Sea diversion admin input with automated weekly collection from IMF Portwatch public API.

**Architecture:** A new `portwatch-diversion.js` module fetches Suez Canal daily container transit counts from the IMF Portwatch ArcGIS REST API, computes `cape_share_pct` as the deviation from a pre-crisis 2023 baseline, and upserts into the existing `red_sea_diversion` table. All downstream code (`diversion.js`, `buildDiversion`, generation pipeline) is unchanged. The old manual-check workflow is replaced by a new automated collect+check workflow.

**Tech Stack:** Node.js 22, `fetch` (built-in), Supabase JS client, GitHub Actions, ArcGIS REST API (IMF Portwatch — public, no auth)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `generators/web/forecast/inputs/portwatch-diversion.js` | API fetch + cape_share_pct calculation |
| Create | `generators/web/forecast/inputs/portwatch-diversion.test.js` | Unit tests for pure functions |
| Create | `generators/web/forecast/persist-diversion.js` | Orchestrator: fetch → Supabase upsert |
| Replace | `.github/workflows/forecast-diversion-check.yml` | Weekly automated collect + freshness check |
| Modify | `package.json` | Add `forecast:diversion` script |

**Unchanged:** `diversion.js`, `check-diversion.js`, `red_sea_diversion` table schema, `forecast-drewry.yml`

---

## Task 1: portwatch-diversion.js — pure functions + API client

**Files:**
- Create: `generators/web/forecast/inputs/portwatch-diversion.js`

- [ ] **Step 1.1: Write the file**

```js
'use strict';
// T1-1 replacement: IMF Portwatch 수에즈 운하 일별 컨테이너 통과 수 → cape_share_pct.
// 출처: https://portwatch.imf.org/ (공개 ArcGIS REST API, 인증 불필요)
// red_sea_diversion 테이블 호환 — diversion.js / buildDiversion 변경 없음.

const PORTWATCH_URL =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const SUEZ_ID = 'chokepoint1';
// 2023-01-01 ~ 2023-10-31 평균 일별 컨테이너 통과 수 (Red Sea 위기 이전).
// 산출: IMF Portwatch API 304일 평균 = 19.84 (일회성 쿼리, 상수 고정)
const SUEZ_BASELINE = 19.8;
const SOURCE = 'IMF Portwatch (auto)';
const UA = 'Mozilla/5.0 (compatible; logisight-diversion/1.0)';

// rows: [{date:'YYYY-MM-DD', n_container:number}], baseline: number
// 최근 7일 평균으로 cape_share_pct 계산.
// 반환: {cape_share_pct, suez_share_pct, as_of, current_avg, baseline, source} | null
function buildCapeShare(rows, baseline) {
  const b = baseline ?? SUEZ_BASELINE;
  const valid = (rows || []).filter(
    (r) => r.n_container != null && Number.isFinite(r.n_container) && r.n_container >= 0,
  );
  if (!valid.length || !b) return null;
  const sorted = [...valid].sort((a, b_) => (a.date < b_.date ? 1 : -1)); // desc
  const recent = sorted.slice(0, 7);
  const avg = recent.reduce((s, r) => s + r.n_container, 0) / recent.length;
  const deviation = (b - avg) / b;
  const cape = Math.round(Math.max(0, Math.min(100, deviation * 100)));
  return {
    cape_share_pct: cape,
    suez_share_pct: Math.max(0, 100 - cape),
    as_of: sorted[0].date,
    current_avg: Math.round(avg * 10) / 10,
    baseline: b,
    source: SOURCE,
  };
}

// daysBack일치 수에즈 일별 데이터 조회.
// ArcGIS REST는 date를 Unix 밀리초(epoch ms)로 반환.
async function fetchPortwatchTransits(daysBack = 14) {
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    where: `portid='${SUEZ_ID}' AND date >= TIMESTAMP '${since} 00:00:00'`,
    outFields: 'date,n_container',
    f: 'json',
    resultRecordCount: '50',
    orderByFields: 'date DESC',
  });
  const res = await fetch(`${PORTWATCH_URL}?${params}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json?.features ?? [])
    .map((f) => ({
      date: new Date(f.attributes.date).toISOString().slice(0, 10),
      n_container: f.attributes.n_container,
    }))
    .filter((r) => r.date && r.n_container != null);
}

// 합성: fetch → build. 실패 시 null (더미 금지).
async function fetchAndBuildDiversion() {
  try {
    const rows = await fetchPortwatchTransits(14);
    if (!rows.length) return null;
    return buildCapeShare(rows);
  } catch (e) {
    console.warn('  portwatch-diversion: 실패 —', e.message);
    return null;
  }
}

module.exports = { buildCapeShare, fetchPortwatchTransits, fetchAndBuildDiversion, SUEZ_BASELINE, SOURCE };
```

---

## Task 2: portwatch-diversion.test.js — unit tests

**Files:**
- Create: `generators/web/forecast/inputs/portwatch-diversion.test.js`

- [ ] **Step 2.1: Write tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCapeShare, SUEZ_BASELINE, SOURCE } = require('./portwatch-diversion');

const B = 19.8; // test baseline

test('buildCapeShare: 정상 — deviation 50% → cape 50', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-06-0${i + 1}`,
    n_container: B / 2, // 9.9
  }));
  const r = buildCapeShare(rows, B);
  assert.ok(r);
  assert.equal(r.cape_share_pct, 50);
  assert.equal(r.suez_share_pct, 50);
  assert.equal(r.source, SOURCE);
  assert.equal(r.as_of, '2026-06-07');
});

test('buildCapeShare: current >= baseline → cape 0 (우회 없음)', () => {
  const rows = [{ date: '2026-06-01', n_container: 30 }]; // > baseline
  const r = buildCapeShare(rows, B);
  assert.equal(r.cape_share_pct, 0);
  assert.equal(r.suez_share_pct, 100);
});

test('buildCapeShare: n_container = 0 → cape 100 (완전 우회)', () => {
  const rows = [{ date: '2026-06-01', n_container: 0 }];
  const r = buildCapeShare(rows, B);
  assert.equal(r.cape_share_pct, 100);
  assert.equal(r.suez_share_pct, 0);
});

test('buildCapeShare: n_container null 행 제외', () => {
  const rows = [
    { date: '2026-06-02', n_container: null },
    { date: '2026-06-01', n_container: 10 },
  ];
  const r = buildCapeShare(rows, B);
  assert.ok(r);
  assert.equal(r.current_avg, 10);
});

test('buildCapeShare: 빈 rows → null', () => {
  assert.equal(buildCapeShare([], B), null);
});

test('buildCapeShare: as_of은 최신 날짜', () => {
  const rows = [
    { date: '2026-06-01', n_container: 10 },
    { date: '2026-06-03', n_container: 8 },
    { date: '2026-06-02', n_container: 9 },
  ];
  const r = buildCapeShare(rows, B);
  assert.equal(r.as_of, '2026-06-03');
});

test('buildCapeShare: 8일 중 최신 7일만 평균', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({
      date: `2026-06-0${i + 2}`, // Jun 2-8
      n_container: 0,
    })),
    { date: '2026-06-01', n_container: B * 10 }, // oldest — excluded
  ];
  const r = buildCapeShare(rows, B);
  assert.equal(r.cape_share_pct, 100); // oldest excluded → avg stays 0
});

test('buildCapeShare: baseline 기본값 = SUEZ_BASELINE', () => {
  const rows = [{ date: '2026-06-01', n_container: SUEZ_BASELINE / 2 }];
  const r = buildCapeShare(rows);
  assert.equal(r.cape_share_pct, 50);
  assert.equal(r.baseline, SUEZ_BASELINE);
});

test('SUEZ_BASELINE: 양수 숫자', () => {
  assert.equal(typeof SUEZ_BASELINE, 'number');
  assert.ok(SUEZ_BASELINE > 0);
});
```

- [ ] **Step 2.2: Run tests (expect pass)**

```
node --test generators/web/forecast/inputs/portwatch-diversion.test.js
```

Expected: all 9 tests pass.

- [ ] **Step 2.3: Commit**

```bash
git add generators/web/forecast/inputs/portwatch-diversion.js generators/web/forecast/inputs/portwatch-diversion.test.js
git commit -m "feat(forecast): portwatch-diversion — IMF Portwatch cape_share_pct 계산"
```

---

## Task 3: persist-diversion.js — Supabase upsert orchestrator

**Files:**
- Create: `generators/web/forecast/persist-diversion.js`

- [ ] **Step 3.1: Write the file**

```js
'use strict';
// IMF Portwatch → red_sea_diversion 테이블 upsert.
// 실행: node generators/web/forecast/persist-diversion.js (또는 npm run forecast:diversion)
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }

const { fetchAndBuildDiversion } = require('./inputs/portwatch-diversion');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE 환경변수 없음');
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, realtime: { enabled: false },
  });
  const d = await fetchAndBuildDiversion();
  if (!d) {
    console.error('❌ diversion: IMF Portwatch 데이터 미수집');
    process.exit(1);
  }
  const row = {
    as_of: d.as_of,
    cape_share_pct: d.cape_share_pct,
    suez_share_pct: d.suez_share_pct,
    source: d.source,
    note: `avg ${d.current_avg}/day vs baseline ${d.baseline}/day`,
  };
  const { error } = await sb.from('red_sea_diversion').upsert(row, { onConflict: 'as_of' });
  if (error) {
    console.error('❌ diversion upsert 실패:', error.message);
    process.exit(1);
  }
  console.log(
    `✅ diversion 적재: ${d.as_of} 케이프 ${d.cape_share_pct}% (avg ${d.current_avg} vs baseline ${d.baseline})`,
  );
}

main().catch((e) => { console.error('diversion persist 실패:', e.message); process.exit(1); });
```

- [ ] **Step 3.2: Add npm script to package.json**

`package.json`의 `"scripts"` 블록에 추가 (기존 `"forecast:iata-fuel"` 줄 아래):

```json
"forecast:diversion": "node generators/web/forecast/persist-diversion.js",
```

- [ ] **Step 3.3: Smoke test (Supabase 연결 필요)**

```
node generators/web/forecast/persist-diversion.js
```

Expected output (예시):
```
✅ diversion 적재: 2026-06-08 케이프 57% (avg 8.6 vs baseline 19.8)
```

이어서 freshness check 통과 확인:
```
node generators/web/forecast/check-diversion.js
```

Expected: `✅ red_sea_diversion 최신: ...`

- [ ] **Step 3.4: Commit**

```bash
git add generators/web/forecast/persist-diversion.js package.json
git commit -m "feat(forecast): persist-diversion — IMF Portwatch → red_sea_diversion upsert"
```

---

## Task 4: Replace forecast-diversion-check.yml with automated workflow

**Files:**
- Replace: `.github/workflows/forecast-diversion-check.yml`

- [ ] **Step 4.1: Overwrite the workflow file**

`.github/workflows/forecast-diversion-check.yml`을 아래 내용으로 교체:

```yaml
name: Forecast — Weekly Red Sea Diversion Collect

# 주간 자동 수집: IMF Portwatch 수에즈 통과량 → red_sea_diversion upsert.
# 기존 Drewry 수동 입력 대체. check-diversion.js가 적재 확인(안전망).
on:
  schedule:
    - cron: '0 4 * * 2'   # 매주 화요일 04:00 UTC (IMF Portwatch 주간 갱신 이후)
  workflow_dispatch:

jobs:
  diversion-collect:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Collect & persist Red Sea diversion
        run: node generators/web/forecast/persist-diversion.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      - name: Check freshness (safety net)
        run: node generators/web/forecast/check-diversion.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 4.2: Commit**

```bash
git add .github/workflows/forecast-diversion-check.yml
git commit -m "feat(workflow): diversion-collect — Drewry 수동 체크 → IMF Portwatch 주간 자동화"
```

---

## Task 5: Run full test suite

- [ ] **Step 5.1: Run forecast test suite**

```
node --test generators/web/forecast/
```

Expected: 기존 테스트 전체 통과 + portwatch-diversion 9개 신규 통과.

- [ ] **Step 5.2: Final commit if needed**

```bash
git add -p
git commit -m "test(forecast): portwatch-diversion 전체 테스트 통과 확인"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `portwatch-diversion.js` 생성 (Task 1)
- ✅ `persist-diversion.js` 생성 (Task 3)
- ✅ `red_sea_diversion` 테이블 스키마 변경 없음 (persist에서 기존 컬럼만 사용)
- ✅ `forecast-diversion-check.yml` 교체 (Task 4)
- ✅ `package.json` 스크립트 추가 (Task 3.2)
- ✅ `forecast-drewry.yml` 변경 없음 (Blank Sailing — 별도 기능)
- ✅ 기존 `diversion.js`, `check-diversion.js` 변경 없음

**Placeholder scan:** 없음 — 모든 코드 블록 완성.

**Type consistency:**
- `buildCapeShare` → 테스트·persist 모두 동일 시그니처
- `fetchAndBuildDiversion` 반환값의 `cape_share_pct`, `suez_share_pct`, `as_of`, `source`, `current_avg`, `baseline` 필드 → persist에서 동일하게 참조
- `SUEZ_BASELINE` → 테스트에서 import 후 사용
