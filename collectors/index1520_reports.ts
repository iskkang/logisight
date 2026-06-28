// index1520(UTLC ERA) Analytics 격주 리포트("Eurasian logistics market update") 수집.
// 목록(type=2) HTML 스크래핑 → 각 리포트 본문은 fetchArticleBody로 추출(검증: ~2500자).
// 결과: ① index1520_reports 테이블 upsert(영구 저장) ② monthly-report 철도 섹션 소스(monthly_source, deep_analysis).
// 출처표기 의무: 본문에 ERAI/index1520 포함됨.
import * as cheerio from 'cheerio';

import { dbUpsert } from './utils/supabase_writer';
import { fetchArticleBody } from './utils/article_body';
import type { CollectorResult } from './types';

const BASE = 'https://index1520.com';
const LIST_URL = `${BASE}/en/analytics/?type[]=2`;
const SOURCE_NAME = 'index1520 Analytics';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REPORT_RE = /\/en\/analytics\/[a-z0-9-]{8,}\/?$/;
const MAX_REPORTS = 8;
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export type Listed = { url: string; title: string };

export async function fetchListing(): Promise<Listed[]> {
  const res = await fetch(LIST_URL, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`listing HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const byUrl = new Map<string, Listed>();
  $('a[href*="/en/analytics/"]').each((_, a) => {
    let href = ($(a).attr('href') || '').trim();
    if (!href) return;
    if (href.startsWith('/')) href = BASE + href;
    if (!REPORT_RE.test(href)) return;
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (title.length < 12) return;
    if (!byUrl.has(href)) byUrl.set(href, { url: href, title });
  });
  return [...byUrl.values()].slice(0, MAX_REPORTS);
}

// "Eurasian logistics market update. June 2026, issue 33" → {report_date, issue_no}
function parseMeta(title: string): { report_date: string | null; issue_no: number | null } {
  const m = title.match(/([A-Za-z]+)\s+(\d{4}),\s*issue\s*(\d+)/i);
  if (!m) return { report_date: null, issue_no: null };
  const mo = MONTHS[m[1].toLowerCase()];
  return {
    report_date: mo ? `${m[2]}-${String(mo).padStart(2, '0')}-01` : null,
    issue_no: Number(m[3]) || null,
  };
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };

  let listed: Listed[];
  try {
    listed = await fetchListing();
  } catch (e) {
    console.error('[index1520_reports] 목록 수집 실패:', (e as Error).message);
    return result;
  }

  const rows: Record<string, unknown>[] = [];
  for (const r of listed) {
    let content = '';
    try {
      content = await fetchArticleBody(r.url);
    } catch (e) {
      console.warn(`[index1520_reports] 본문 추출 실패(${r.url}):`, (e as Error).message);
    }
    const { report_date, issue_no } = parseMeta(r.title);
    const summary = content.slice(0, 400);
    const slug = r.url.replace(/\/$/, '').split('/').pop() ?? r.url;

    rows.push({ url: r.url, title: r.title, report_date, issue_no, summary, content, source: 'index1520', source_url: LIST_URL });

    // monthly-report 철도 섹션 소스(deep_analysis). monthly_analysis와 동일 형식 → 동일 파이프라인 사용.
    result.data.push({
      data_type: 'monthly_source',
      data_key: `MONTHLY_deep_analysis_index1520_${issue_no ?? slug}`,
      data_value: {
        title: r.title,
        url: r.url,
        published_at: report_date ? new Date(report_date).toISOString() : new Date().toISOString(),
        summary_en: summary,
        content,
        section: 'rail',
        language: 'en',
        category: 'deep_analysis',
        source: SOURCE_NAME,
      },
      source: SOURCE_NAME,
      source_url: r.url,
      is_complete: content.length > 0,
    });
    console.log(`✅ index1520 리포트: ${r.title} (본문 ${content.length}자)`);
  }

  if (rows.length) {
    await dbUpsert('index1520_reports', rows, 'url').catch((e) =>
      console.warn('[index1520_reports] Supabase upsert 건너뜀:', (e as Error).message),
    );
  }
  console.log(`✅ index1520_reports: ${rows.length}건 수집`);
  return result;
}

if (require.main === module) {
  collect().then((r) => console.log(`\n총 ${r.data.length}건 (monthly_source)`)).catch(console.error);
}
