# Logisight 수집기 Supabase 영구 저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4개 기존 수집기(shipping_indices/bunker/blank_sailing/news_global)에 Supabase 영구 저장 추가 — 신규 소스(BDI, EconDB, The Loadstar) 포함 — GitHub Actions 워크플로우 생성

**Architecture:** 공유 `supabase_writer.ts` 유틸리티를 통해 각 collector의 `collect()` 함수 끝에 Supabase upsert를 추가한다. 기존 snapshotWriter(JSON 파일) 경로는 유지하여 backward compat를 보장한다. 환경변수 미설정 시 DB write를 건너뛴다 (graceful degradation). `blank_sailing.ts`는 Playwright/Drewry에서 EconDB JSON API로 교체한다.

**Tech Stack:** TypeScript (ts-node), @supabase/supabase-js (기존 dep), fetch API, GitHub Actions

---

## Phase 0 확인 결과 (이미 완료)

| 파일 | 상태 | 필요 작업 |
|------|------|---------|
| `shipping_indices.ts` | 구현됨 (WCI/FBX/SCFI stub/KCCI stub) | BDI 추가 + Supabase persist |
| `bunker.ts` | 구현됨 (overview 페이지, Global Average만) | per-port 3개 + Supabase persist |
| `blank_sailing.ts` | 구현됨 (Playwright + Drewry) | EconDB JSON API로 교체 + Supabase persist |
| `news_global.ts` | 구현됨 (5개 RSS → JSON 파일) | 2개 피드 추가 + Supabase persist |
| `index.ts` | 구현됨 (고정 그룹, CLI 인수 없음) | CLI group 인수 지원 추가 |

---

## 파일 목록

**신규 생성:**
- `workers/collectors/utils/supabase_writer.ts` — 공유 DB upsert/delete 헬퍼
- `supabase/migrations/20260525000006_freight_indices.sql`
- `supabase/migrations/20260525000007_bunker_prices.sql`
- `supabase/migrations/20260525000008_blank_sailings.sql`
- `supabase/migrations/20260525000009_maritime_news.sql`
- `.github/workflows/market-collectors.yml`

**수정:**
- `workers/collectors/shipping_indices.ts` — BDI fetch + persist
- `workers/collectors/bunker.ts` — per-port + persist
- `workers/collectors/blank_sailing.ts` — EconDB 교체 + persist
- `workers/collectors/news_global.ts` — 피드 추가 + persist
- `workers/collectors/index.ts` — CLI group 인수
- `package.json` — collect:shipping / collect:news 스크립트 수정

---

## Task 1: `supabase_writer.ts` 생성

**Files:**
- Create: `workers/collectors/utils/supabase_writer.ts`

- [ ] **Step 1: 파일 생성**

```typescript
// workers/collectors/utils/supabase_writer.ts
// Shared Supabase write helpers for all collectors.
// Returns silently if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
import { createClient } from '@supabase/supabase-js';

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key);
  return _client;
}

export async function dbUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  if (!rows.length) return;
  const sb = getClient();
  if (!sb) {
    console.warn(`[db] env missing — skipping ${table} upsert (${rows.length} rows)`);
    return;
  }
  const { error } = await sb.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`[db] ${table} upsert failed: ${error.message}`);
  console.log(`[db] ${table} ← ${rows.length} rows upserted`);
}

export async function dbDeleteBefore(
  table: string,
  dateColumn: string,
  cutoffIso: string
): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  const { error } = await sb.from(table).delete().lt(dateColumn, cutoffIso);
  if (error) console.warn(`[db] ${table} delete failed: ${error.message}`);
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --project tsconfig.workers.json --noEmit
```
Expected: 에러 없이 종료

- [ ] **Step 3: 커밋**

```bash
git add workers/collectors/utils/supabase_writer.ts
git commit -m "feat(workers): add shared Supabase writer utility"
```

---

## Task 2: Migration 006 — freight_indices

**Files:**
- Create: `supabase/migrations/20260525000006_freight_indices.sql`

- [ ] **Step 1: SQL 파일 생성**

```sql
-- supabase/migrations/20260525000006_freight_indices.sql
-- 운임 지수 (BDI · WCI · FBX · SCFI · KCCI) 주간 스냅샷

create table if not exists freight_indices (
  id          bigserial primary key,
  index_code  text not null,           -- 'BDI' | 'WCI' | 'FBX' | 'SCFI' | 'KCCI'
  value       double precision,        -- null 허용 (수집 실패 시)
  week_date   date not null,           -- 해당 주 월요일
  change_pct  double precision,        -- 전주 대비 변화율 (null 허용)
  source      text not null,
  source_url  text,
  fetched_at  timestamptz not null default now(),
  unique (index_code, week_date)
);

alter table freight_indices enable row level security;

create policy "anon_read" on freight_indices
  for select to anon using (true);
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260525000006_freight_indices.sql
git commit -m "feat(migrations): 006 freight_indices table"
```

---

## Task 3: Migration 007 — bunker_prices

**Files:**
- Create: `supabase/migrations/20260525000007_bunker_prices.sql`

- [ ] **Step 1: SQL 파일 생성**

