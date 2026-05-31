// collectors/backfill_index_history.ts
// 일회성 지수 이력 적재 — freight_indices에 upsert (index_code+week_date 멱등)
// 사용법: npx tsx collectors/backfill_index_history.ts ./data-import
//   data-import/ 폴더에 다운로드 파일들을 넣고 실행

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SB_URL = process.env.SUPABASE_URL ?? '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// KCCI 파일 컬럼코드 → DB index_code
const KCCI_MAP: Record<string, string> = {
  KCCI: 'KCCI',    KUWI: 'KCCI_USWC', KUEI: 'KCCI_USEC', KNEI: 'KCCI_NEU',
  KMDI: 'KCCI_MED', KMEI: 'KCCI_ME',  KAUI: 'KCCI_AU',   KLEI: 'KCCI_SAE',
  KLWI: 'KCCI_SAW', KSAI: 'KCCI_ZAF', KWAI: 'KCCI_WAF',  KCI:  'KCCI_CN',
  KJI:  'KCCI_JP',  KSEI: 'KCCI_SEA',
};
// KCCI_USWC=미주서안 KCCI_USEC=미주동안 KCCI_NEU=북유럽 KCCI_MED=지중해
// KCCI_ME=중동 KCCI_AU=호주 KCCI_SAE=남미동안 KCCI_SAW=남미서안
// KCCI_ZAF=남아프리카 KCCI_WAF=서아프리카 KCCI_CN=중국 KCCI_JP=일본 KCCI_SEA=동남아

const WCI_MAP: Record<string, string> = {
  'WCI Composite Index':     'WCI',
  'Shanghai - Rotterdam':    'WCI_SHA_RTM',
  'Shanghai - Genoa':        'WCI_SHA_GOA',
  'Shanghai - Los Angeles':  'WCI_SHA_LAX',
  'Shanghai - New York':     'WCI_SHA_NYC',
};

function toMonday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return x.toISOString().slice(0, 10);
}

function toDate(v: any): Date | null {
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0, 10) + 'T00:00:00Z');
  return null;
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

const rows: any[] = [];
const push = (code: string, week: string, value: number | null, source: string) => {
  if (value != null) rows.push({ index_code: code, value, week_date: week, change_pct: null, source });
};

function ingestKCCI(file: string) {
  const wb = XLSX.readFile(file);
  const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const hi = aoa.findIndex(r => r.some((c: any) => String(c).trim() === 'DATE'));
  if (hi < 0) { console.warn('KCCI 헤더 못찾음'); return; }
  const hdr = aoa[hi].map((c: any) => String(c).trim());
  const dCol = hdr.indexOf('DATE');
  let cnt = 0;
  for (const r of aoa.slice(hi + 1)) {
    const d = toDate(r[dCol]);
    if (!d) continue;
    const wk = toMonday(d);
    cnt++;
    hdr.forEach((h, i) => { if (KCCI_MAP[h]) push(KCCI_MAP[h], wk, num(r[i]), 'KOBC KCCI'); });
  }
  console.log(`KCCI: ${cnt}주 × 14계열`);
}

function ingestComposite(file: string, code: string) {
  const wb = XLSX.readFile(file);
  const arr: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const byWeek: Record<string, { d: Date; v: number }> = {};
  for (const o of arr) {
    const d = toDate(o['Date']);
    const v = num(o['Index Value']);
    if (!d || v == null) continue;
    const wk = toMonday(d);
    if (!byWeek[wk] || d > byWeek[wk].d) byWeek[wk] = { d, v };  // 주간 리샘플(최신일 유지)
  }
  Object.entries(byWeek).forEach(([wk, { v }]) => push(code, wk, v, `${code} history`));
  console.log(`${code}: ${Object.keys(byWeek).length}주`);
}

function ingestWCI(file: string) {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets['Monthly_Data'] || wb.Sheets[wb.SheetNames[0]];
  const arr: any[] = XLSX.utils.sheet_to_json(sheet);
  let cnt = 0;
  for (const o of arr) {
    const m = String(o['Month'] || '').trim();
    if (!/^\d{4}-\d{2}/.test(m)) continue;
    const wk = toMonday(new Date(m.slice(0, 7) + '-01T00:00:00Z'));
    Object.entries(WCI_MAP).forEach(([col, code]) => push(code, wk, num(o[col]), 'Drewry WCI'));
    cnt++;
  }
  console.log(`WCI: ${cnt}개월 × 5계열`);
}

async function upsert() {
  if (!SB_URL || !SB_KEY) { console.error('env 없음'); process.exit(1); }
  const url = `${SB_URL}/rest/v1/freight_indices?on_conflict=index_code,week_date`;
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) console.error('upsert 실패', res.status, await res.text());
    else console.log(`  upsert ${chunk.length}행`);
  }
}

async function main() {
  const dir = process.argv[2] || './data-import';
  if (!fs.existsSync(dir)) { console.error(`폴더 없음: ${dir}`); process.exit(1); }

  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (/KCCI|KOBC_CONTAINER/i.test(f))  ingestKCCI(p);
    else if (/^SCFI_Data_all/i.test(f))  ingestComposite(p, 'SCFI');
    else if (/^CCFI_Data_all/i.test(f))  ingestComposite(p, 'CCFI');
    else if (/^BDI_Data_all/i.test(f))   ingestComposite(p, 'BDI');
    else if (/WCI/i.test(f))             ingestWCI(p);
    else                                  console.log('스킵(미인식):', f);
  }

  console.log(`\n총 ${rows.length}행 upsert 시작...`);
  await upsert();
  console.log('✅ 백필 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
