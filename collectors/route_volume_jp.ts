// collectors/route_volume_jp.ts
// 航路別コンテナ荷動き — 日本海事センター(JPMAC) → jp_route_volume.
//
// 일본판 리포트가 정직하게 남겨둔 마지막 결손이었다. 港湾統計은 일본 항구의 TEU를
// 주지만 "어느 항로로 갔는가"는 말해주지 않는다. JPMAC은 항로 단위로 낸다 —
// 2026년 6월 북미 왕항에서 日本 53,701TEU(▲3.2%)인 반면 中国은 954,767TEU(+25.5%)다.
// 화주가 "우리 화물이 줄고 있나"를 묻는 자리에 답할 수 있는 유일한 축이다.
//
// ■ 형식
// HTML 표가 없다. 개요가 PDF로만 나온다. robots.txt는 MJ12bot만 막고 * 제한은 없다.
// 게시 페이지에서 「概要」PDF 링크를 찾아 텍스트를 뽑는다.
// PDF 파일명이 타임스탬프라 회차마다 바뀐다 — 링크를 고정하지 않고 매번 찾는다.
//
// ■ 표만 믿지 않는다
// 표의 숫자는 구분자 없이 붙어 나온다. 형식이 조금만 바뀌어도 조용히 틀린 값이
// 나올 수 있다(Drewry 파서가 실제로 3주간 그랬다). 산문의 합계와 대조해서
// 어긋나면 그 회차를 저장하지 않는다.
//
// 실행: npx tsx collectors/route_volume_jp.ts [--dry-run]

import * as path from 'path';
import * as dotenv from 'dotenv';

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseNorthAmerica, parseEurope } = require('./utils/jpmac_pdf') as {
  parseNorthAmerica: (t: string) => ParsedOverview | null;
  parseEurope: (t: string) => ParsedOverview | null;
};

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://www.jpmac.or.jp';

type Row = { name: string; teu: number; yoyPct: number; sharePct: number; cumTeu: number; cumYoyPct: number };
type ParsedOverview = {
  header: { year: number; month: number; directions: string[]; publishedAt: string | null };
  rows: Row[];
  prose: { yoyPct: number; manTeu: number } | null;
  check: { ok: boolean; reason?: string };
};

export const TRADES = [
  {
    key: 'north_america',
    page: `${BASE}/relation/north_american/`,
    source: '日本海事センター 北米コンテナ航路(PIERSデータを基に作成)',
    parse: parseNorthAmerica,
  },
  {
    key: 'europe',
    page: `${BASE}/relation/european/`,
    source: '日本海事センター 欧州コンテナ航路(Container Trades Statisticsを基に作成)',
    parse: parseEurope,
  },
];

/**
 * 행의 성격. 합산할 때 섞으면 두 배가 된다.
 *
 * 「合計」「計」로 끝나면 묶음이다. 첫 행은 전체 합계다.
 * 유럽은 애초에 지역 행만 나온다 — 국가로 잘못 넣으면 일본이 있는 것처럼 보인다.
 */
export function scopeOf(name: string, index: number, tradeKey: string): 'total' | 'region' | 'country' {
  if (index === 0) return 'total';
  if (tradeKey === 'europe') return 'region';
  return /(合計|計)$/.test(name.trim()) ? 'region' : 'country';
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fetchPdfText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return (await pdfParse(buf)).text;
}

/** 게시 페이지에서 첫 「概要」PDF 링크. 파일명이 회차마다 바뀌어 고정할 수 없다. */
export function findOverviewPdf(html: string): string | null {
  for (const m of html.matchAll(/<a[^>]+href="([^"]*\.pdf)"[^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (label.includes('概要')) return m[1].startsWith('http') ? m[1] : BASE + m[1];
  }
  return null;
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const dbRows: Record<string, unknown>[] = [];

  for (const trade of TRADES) {
    try {
      const html = await rateLimited(trade.page, () => fetchText(trade.page));
      const pdfUrl = findOverviewPdf(html);
      if (!pdfUrl) { console.error(`❌ ${trade.key}: 概要 PDF 링크를 못 찾음`); continue; }

      const text = await rateLimited(pdfUrl, () => fetchPdfText(pdfUrl));
      const parsed = trade.parse(text);
      if (!parsed) { console.error(`❌ ${trade.key}: 개요 형식이 다름 — 건너뜀`); continue; }

      // 표와 산문이 어긋나면 저장하지 않는다. 틀린 수를 넣느니 비는 편이 낫다.
      if (!parsed.check.ok) {
        console.error(`❌ ${trade.key}: 표·본문 대조 실패 — ${parsed.check.reason}`);
        continue;
      }

      const { year, month, directions, publishedAt } = parsed.header;
      // 「往航/復航」이 함께 적혀도 개요의 표는 왕항분이다. 방향을 섞지 않는다.
      const direction = directions[0] || '往航';

      parsed.rows.forEach((r, i) => {
        dbRows.push({
          trade: trade.key,
          direction,
          year,
          month,
          scope: scopeOf(r.name, i, trade.key),
          name: r.name,
          teu: r.teu,
          yoy_pct: r.yoyPct,
          share_pct: r.sharePct,
          cum_teu: r.cumTeu,
          cum_yoy_pct: r.cumYoyPct,
          source: trade.source,
          source_url: trade.page,
          published_at: publishedAt,
          fetched_at: new Date().toISOString(),
        });
      });

      const jp = parsed.rows.find((r) => r.name === '日本');
      console.log(
        `✅ ${trade.key}: ${year}-${String(month).padStart(2, '0')} ${direction} ${parsed.rows.length}행`
        + (jp ? ` (日本 ${jp.teu.toLocaleString()}TEU ${jp.yoyPct > 0 ? '+' : ''}${jp.yoyPct}%)` : ' (일본 단독 수치 없음 — 지역별만)'),
      );
      result.data.push({
        source: trade.source,
        source_url: trade.page,
        data_value: { trade: trade.key, period: `${year}-${String(month).padStart(2, '0')}`, rows: parsed.rows.length },
      } as never);
    } catch (e) {
      console.error(`❌ ${trade.key}: ${(e as Error).message}`);
    }
  }

  if (dbRows.length > 0 && !process.argv.includes('--dry-run')) {
    await dbUpsert('jp_route_volume', dbRows, 'trade,direction,year,month,name');
  }
  console.log(`📊 ${dbRows.length}행${process.argv.includes('--dry-run') ? ' (DRY RUN — 저장 안 함)' : ''}`);
  return result;
}

if (require.main === module) {
  collect().catch((e) => { console.error('route_volume_jp 실패:', e.message); process.exit(1); });
}