```sql
-- supabase/migrations/20260525000007_bunker_prices.sql
-- 벙커유 가격 (VLSFO · IFO380 · MGO — 항구별 일간)

create table if not exists bunker_prices (
  id          bigserial primary key,
  grade       text not null,           -- 'VLSFO' | 'IFO380' | 'MGO'
  port        text not null,           -- 'Singapore' | 'Rotterdam' | 'Fujairah'
  price_usd   double precision,        -- USD/MT. 파싱 실패 시 null
  obs_date    date not null,
  source      text not null default 'Ship & Bunker',
  source_url  text,
  fetched_at  timestamptz not null default now(),
  unique (grade, port, obs_date)
);

alter table bunker_prices enable row level security;

create policy "anon_read" on bunker_prices
  for select to anon using (true);
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260525000007_bunker_prices.sql
git commit -m "feat(migrations): 007 bunker_prices table"
```

---

## Task 4: Migration 008 — blank_sailings + schedule_reliability

**Files:**
- Create: `supabase/migrations/20260525000008_blank_sailings.sql`

- [ ] **Step 1: SQL 파일 생성**

```sql
-- supabase/migrations/20260525000008_blank_sailings.sql
-- 블랭크 세일링 (지역별 주간) + 정시성 proxy

create table if not exists blank_sailings (
  id           bigserial primary key,
  week_start   date not null,
  region       text not null,          -- 'East Asia' | 'Mediterranean' | ...
  blanked_teu  double precision,
  planned_teu  double precision,
  blank_pct    double precision,       -- blanked/planned * 100 (null 허용)
  source       text not null,
  fetched_at   timestamptz not null default now(),
  unique (week_start, region)
);

-- Schedule Reliability 요약 (blank_pct 역산 proxy)
create table if not exists schedule_reliability (
  week_start   date primary key,
  on_time_pct  double precision,       -- 100 - AVG(blank_pct). proxy 임을 UI에 표시
  data_type    text not null default 'proxy',  -- 'proxy' | 'direct'
  source       text not null,
  fetched_at   timestamptz not null default now()
);

alter table blank_sailings      enable row level security;
alter table schedule_reliability enable row level security;

create policy "anon_read" on blank_sailings
  for select to anon using (true);

create policy "anon_read" on schedule_reliability
  for select to anon using (true);
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260525000008_blank_sailings.sql
git commit -m "feat(migrations): 008 blank_sailings + schedule_reliability"
```

---

## Task 5: Migration 009 — maritime_news

**Files:**
- Create: `supabase/migrations/20260525000009_maritime_news.sql`

- [ ] **Step 1: SQL 파일 생성**

```sql
-- supabase/migrations/20260525000009_maritime_news.sql
-- 글로벌 해운 뉴스 (RSS 수집, 30일 롤링)

create table if not exists maritime_news (
  id           bigserial primary key,
  title        text not null,
  url          text not null unique,
  source       text not null,
  published_at timestamptz,
  summary      text,                   -- description 앞 300자 (HTML 태그 제거)
  lang         text not null default 'en',
  fetched_at   timestamptz not null default now()
);

create index on maritime_news (published_at desc);

alter table maritime_news enable row level security;

create policy "anon_read" on maritime_news
  for select to anon using (true);
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260525000009_maritime_news.sql
git commit -m "feat(migrations): 009 maritime_news table"
```

---

## Task 6: `shipping_indices.ts` — BDI 추가 + Supabase persist

**Files:**
- Modify: `workers/collectors/shipping_indices.ts`

- [ ] **Step 1: 파일 전체 교체**

