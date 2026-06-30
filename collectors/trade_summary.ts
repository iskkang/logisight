// collectors/trade_summary.ts
// 산업별/무역 사전집계 — trade_statistics(원본)를 읽어 trade_summary(요약)에 적재한다.
// 프론트가 방문마다 stat_type='item' 전수(1만+행)를 받아 클라이언트에서 집계하던 13초 병목 제거용.
// 차원: 기준월 × (HS 챕터 | 국가 | 전체). 측정: 금액·물량·수지. 결측은 0이 아니라 NULL(결측≠0).
//
// 실행:
//   npx tsx collectors/trade_summary.ts                 # 전체 기준월 재집계
//   npx tsx collectors/trade_summary.ts --period=2026-05 # 한 기준월만(테스트·증분)
// 안전: --all/--force 없음. 기간 미지정이면 원본에 존재하는 기준월만 처리(임의 생성 안 함).

import fs from 'fs';
import path from 'path';
import ws from 'ws';
// @ts-ignore — Node 20 lacks a native WebSocket
globalThis.WebSocket = ws as never;

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// .env.local 로드 (로컬 실행 시; CI는 환경변수 주입이라 덮어쓰지 않음)
function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvLocal();

type ItemRow = {
  period: string;
  hs_code: string | null;
  country_code: string | null;
  country_name: string | null;
  export_usd: number | null;
  export_weight: number | null;
  import_usd: number | null;
  import_weight: number | null;
};

type SummaryRow = {
  period: string;
  dim_type: 'hs_chapter' | 'country' | 'total';
  dim_key: string;
  dim_label: string | null;
  export_usd: number | null;
  import_usd: number | null;
  export_weight: number | null;
  import_weight: number | null;
  trade_balance: number | null;
  row_count: number;
};

