// collectors/news_browser.ts
// 봇 차단(Cloudflare/403) RSS 소스를 Playwright로 수집(requiresBrowser=true).
// 홈페이지로 Cloudflare 챌린지 해소 → in-page fetch로 피드 XML 취득(쿠키 동반) → 파싱.
// 415/실패 시 홈페이지 기사 링크 HTML 폴백(예: Baltic).
// 로컬은 시스템 Chrome(channel:'chrome'), CI는 번들 chromium으로 폴백.
import { chromium, type Browser } from 'playwright';
import { snapshotWriter } from './utils/snapshot_writer';
import { enrichNewsItem, parseFeedXml, persistCollectedNews } from './utils/news_enrichment';
import { NEWS_SOURCES } from './news_sources';
import type { CollectorResult, NewsItem } from './types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function launch(): Promise<Browser> {
  try { return await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { return await chromium.launch({ headless: true }); }   // CI: 번들 chromium
}

function homeOf(u: string): string { const x = new URL(u); return `${x.protocol}//${x.host}/`; }

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const sources = NEWS_SOURCES.filter((s) => s.requiresBrowser);
  if (!sources.length) return result;

  const browser = await launch();
  try {
    for (const source of sources) {
      const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
      const page = await ctx.newPage();
      let items: NewsItem[] = [];
      try {
        await page.goto(homeOf(source.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(6000);   // Cloudflare JS 챌린지 해소 대기

        // 1) in-page fetch로 피드 XML(쿠키 동반)
        const xml = await page.evaluate(async (u) => {
          try { const r = await fetch(u); return r.ok ? await r.text() : ''; } catch { return ''; }
        }, source.url);
        if (xml && xml.includes('<item')) items = parseFeedXml(xml, source);

        // 2) 폴백: 홈페이지 기사 링크 스크랩(RSS 거부 사이트용 — 예: Baltic 415)
        if (!items.length) {
          const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a'))
              .map((a) => ({ t: (a.textContent || '').replace(/\s+/g, ' ').trim(), h: (a as HTMLAnchorElement).href }))
              .filter((x) => x.t.length >= 12 && x.t.length <= 140 && /^https?:/.test(x.h) && !/\/(tag|category|author)\//i.test(x.h)),
          );
          const seen = new Set<string>();
          for (const l of links) {
            if (seen.has(l.t)) continue; seen.add(l.t);
            items.push({ title: l.t, url: l.h, published_at: new Date().toISOString(), summary_en: '', source: source.name });
            if (items.length >= 15) break;
          }
        }
        console.log(`✅ ${source.name}: ${items.length}건 (browser)`);
      } catch (e) {
        console.error(`❌ ${source.name} browser 실패:`, (e as Error).message);
      }
      await ctx.close();

      const enriched = await Promise.all(items.map(enrichNewsItem));
      for (const item of enriched) {
        result.data.push({
          data_type: 'news',
          data_key: `${source.name}_${item.url}`,
          data_value: { ...item, section: source.section, language: source.language },
          source: source.name,
          source_url: source.url,
          is_complete: true,
        });
      }
    }
  } finally {
    await browser.close();
  }

  if (process.env.DRY) {
    console.log(`[DRY] persist 생략 — 총 ${result.data.length}건`);
  } else {
    await persistCollectedNews(result).catch((e) =>
      console.warn('[maritime_news] persist skipped:', (e as Error).message));
  }
  return result;
}

if (require.main === module) {
  collect().then(snapshotWriter).catch((e) => { console.error(e); process.exit(1); });
}