```typescript
// workers/collectors/shipping_indices.ts
// 컨테이너 운임 지수 수집기 — fetch 기반 (Playwright 미사용)
// 대상: BDI (stooq), WCI (Drewry), FBX (Freightos), SCFI (stub), KCCI (stub)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

interface IndexData {
  name: string;
  value: number | null;
  change_pct: number | null;
  date: string;
  unit: string;
  source: string;
  source_url: string;
  note?: string;
}

const TODAY = new Date().toISOString().slice(0, 10);

// Converts any date string to the Monday of its ISO week (YYYY-MM-DD)
function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();                   // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;      // distance back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── BDI (Baltic Dry Index) — stooq.com 무료 CSV ─────────────────
async function fetchBDI(): Promise<IndexData[]> {
  const url = 'https://stooq.com/q/l/?s=^bdi&f=sd2t2ohlcv&e=csv';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  // Format: Symbol,Date,Open,High,Low,Close,Volume
  //         ^BDI,2026-05-23,1234.00,...,1245.00,0
  const lines = csv.trim().split('\n');
  if (lines.length < 2) throw new Error('BDI CSV: too short');
  const parts = lines[1].split(',');
  const dateStr = parts[1]?.trim();
  const close   = parts[5]?.trim();
  if (!close || close === 'N/D' || !dateStr) throw new Error('BDI: N/D or missing');
  return [{
    name: 'BDI_종합',
    value: parseFloat(close),
    change_pct: null,
    date: dateStr,
    unit: 'point',
    source: 'stooq.com',
    source_url: 'https://stooq.com/q/?s=^bdi',
  }];
}

// ── WCI (Drewry) — 무료 공개 헤드라인 ────────────────────────────
async function fetchWCI(): Promise<IndexData[]> {
  const url = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const valueMatch  = html.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*FEU/i);
  const changeMatch = html.match(/([-+]?\d+(?:\.\d+)?)\s*%/);
  return [{
    name: 'WCI_종합',
    value: valueMatch ? parseFloat(valueMatch[1].replace(/,/g, '')) : null,
    change_pct: changeMatch ? parseFloat(changeMatch[1]) : null,
    date: TODAY,
    unit: '$/FEU',
    source: 'Drewry WCI',
    source_url: url,
  }];
}

// ── FBX (Freightos) — 공개 데이터 ────────────────────────────────
async function fetchFBX(): Promise<IndexData[]> {
  const url = 'https://fbx.freightos.com/';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const match = html.match(/FBX.*?([\d,]+(?:\.\d+)?)/i);
    return [{
      name: 'FBX_글로벌',
      value: match ? parseFloat(match[1].replace(/,/g, '')) : null,
      change_pct: null,
      date: TODAY,
      unit: '$/FEU',
      source: 'Freightos FBX',
      source_url: url,
    }];
  } catch {
    return [{ name: 'FBX_글로벌', value: null, change_pct: null, date: TODAY, unit: '$/FEU', source: 'Freightos FBX', source_url: url }];
  }
}

// ── SCFI / KCCI — 자동 수집 불가 stubs ───────────────────────────
function buildSCFIStub(): IndexData[] {
  console.log('⚠️ SCFI 자동 수집 불가 — Shanghai Shipping Exchange 한국 IP 차단');
  return [{ name: 'SCFI_종합', value: null, change_pct: null, date: TODAY, unit: 'point',
    source: 'Shanghai Shipping Exchange', source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
    note: 'IP 차단 — 수동 입력 필요' }];
}
function buildKCCIStub(): IndexData[] {
  console.log('⚠️ KCCI 자동 수집 불가 — JS 렌더링 사이트');
  return [{ name: 'KCCI_종합', value: null, change_pct: null, date: TODAY, unit: 'point',
    source: 'KOBC', source_url: 'https://www.kobc.or.kr/index/kcci',
    note: 'JS 렌더링 — 수동 입력 필요' }];
}

// ── Supabase 영구 저장 ────────────────────────────────────────────
async function persistFreightIndices(result: CollectorResult): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const d of result.data) {
    const v = d.data_value as IndexData;
    if (v.value == null) continue;                     // null → 저장 안 함
    const code = v.name.split('_')[0];                 // 'BDI_종합' → 'BDI'
    rows.push({
      index_code: code,
      value:      v.value,
      week_date:  toMonday(v.date),
      change_pct: v.change_pct ?? null,
      source:     v.source,
      source_url: v.source_url ?? null,
    });
  }
  await dbUpsert('freight_indices', rows, 'index_code,week_date');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  // Stubs (동기)
  for (const d of [...buildSCFIStub(), ...buildKCCIStub()]) {
    result.data.push({ data_type: 'index', data_key: d.name, data_value: d,
      source: d.source, source_url: d.source_url, is_complete: false, error_message: d.note });
  }

  // BDI + WCI + FBX (병렬 fetch)
  const [bdiRes, wciRes, fbxRes] = await Promise.allSettled([
    rateLimited('https://stooq.com',          () => fetchBDI()),
    rateLimited('https://www.drewry.co.uk',   () => fetchWCI()),
    rateLimited('https://fbx.freightos.com',  () => fetchFBX()),
  ]);

  for (const [label, res] of [['BDI', bdiRes], ['WCI', wciRes], ['FBX', fbxRes]] as const) {
    if (res.status === 'rejected') {
      console.log(`⚠️ ${label} 실패: ${(res.reason as Error).message}`);
      continue;
    }
    for (const d of res.value as IndexData[]) {
      result.data.push({ data_type: 'index', data_key: d.name, data_value: d,
        source: d.source, source_url: d.source_url, is_complete: d.value !== null,
        error_message: d.value === null ? '데이터 파싱 실패' : undefined });
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ shipping_indices: ${success}/${result.data.length}개 수집 완료`);

  // Supabase persist (에러가 발생해도 snapshotWriter 경로는 영향 없음)
  await persistFreightIndices(result).catch(e =>
    console.warn('[freight_indices] Supabase persist skipped:', (e as Error).message)
  );

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --project tsconfig.workers.json --noEmit
```
Expected: 에러 없음

- [ ] **Step 3: BDI 수집 확인 (Supabase 없이)**

```bash
npx ts-node --project tsconfig.workers.json workers/collectors/shipping_indices.ts
```
Expected 출력:
```
⚠️ SCFI 자동 수집 불가 ...
⚠️ KCCI 자동 수집 불가 ...
✅ shipping_indices: 1/4개 수집 완료   ← BDI 최소 1개 (WCI/FBX는 가변)
[db] env missing — skipping freight_indices upsert ...
```

- [ ] **Step 4: 커밋**

```bash
git add workers/collectors/shipping_indices.ts
git commit -m "feat(collectors): shipping_indices — add BDI (stooq) + freight_indices upsert"
```

---

## Task 7: `bunker.ts` — per-port + Supabase persist

**Files:**
- Modify: `workers/collectors/bunker.ts`

- [ ] **Step 1: 파일 전체 교체**

```typescript
// workers/collectors/bunker.ts
// 벙커유 가격 수집기 — Ship & Bunker 항구별 페이지 fetch + regex 파싱
// 대상: Singapore · Rotterdam · Fujairah (VLSFO · IFO380 · MGO)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const PORTS = [
  { port: 'Singapore', url: 'https://shipandbunker.com/prices/apac/sg/sg-sin-singapore' },
  { port: 'Rotterdam',  url: 'https://shipandbunker.com/prices/emea/nwe/nl-rtm-rotterdam' },
  { port: 'Fujairah',   url: 'https://shipandbunker.com/prices/me/uae/ae-fuj-fujairah' },
] as const;

