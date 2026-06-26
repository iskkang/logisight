// collectors/erai.ts
// index1520(UTLC ERA) ERAI 지수 — 유라시아 철도 운임 컴포지트(USD/FEU, 월별) → freight_indices.
// 대상: ERAI Composite/East/West (+ 철도 transit time). /en/index/quotes/ 정적 표 + /en/index/ 정적 값 파싱.
// freight_index_excel.ts 패턴(HTML→freight_indices upsert) 재사용. 매크로 위젯(Phase 6-C)용.
import * as cheerio from 'cheerio';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const QUOTES_URL = 'https://index1520.com/en/index/quotes/';
const INDEX_URL = 'https://index1520.com/en/index/';
const BOT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ERAI 표 행 이름 → freight_indices.index_code
const CODE_MAP: Record<string, string> = {
  'ERAI Composite': 'ERAI',
  'ERAI East': 'ERAI_EAST',
  'ERAI West': 'ERAI_WEST',
};
const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

const clean = (s: string) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
// "3 697,00" → 3697.00 (공백 천단위, 콤마 소수)
function parseNum(raw: string): number | null {
  const s = (raw || '').replace(/[\s ]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const dbRows: Record<string, unknown>[] = [];

  // 1) ERAI Composite/East/West — /en/index/quotes/ 표
  try {
    const html = await rateLimited(QUOTES_URL, () => fetchText(QUOTES_URL));
    const $ = cheerio.load(html);
    $('table.table tbody tr').each((_, tr) => {
      const cells = $(tr).find('td,th').map((__, c) => clean($(c).text())).get();
      const name = cells[0];
      const code = CODE_MAP[name];
      if (!code) return;
      const big = cells[1] || ''; // "ERAI Composite 3 697,00 USD May 2026 +1,54%"
      const vm = big.match(/([\d][\d\s ]*,\d{2})\s*USD/);
      const value = vm ? parseNum(vm[1]) : null;
      const pm = big.match(/USD\s+([A-Za-z]+)\s+(\d{4})/);
      const mm = pm ? MONTHS[pm[1].toLowerCase()] : null;
      const weekDate = pm && mm ? `${pm[2]}-${mm}-01` : null;
      const change = parseNum((cells[2] || '').replace('%', '')); // "May" 컬럼 = 최신월 변화
      if (value == null || !weekDate) return;
      dbRows.push({
        index_code: code, value, week_date: weekDate,
        change_pct: change, source: 'index1520 ERAI', source_url: QUOTES_URL,
      });
      result.data.push({
        data_type: 'index', data_key: `ERAI_${code}_${weekDate}`,
        data_value: { name: code, value, date: weekDate, change_pct: change, source: 'index1520 ERAI', source_url: QUOTES_URL },
        source: 'index1520 ERAI', source_url: QUOTES_URL, is_complete: true,
      });
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`⚠️ ERAI quotes 수집 실패: ${msg}`);
    result.data.push({ data_type: 'index', data_key: 'ERAI_error', data_value: {}, source: 'index1520 ERAI', source_url: QUOTES_URL, is_complete: false, error_message: msg });
  }

  // 2) 철도 transit time(현재값, 일) — /en/index/ 정적 div.days
  try {
    const html = await rateLimited(INDEX_URL, () => fetchText(INDEX_URL));
    const m = html.match(/class="days">\s*([\d.,]+)\s*days/i);
    const days = m ? parseNum(m[1]) : null;
    if (days != null) {
      const now = new Date();
      const weekDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
      dbRows.push({ index_code: 'ERAI_TRANSIT_DAYS', value: days, week_date: weekDate, change_pct: null, source: 'index1520 ERAI', source_url: INDEX_URL });
      result.data.push({ data_type: 'index', data_key: `ERAI_TRANSIT_${weekDate}`, data_value: { name: 'ERAI_TRANSIT_DAYS', value: days, date: weekDate, source: 'index1520 ERAI', source_url: INDEX_URL }, source: 'index1520 ERAI', source_url: INDEX_URL, is_complete: true });
    }
  } catch (err) {
    console.warn(`⚠️ ERAI transit time 수집 실패: ${(err as Error).message}`);
  }

  const success = result.data.filter((d) => d.is_complete).length;
  console.log(`✅ erai (index1520): ${success}건, freight_indices upsert 예정 ${dbRows.length}행`);
  await dbUpsert('freight_indices', dbRows, 'index_code,week_date').catch((e) =>
    console.warn('[freight_indices] ERAI persist 실패:', (e as Error).message));

  return result;
}

if (require.main === module) {
  collect().then((r) => snapshotWriter(r)).catch(console.error);
}