const MEASURES = ['export_usd', 'import_usd', 'export_weight', 'import_weight'] as const;
type Measure = (typeof MEASURES)[number];

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function parsePeriodArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--period='));
  if (!arg) return null;
  const raw = arg.slice('--period='.length).replace(/[^0-9]/g, '');
  if (raw.length < 6) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`; // 원본 기준월 표기 'YYYY-MM'
}

// 누산기 — 측정값별 합계 + 비결측 기여 카운트. 비결측 0이면 합계는 NULL(결측≠0).
class Acc {
  rows = 0;
  private sum: Record<Measure, number> = { export_usd: 0, import_usd: 0, export_weight: 0, import_weight: 0 };
  private have: Record<Measure, number> = { export_usd: 0, import_usd: 0, export_weight: 0, import_weight: 0 };
  add(r: ItemRow) {
    this.rows += 1;
    for (const m of MEASURES) {
      const v = r[m];
      if (v != null && Number.isFinite(v)) { this.sum[m] += v; this.have[m] += 1; }
    }
  }
  val(m: Measure): number | null {
    return this.have[m] > 0 ? this.sum[m] : null;
  }
  balance(): number | null {
    const e = this.val('export_usd');
    const i = this.val('import_usd');
    return e != null && i != null ? e - i : null;
  }
}

function toSummaryRow(period: string, dim_type: SummaryRow['dim_type'], dim_key: string, dim_label: string | null, a: Acc): SummaryRow {
  return {
    period, dim_type, dim_key, dim_label,
    export_usd: a.val('export_usd'),
    import_usd: a.val('import_usd'),
    export_weight: a.val('export_weight'),
    import_weight: a.val('import_weight'),
    trade_balance: a.balance(),
    row_count: a.rows,
  };
}

// 한 기준월의 stat_type='item' 전수를 페이지네이션으로 읽는다(원본 페이징 한도 1000 우회).
async function readItemRows(sb: SupabaseClient, period: string): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from('trade_statistics')
      .select('period,hs_code,country_code,country_name,export_usd,export_weight,import_usd,import_weight')
      .eq('stat_type', 'item')
      .eq('period', period)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`read item(${period}): ${error.message}`);
    const rows = (data ?? []) as ItemRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    if (from > 100000) break; // 안전 상한
  }
  return out;
}

async function readCountryRows(sb: SupabaseClient, period: string): Promise<ItemRow[]> {
  const { data, error } = await sb
    .from('trade_statistics')
    .select('period,hs_code,country_code,country_name,export_usd,export_weight,import_usd,import_weight')
    .eq('stat_type', 'country')
    .eq('period', period);
  if (error) throw new Error(`read country(${period}): ${error.message}`);
  return (data ?? []) as ItemRow[];
}

function buildSummary(period: string, items: ItemRow[], countries: ItemRow[]): SummaryRow[] {
  const rows: SummaryRow[] = [];

  // HS 챕터(2자리) 롤업 + 전체 — stat_type='item' 기준.
  const byChapter = new Map<string, Acc>();
  const total = new Acc();
  for (const r of items) {
    total.add(r);
    const ch = r.hs_code && r.hs_code.length >= 2 ? r.hs_code.slice(0, 2) : null;
    if (!ch) continue; // hs_code 결측 행은 챕터 집계에서 제외(전체에는 포함)
    let a = byChapter.get(ch);
    if (!a) { a = new Acc(); byChapter.set(ch, a); }
    a.add(r);
  }
  for (const [ch, a] of [...byChapter.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    rows.push(toSummaryRow(period, 'hs_chapter', ch, null, a)); // 챕터명은 프론트가 매핑
  }
  if (items.length > 0) rows.push(toSummaryRow(period, 'total', 'ALL', '전체', total));

  // 국가 차원 — stat_type='country'(이미 국가 총교역) 그대로 차원화.
  for (const c of countries) {
    if (!c.country_code) continue;
    const a = new Acc();
    a.add(c);
    rows.push(toSummaryRow(period, 'country', c.country_code, c.country_name ?? null, a));
  }
  return rows;
}

// 기준월 단위 delete-then-insert(요약 갱신). 기간 격리 — 한 달 실패가 다른 달에 번지지 않게.
async function persistPeriod(sb: SupabaseClient, period: string, rows: SummaryRow[]): Promise<void> {
  const { error: delErr } = await sb.from('trade_summary').delete().eq('period', period);
  if (delErr) throw new Error(`delete summary(${period}): ${delErr.message}`);
  if (rows.length === 0) { console.log(`  [${period}] 요약 0행(원본 없음) — 스킵`); return; }
  const { error: insErr } = await sb.from('trade_summary').insert(rows as never[]);
  if (insErr) throw new Error(`insert summary(${period}): ${insErr.message}`);
}

async function distinctPeriods(sb: SupabaseClient): Promise<string[]> {
  const set = new Set<string>();
  for (const st of ['item', 'country']) {
    const { data, error } = await sb.from('trade_statistics').select('period').eq('stat_type', st);
    if (error) throw new Error(`distinct periods(${st}): ${error.message}`);
    for (const r of (data ?? []) as { period: string }[]) if (r.period) set.add(r.period);
  }
  return [...set].sort();
}

async function main() {
  const sb = getSupabase();
  if (!sb) { console.error('[trade_summary] SUPABASE_URL/SERVICE_ROLE_KEY 미설정 — 중단'); process.exit(1); }

  const only = parsePeriodArg();
  const periods = only ? [only] : await distinctPeriods(sb);
  console.log(`[trade_summary] 대상 기준월: ${periods.join(', ') || '(없음)'}`);

  let ok = 0;
  const failures: string[] = [];
  for (const period of periods) {
    try {
      const [items, countries] = [await readItemRows(sb, period), await readCountryRows(sb, period)];
      const rows = buildSummary(period, items, countries);
      await persistPeriod(sb, period, rows);
      const ch = rows.filter((r) => r.dim_type === 'hs_chapter').length;
      const co = rows.filter((r) => r.dim_type === 'country').length;
      console.log(`  ✅ ${period}: item ${items.length}행 → 요약 ${rows.length}행(챕터 ${ch}·국가 ${co}·전체 ${rows.some((r) => r.dim_type === 'total') ? 1 : 0})`);
      ok += 1;
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`  ⚠️ ${period} 실패: ${msg}`);
      failures.push(`${period}: ${msg}`); // 기간 격리 — 계속 진행
    }
  }

  console.log(`\n[trade_summary] 완료 ${ok}/${periods.length} 기준월` + (failures.length ? ` · 실패 ${failures.length}` : ''));
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => { console.error('[trade_summary] 치명적 오류:', (e as Error).message); process.exit(1); });