// Fuel grade patterns: capture first 3-4 digit number after the grade label.
// Prices are typically 200-1500 USD/MT — sanity-checked below.
const FUEL_PATTERNS = [
  { grade: 'VLSFO',  re: /VLSFO[\s\S]{0,300}?(\d{3,4}(?:\.\d{1,2})?)/i },
  { grade: 'IFO380', re: /IFO[\s-]?380[\s\S]{0,300}?(\d{3,4}(?:\.\d{1,2})?)/i },
  { grade: 'MGO',    re: /\bMGO\b[\s\S]{0,300}?(\d{3,4}(?:\.\d{1,2})?)/i },
] as const;

interface BunkerRow {
  grade: string;
  port:  string;
  priceUsd: number | null;
  url:   string;
}

async function fetchPortPrices(port: string, url: string): Promise<BunkerRow[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)', Accept: 'text/html' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  return FUEL_PATTERNS.map(({ grade, re }) => {
    const m = html.match(re);
    const raw = m ? parseFloat(m[1]) : null;
    // Sanity check: bunker prices are 200–1500 USD/MT
    const valid = raw != null && raw >= 200 && raw <= 1500;
    return { grade, port, priceUsd: valid ? raw : null, url };
  });
}

async function persistBunkerPrices(rows: BunkerRow[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const dbRows = rows
    .filter(r => r.priceUsd != null)
    .map(r => ({
      grade:      r.grade,
      port:       r.port,
      price_usd:  r.priceUsd,
      obs_date:   today,
      source:     'Ship & Bunker',
      source_url: r.url,
    }));
  await dbUpsert('bunker_prices', dbRows, 'grade,port,obs_date');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const allRows: BunkerRow[] = [];

  for (const { port, url } of PORTS) {
    try {
      const rows = await rateLimited(url, () => fetchPortPrices(port, url));
      allRows.push(...rows);
      for (const r of rows) {
        result.data.push({
          data_type:  'bunker',
          data_key:   `BUNKER_${r.grade}_${r.port.toUpperCase()}`,
          data_value: { ...r, date: new Date().toISOString().slice(0, 10),
                        source: 'Ship & Bunker', source_url: r.url },
          source:     'Ship & Bunker',
          source_url: r.url,
          is_complete: r.priceUsd !== null,
          error_message: r.priceUsd === null ? '가격 파싱 실패' : undefined,
        });
      }
      const ok = rows.filter(r => r.priceUsd !== null).length;
      console.log(`✅ bunker [${port}]: ${ok}/${rows.length}개 수집`);
    } catch (e) {
      console.warn(`⚠️ bunker [${port}] 실패: ${(e as Error).message}`);
      for (const { grade } of FUEL_PATTERNS) {
        result.data.push({
          data_type: 'bunker', data_key: `BUNKER_${grade}_${port.toUpperCase()}`,
          data_value: {}, source: 'Ship & Bunker', source_url: url,
          is_complete: false, error_message: (e as Error).message,
        });
      }
    }
  }

  await persistBunkerPrices(allRows).catch(e =>
    console.warn('[bunker_prices] Supabase persist skipped:', (e as Error).message)
  );

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ bunker: ${success}/${result.data.length}개 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
```

- [ ] **Step 2: 컴파일 + 실행 확인**

```bash
npx tsc --project tsconfig.workers.json --noEmit
npx ts-node --project tsconfig.workers.json workers/collectors/bunker.ts
```
Expected: 각 항구 로그 출력, 파싱 실패 시 `가격 파싱 실패` warn (크래시 없음)

- [ ] **Step 3: 커밋**

```bash
git add workers/collectors/bunker.ts
git commit -m "feat(collectors): bunker — per-port Ship&Bunker + bunker_prices upsert"
```

---

## Task 8: `blank_sailing.ts` — EconDB 교체 + Supabase persist

**Files:**
- Modify: `workers/collectors/blank_sailing.ts`

- [ ] **Step 1: 파일 전체 교체 (Playwright 제거, EconDB JSON API 사용)**

```typescript
// workers/collectors/blank_sailing.ts
// 블랭크 세일링 수집기 — EconDB omissions-time-series JSON API
// 이전 구현 (Playwright + Drewry) 대체: EconDB가 무료 JSON 제공, Playwright 불필요

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const ECONDB_BASE = 'https://www.econdb.com/widgets/omissions-time-series/data/';

const REGIONS = [
  'East Asia',
  'Mediterranean',
  'Northwest Europe',
  'Indian Subcontinent',
  'Middle East',
  'North America East',
  'North America West',
] as const;

interface EconRow {
  week_start:  string;
  region:      string;
  blanked_teu: number | null;
  planned_teu: number | null;
  blank_pct:   number | null;
}

async function fetchEconDB(region: string): Promise<EconRow[]> {
  const url = `${ECONDB_BASE}?region=${encodeURIComponent(region)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as {
    plots?: Array<{ data: Array<Record<string, unknown>> }>
  };
  const items = data?.plots?.[0]?.data ?? [];
  return items.map((item) => {
    const blanked = (item['Blanked capacity'] as number | null) ?? null;
    const planned = (item['Actual capacity']  as number | null) ?? null;
    const blank_pct =
      blanked != null && planned != null && planned > 0
        ? Math.round(blanked / planned * 10000) / 100
        : null;
    return {
      week_start: String(item['Date']),
      region,
      blanked_teu: blanked,
      planned_teu: planned,
      blank_pct,
    };
  });
}

async function persistBlankSailings(allRows: EconRow[]): Promise<void> {
  if (!allRows.length) return;

  // blank_sailings
  await dbUpsert(
    'blank_sailings',
    allRows.map(r => ({
      week_start: r.week_start, region: r.region,
      blanked_teu: r.blanked_teu, planned_teu: r.planned_teu,
      blank_pct: r.blank_pct, source: 'EconDB',
    })),
    'week_start,region'
  );

  // schedule_reliability proxy: average blank_pct per week across all regions
  const byWeek = new Map<string, number[]>();
  for (const r of allRows) {
    if (r.blank_pct == null) continue;
    if (!byWeek.has(r.week_start)) byWeek.set(r.week_start, []);
    byWeek.get(r.week_start)!.push(r.blank_pct);
  }
  const srRows: Record<string, unknown>[] = [];
  for (const [week_start, pcts] of byWeek) {
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    srRows.push({
      week_start,
      on_time_pct: Math.round((100 - avg) * 100) / 100,
      data_type: 'proxy',
      source: 'EconDB (proxy)',
    });
  }
  await dbUpsert('schedule_reliability', srRows, 'week_start');
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const allRows: EconRow[] = [];

  for (const region of REGIONS) {
    try {
      const rows = await rateLimited(ECONDB_BASE, () => fetchEconDB(region));
      allRows.push(...rows);
      const latest = rows.at(-1);
      result.data.push({
        data_type:  'blank_sailing',
        data_key:   `BLANK_${region.replace(/ /g, '_').toUpperCase()}`,
        data_value: {
          region, weeks_fetched: rows.length,
          latest_blank_pct: latest?.blank_pct ?? null,
          latest_week: latest?.week_start ?? null,
          source: 'EconDB',
          source_url: `${ECONDB_BASE}?region=${encodeURIComponent(region)}`,
        },
        source:     'EconDB',
        source_url: `${ECONDB_BASE}?region=${encodeURIComponent(region)}`,
        is_complete: rows.length > 0,
        error_message: rows.length === 0 ? '데이터 없음' : undefined,
      });
      console.log(`✅ blank_sailing [${region}]: ${rows.length}주 수집 (latest blank_pct: ${latest?.blank_pct ?? 'n/a'}%)`);
    } catch (e) {
      console.warn(`⚠️ blank_sailing [${region}] 실패: ${(e as Error).message}`);
      result.data.push({
        data_type: 'blank_sailing',
        data_key:  `BLANK_${region.replace(/ /g, '_').toUpperCase()}`,
        data_value: {}, source: 'EconDB',
        source_url: `${ECONDB_BASE}?region=${encodeURIComponent(region)}`,
        is_complete: false, error_message: (e as Error).message,
      });
    }
  }

  await persistBlankSailings(allRows).catch(e =>
    console.warn('[blank_sailings] Supabase persist skipped:', (e as Error).message)
  );

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ blank_sailing: ${success}/${result.data.length}개 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
```

- [ ] **Step 2: 컴파일 + 실행 확인**

```bash
npx tsc --project tsconfig.workers.json --noEmit
npx ts-node --project tsconfig.workers.json workers/collectors/blank_sailing.ts
```
Expected: 7개 지역 로그 출력, 각 지역 `X주 수집` 또는 warn (Playwright 의존성 오류 없음)

- [ ] **Step 3: 커밋**

```bash
git add workers/collectors/blank_sailing.ts
git commit -m "feat(collectors): blank_sailing — replace Playwright with EconDB JSON API + DB persist"
```

---

## Task 9: `news_global.ts` — 피드 2개 추가 + Supabase persist

**Files:**
- Modify: `workers/collectors/news_global.ts`

- [ ] **Step 1: SOURCES에 The Loadstar · Splash247 추가, persistMaritimeNews 함수 추가**

현재 `news_global.ts`의 수정 포인트:
1. `SOURCES` 배열 끝에 2개 피드 추가
2. `import { dbUpsert, dbDeleteBefore }` 추가
3. `persistMaritimeNews(result)` 함수 추가
4. `collect()` 함수 끝에 `await persistMaritimeNews(result)` 호출 추가

수정 후 완전한 파일:

```typescript
// workers/collectors/news_global.ts
// 글로벌 물류 뉴스 수집기
// 대상: FreightWaves, AirCargoNews, SupplyChainDive, TTNews, CNBC, The Loadstar, Splash247

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert, dbDeleteBefore } from './utils/supabase_writer';
import type { CollectorResult, NewsItem } from './types';

const SOURCES = [
  { name: 'CNBC Logistics',  rss: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',  section: 'air'      as const, language: 'en' },
  { name: 'AirCargoNews',    rss: 'https://www.aircargonews.net/feed/',                       section: 'air'      as const, language: 'en' },
  { name: 'SupplyChainDive', rss: 'https://www.supplychaindive.com/feeds/news/',              section: 'trade'    as const, language: 'en' },
  { name: 'TTNews',          rss: 'https://www.ttnews.com/rss.xml',                           section: 'trade'    as const, language: 'en' },
  { name: 'FreightWaves',    rss: 'https://www.freightwaves.com/feed',                        section: 'shipping' as const, language: 'en' },
  // 신규 추가
  { name: 'The Loadstar',    rss: 'https://theloadstar.com/feed/',                            section: 'shipping' as const, language: 'en' },
  { name: 'Splash247',       rss: 'https://splash247.com/feed/',                              section: 'shipping' as const, language: 'en' },
];

async function parseRssFeed(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const link  = block.match(/<link>(.*?)<\/link>/)?.[1]
      || block.match(/<guid>(.*?)<\/guid>/)?.[1]   || '';
    const pubDate     = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const description = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
      || block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
    if (title && link) {
      items.push({
        title:       title.trim(),
        url:         link.trim(),
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        summary_en:  description.replace(/<[^>]*>/g, '').slice(0, 300).trim(),
        source:      '',
      });
    }
    if (items.length >= 5) break;
  }
  return items;
}

// Supabase 영구 저장 + 30일 이전 정리
async function persistMaritimeNews(result: CollectorResult): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const d of result.data) {
    if (!d.is_complete) continue;
    const v = d.data_value as NewsItem & { section: string; language: string };
    if (!v.url) continue;
    rows.push({
      title:        (v.title       ?? '').slice(0, 500),
      url:          v.url,
      source:       v.source,
      published_at: v.published_at ?? null,
      summary:      (v.summary_en  ?? '').slice(0, 300),
      lang:         v.language     ?? 'en',
    });
  }
  await dbUpsert('maritime_news', rows, 'url');

  // 30일 롤링 정리
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await dbDeleteBefore('maritime_news', 'published_at', cutoff);
}

async function runStandalone() {
  const result = await collect();
  await snapshotWriter(result);
}

if (require.main === module) {
  runStandalone().catch(err => { console.error(err); process.exit(1); });
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  for (const source of SOURCES) {
    try {
      const items = await rateLimited(source.rss, () => parseRssFeed(source.rss));
      for (const item of items) {
        result.data.push({
          data_type: 'news',
          data_key:  `${source.name}_${Date.now()}`,
          data_value: { ...item, source: source.name, section: source.section, language: source.language },
          source:     source.name,
          source_url: source.rss,
          is_complete: true,
        });
      }
      console.log(`✅ ${source.name}: ${items.length}건 수집`);
    } catch (error) {
      console.error(`❌ ${source.name} 수집 실패:`, (error as Error).message);
      result.data.push({
        data_type: 'news', data_key: `${source.name}_error`, data_value: {},
        source: source.name, source_url: source.rss, is_complete: false,
        error_message: (error as Error).message,
      });
    }
  }

  await persistMaritimeNews(result).catch(e =>
    console.warn('[maritime_news] Supabase persist skipped:', (e as Error).message)
  );

  return result;
}
```

- [ ] **Step 2: 컴파일 + 실행 확인**

```bash
npx tsc --project tsconfig.workers.json --noEmit
npx ts-node --project tsconfig.workers.json workers/collectors/news_global.ts
```
Expected:
```
✅ CNBC Logistics: 5건 수집
❌ AirCargoNews 수집 실패: HTTP 403 ...   ← 정상 (Cloudflare 차단)
✅ SupplyChainDive: 5건 수집
...
✅ The Loadstar: 5건 수집
✅ Splash247: 5건 수집
[db] env missing — skipping maritime_news upsert ...
```

- [ ] **Step 3: 커밋**

```bash
git add workers/collectors/news_global.ts
git commit -m "feat(collectors): news_global — add Loadstar/Splash247 + maritime_news upsert"
```

---

## Task 10: `index.ts` — CLI group 인수 지원

**Files:**
- Modify: `workers/collectors/index.ts`

- [ ] **Step 1: `main()` 상단에 CLI 인수 파싱 추가**

현재 파일의 `main()` 함수 내 `const summary` 선언 바로 앞에 추가:

```typescript
// 변경 전 main() 첫 줄:
async function main() {
  const startTime = Date.now();
  console.log('🚀 Logisight 데이터 수집 시작\n');

// 변경 후:
const GROUP_MAP: Record<string, string> = {
  shipping: '운임 지수',
  news:     '뉴스',
  rail:     '철도',
  policy:   '정책',
};

async function main() {
  const groupArg   = process.argv[2];
  const targetName = groupArg ? GROUP_MAP[groupArg] : undefined;

  if (groupArg && !targetName) {
    console.error(`❌ 알 수 없는 그룹: "${groupArg}". 가능한 값: ${Object.keys(GROUP_MAP).join(', ')}, all`);
    process.exit(1);
  }

  const activeGroups = targetName ? GROUPS.filter(g => g.name === targetName) : GROUPS;

  const startTime = Date.now();
  console.log(`🚀 Logisight 데이터 수집 시작 (group: ${groupArg ?? 'all'})\n`);
```

그리고 이후 `for (const group of GROUPS)` → `for (const group of activeGroups)` 로 변경.

완전한 수정 후 `index.ts`:

```typescript
// workers/collectors/index.ts
// 마스터 dispatcher — 모든 collector 순차/병렬 실행
// 사용법: ts-node index.ts [all|shipping|news|rail|policy]

import { collect as collectShipping }    from './shipping_indices';
import { collect as collectBunker }      from './bunker';
import { collect as collectAir }         from './air_indices';
import { collect as collectBlankSailing } from './blank_sailing';
import { collect as collectNewsGlobal }  from './news_global';
import { collect as collectNewsKorea }   from './news_korea';
import { collect as collectNewsRail }    from './news_rail';
import { collect as collectNewsIndustry } from './news_industry';
import { collect as collectPolicyUS }    from './policy_us';
import { collect as collectPolicyEU }    from './policy_eu';
import { collect as collectPolicyIMO }   from './policy_imo';
import { collect as collectRailTCR }     from './rail_tcr';
import { collect as collectRailTSR }     from './rail_tsr';
import { snapshotWriter }                from './utils/snapshot_writer';
import type { CollectorResult }          from './types';

const GROUPS = [
  {
    name: '운임 지수',
    collectors: [
      { name: 'shipping_indices', fn: collectShipping },
      { name: 'bunker',           fn: collectBunker },
      { name: 'air_indices',      fn: collectAir },
      { name: 'blank_sailing',    fn: collectBlankSailing },
    ],
  },
  {
    name: '뉴스',
    collectors: [
      { name: 'news_global',   fn: collectNewsGlobal },
      { name: 'news_korea',    fn: collectNewsKorea },
      { name: 'news_rail',     fn: collectNewsRail },
      { name: 'news_industry', fn: collectNewsIndustry },
    ],
  },
  {
    name: '철도',
    collectors: [
      { name: 'rail_tcr', fn: collectRailTCR },
      { name: 'rail_tsr', fn: collectRailTSR },
    ],
  },
  {
    name: '정책',
    collectors: [
      { name: 'policy_us',  fn: collectPolicyUS },
      { name: 'policy_eu',  fn: collectPolicyEU },
      { name: 'policy_imo', fn: collectPolicyIMO },
    ],
  },
];

const GROUP_MAP: Record<string, string> = {
  shipping: '운임 지수',
  news:     '뉴스',
  rail:     '철도',
  policy:   '정책',
};

async function runCollector(name: string, fn: () => Promise<CollectorResult>) {
  console.log(`\n🔄 ${name} 수집 시작...`);
  try {
    const result = await fn();
    const total   = result.data.length;
    const success = result.data.filter(d => d.is_complete).length;
    const failed  = total - success;
    await snapshotWriter(result);
    console.log(`✅ ${name} 완료: ${success}건 성공 / ${failed}건 실패`);
    return { name, success: true, total, failed };
  } catch (error) {
    console.error(`❌ ${name} 전체 실패:`, (error as Error).message);
    return { name, success: false, total: 0, failed: 1 };
  }
}

async function main() {
  const groupArg   = process.argv[2];
  const targetName = groupArg ? GROUP_MAP[groupArg] : undefined;

  if (groupArg && !targetName) {
    console.error(`❌ 알 수 없는 그룹: "${groupArg}". 가능한 값: ${Object.keys(GROUP_MAP).join(', ')}, all`);
    process.exit(1);
  }

  const activeGroups = targetName ? GROUPS.filter(g => g.name === targetName) : GROUPS;

  const startTime = Date.now();
  console.log(`🚀 Logisight 데이터 수집 시작 (group: ${groupArg ?? 'all'})\n`);
  console.log(`📅 수집 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`);

  const summary: Array<{ name: string; success: boolean; total: number; failed: number }> = [];

  for (const group of activeGroups) {
    console.log(`\n━━━ ${group.name} 그룹 ━━━`);
    const results = await Promise.allSettled(
      group.collectors.map(c => runCollector(c.name, c.fn))
    );
    for (const r of results) {
      summary.push(
        r.status === 'fulfilled'
          ? r.value
          : { name: 'unknown', success: false, total: 0, failed: 1 }
      );
    }
  }

  const elapsed      = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalSuccess = summary.filter(s => s.success).length;
  const totalFailed  = summary.filter(s => !s.success).length;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 수집 완료 요약`);
  console.log(`   성공: ${totalSuccess}개 collector`);
  console.log(`   실패: ${totalFailed}개 collector`);
  console.log(`   소요 시간: ${elapsed}초`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (totalFailed > 0) {
    console.log('⚠️ 실패한 collector:');
    summary.filter(s => !s.success).forEach(s => console.log(`  - ${s.name}`));
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx tsc --project tsconfig.workers.json --noEmit
```
Expected: 에러 없음

- [ ] **Step 3: CLI 인수 동작 확인**

```bash
npx ts-node --project tsconfig.workers.json workers/collectors/index.ts shipping 2>&1 | head -10
```
Expected: `🚀 Logisight 데이터 수집 시작 (group: shipping)`

```bash
npx ts-node --project tsconfig.workers.json workers/collectors/index.ts badarg 2>&1
```
Expected: `❌ 알 수 없는 그룹: "badarg"` + exit 1

- [ ] **Step 4: 커밋**

```bash
git add workers/collectors/index.ts
git commit -m "feat(collectors): index.ts — CLI group argument (shipping|news|rail|policy)"
```

---

## Task 11: `package.json` 스크립트 수정

**Files:**
- Modify: `package.json`

- [ ] **Step 1: collect:shipping / collect:news 스크립트 수정**

현재:
```json
"collect:shipping": "ts-node --project tsconfig.workers.json workers/collectors/shipping_indices.ts",
"collect:news":     "ts-node --project tsconfig.workers.json workers/collectors/news_global.ts",
```

수정 후:
```json
"collect:shipping": "ts-node --project tsconfig.workers.json workers/collectors/index.ts shipping",
"collect:news":     "ts-node --project tsconfig.workers.json workers/collectors/index.ts news",
```

- [ ] **Step 2: 스크립트 동작 확인**

```bash
npm run collect:news 2>&1 | head -20
```
Expected: `🚀 Logisight 데이터 수집 시작 (group: news)` + 뉴스 소스 로그

- [ ] **Step 3: 커밋**

```bash
git add package.json
git commit -m "fix(scripts): collect:shipping/news → index.ts group dispatch"
```

---

## Task 12: GitHub Actions 워크플로우 생성

**Files:**
- Create: `.github/workflows/market-collectors.yml`

- [ ] **Step 1: 워크플로우 파일 생성**

```yaml
# .github/workflows/market-collectors.yml
# 운임 지수 · 벙커 가격 · 블랭크 세일링 · 글로벌 뉴스 수집
# 스케줄: 매주 월요일 02:00 UTC (11:00 KST)
name: Logisight Market Collectors

on:
  schedule:
    - cron: '0 2 * * 1'   # 월요일 02:00 UTC
  workflow_dispatch:        # 수동 실행 허용

jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Collect market data (shipping_indices · bunker · blank_sailing)
        run: npm run collect:shipping
        env:
          SUPABASE_URL:              ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Collect news (news_global · news_korea · news_rail · news_industry)
        run: npm run collect:news
        env:
          SUPABASE_URL:              ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

> 참고: blank_sailing이 Playwright 제거됨 → `playwright install` 스텝 불필요

- [ ] **Step 2: 워크플로우 lint (로컬)**

```bash
# actionlint가 있으면:
# actionlint .github/workflows/market-collectors.yml
# 없으면 YAML 구문 확인
node -e "require('fs').readFileSync('.github/workflows/market-collectors.yml','utf-8'); console.log('YAML syntax OK')"
```

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/market-collectors.yml
git commit -m "feat(ci): market-collectors weekly workflow (Mon 02:00 UTC)"
```

---

## Task 13: 최종 빌드 검증 + Push

- [ ] **Step 1: 전체 TypeScript 컴파일**

```bash
npx tsc --project tsconfig.workers.json --noEmit
npm run build
```
Expected: 에러 없음

- [ ] **Step 2: collect:shipping 통합 실행**

```bash
npm run collect:shipping 2>&1 | tail -20
```
Expected:
```
✅ shipping_indices: X/4개 수집 완료
✅ bunker [Singapore]: X/3개 수집
...
✅ blank_sailing [East Asia]: X주 수집
...
[db] env missing — skipping ... (Supabase 미설정 시)
```
전체 exit code 0 또는 1 (개별 collector warn은 허용)

- [ ] **Step 3: 최종 커밋 + Push**

```bash
git status
git add -A
git commit -m "feat(collectors): 운임지수·벙커가격·결항·뉴스 수집기 + 마이그레이션 006-009"
git push
```

---

## 검증 게이트 체크리스트

| 항목 | 확인 방법 |
|------|---------|
| BDI 수집 | `npx ts-node ... shipping_indices.ts` → `✅ shipping_indices: 1/4` 이상 |
| bunker 크래시 없음 | `npx ts-node ... bunker.ts` → exit 0 (null 허용) |
| blank_sailing Playwright 제거 | `grep -r "playwright" workers/collectors/blank_sailing.ts` → 없음 |
| EconDB 동작 | `npx ts-node ... blank_sailing.ts` → `[East Asia]: X주 수집` |
| news_global 7개 소스 | `grep -c "name:" workers/collectors/news_global.ts` → 7 |
| index.ts group arg | `npm run collect:news 2>&1 | head -1` → `group: news` |
| TS build 통과 | `npm run build` → exit 0 |
| migrations 파일 수 | `ls supabase/migrations/ | wc -l` → 9 |

---

## 가드레일 체크

- [x] 가짜 숫자 금지 — 파싱 실패 시 모두 `null` 저장
- [x] 출처 표시 — 모든 DB 행에 `source` + `source_url` 포함
- [x] 기존 snapshotWriter 경로 유지 (backward compat)
- [x] 2단계 기능 미구현 (Sea-Intelligence, Xeneta 등 없음)
- [x] RLS + anon read policy — 모든 신규 테이블
- [x] `data/samples/` git 포함 금지 (변경 없음)
- [x] 환경변수 미설정 시 graceful skip (`getClient()` null 반환)
