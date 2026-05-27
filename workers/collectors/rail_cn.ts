// workers/collectors/rail_cn.ts
// 중국어 공식 철도 소스 수집기
// 소스: China Railway, 95306, CRCT, Xi'an, Chengdu, BRI Portal (weekly)
//       Global Times BRI RSS, Xinhua English RSS (daily)

import Anthropic from '@anthropic-ai/sdk';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

// ── 소스 정의 ────────────────────────────────────────────────────
interface CnSource {
  name: string;
  url: string;
  type: 'rss' | 'html';
  frequency: 'daily' | 'weekly';
}

const CN_SOURCES: CnSource[] = [
  { name: 'Global Times BRI',  url: 'https://www.globaltimes.cn/rss/outbrain.xml',                                          type: 'rss',  frequency: 'daily'  },
  { name: 'Xinhua English',    url: 'https://english.news.cn/rss/world.xml',                                                type: 'rss',  frequency: 'daily'  },
  { name: 'China Railway',     url: 'https://www.china-railway.com.cn/xwzx/zhxw/',                                         type: 'html', frequency: 'weekly' },
  { name: '95306',             url: 'https://www.95306.cn/',                                                                type: 'html', frequency: 'weekly' },
  { name: 'CRCT',              url: 'https://www.crct.com/index.php?m=content&c=index&a=lists&catid=34',                    type: 'html', frequency: 'weekly' },
  { name: "Xi'an Chang'an",    url: 'https://www.xaport.net/newabout',                                                     type: 'html', frequency: 'weekly' },
  { name: 'Chengdu Rail',      url: 'https://cdirs.cdiport.com/',                                                          type: 'html', frequency: 'weekly' },
  { name: 'BRI Portal',        url: 'https://www.yidaiyilu.gov.cn/',                                                       type: 'html', frequency: 'weekly' },
];

// ── RSS 파싱 ─────────────────────────────────────────────────────
async function parseRss(src: CnSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, {
    headers: BOT_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = (b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '').trim();
    const link  = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    if (!title || !link) continue;
    items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

// ── HTML 링크 파싱 ───────────────────────────────────────────────
async function fetchHtmlLinks(src: CnSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, {
    headers: BOT_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const base = new URL(src.url).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{6,120})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('javascript') || href.startsWith('#') || href.startsWith('mailto')) continue;
    if (seen.has(title)) continue;
    if (href.startsWith('/')) href = `${base}${href}`;
    if (!href.startsWith('http')) continue;
    seen.add(title);
    items.push({ title, url: href, published_at: new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

// ── Claude 번역 (중국어 제목 배치 처리) ─────────────────────────
interface TranslatedItem {
  title_en: string;
  title_cn: string;
  summary_en: string;
  url: string;
  source: string;
}

async function translateBatch(items: NewsItem[]): Promise<TranslatedItem[]> {
  const chineseItems = items.filter(i => /[一-鿿]/.test(i.title));
  if (chineseItems.length === 0) {
    return items.map(i => ({ title_en: i.title, title_cn: '', summary_en: i.summary_en, url: i.url, source: i.source }));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ ANTHROPIC_API_KEY 미설정 — 번역 스킵');
    return items.map(i => ({ title_en: i.title, title_cn: /[一-鿿]/.test(i.title) ? i.title : '', summary_en: '', url: i.url, source: i.source } as TranslatedItem));
  }

  const client = new Anthropic({ apiKey });
  const inputJson = JSON.stringify(chineseItems.map(i => ({ title: i.title, url: i.url, source: i.source })));

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `아래 중국어 물류·철도 뉴스 제목을 영어로 번역하고 한 줄 요약을 추가하세요.
반드시 JSON 배열로만 응답하세요. 다른 텍스트 없이 JSON만.

입력:
${inputJson}

출력 형식:
[{"title_en": "...", "title_cn": "원문", "summary_en": "1-sentence summary in English", "url": "...", "source": "..."}]`,
      }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const translated = JSON.parse(jsonMatch[0]) as TranslatedItem[];

    // 비중국어 아이템은 그대로 merge
    const nonChinese = items
      .filter(i => !/[一-鿿]/.test(i.title))
      .map(i => ({ title_en: i.title, title_cn: '', summary_en: i.summary_en, url: i.url, source: i.source }));

    return [...translated, ...nonChinese];
  } catch (e) {
    console.warn(`⚠️ 번역 실패: ${(e as Error).message} — 원문 사용`);
    return items.map(i => ({ title_en: i.title, title_cn: /[一-鿿]/.test(i.title) ? i.title : '', summary_en: '', url: i.url, source: i.source }));
  }
}

// ── 메인 collect ─────────────────────────────────────────────────
export async function collect(opts: { frequency: 'daily' | 'weekly' } = { frequency: 'daily' }): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };
  const sources = CN_SOURCES.filter(s => s.frequency === opts.frequency);
  const rawItems: NewsItem[] = [];

  for (const src of sources) {
    try {
      const items = await rateLimited(src.url, () =>
        src.type === 'rss' ? parseRss(src) : fetchHtmlLinks(src)
      );
      rawItems.push(...items);
      console.log(`✅ ${src.name}: ${items.length}건`);
    } catch (e) {
      console.log(`⚠️ ${src.name} 실패: ${(e as Error).message}`);
      result.data.push({
        data_type: 'news', data_key: `${src.name}_error`, data_value: {},
        source: src.name, source_url: src.url, is_complete: false,
        error_message: (e as Error).message,
      });
    }
  }

  const translated = await translateBatch(rawItems);

  for (const item of translated) {
    result.data.push({
      data_type: 'news',
      data_key: `RAIL_CN_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      data_value: { ...item, section: 'rail', language: 'cn', category: 'tcr_official' },
      source: item.source,
      source_url: item.url,
      is_complete: true,
    });
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ rail_cn [${opts.frequency}]: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
