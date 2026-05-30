// collectors/rail_cn.ts
// ì¤‘êµ­ì–´ ê³µì‹ ì² ë„ ì†ŒìŠ¤ ìˆ˜ì§‘ê¸°
// ì†ŒìŠ¤: China Railway, 95306, CRCT, Xi'an, Chengdu, BRI Portal (weekly)
//       Global Times BRI RSS, Xinhua English RSS (daily)

import Anthropic from '@anthropic-ai/sdk';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

// â”€â”€ ì†ŒìŠ¤ ì •ì˜ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface CnSource {
  name: string;
  url: string;
  type: 'rss' | 'html';
  frequency: 'daily' | 'weekly';
  useKeywordFilter?: boolean;  // ì¼ë°˜ ë‰´ìŠ¤ í”¼ë“œëŠ” ë¬¼ë¥˜ í‚¤ì›Œë“œ í•„í„° ì ìš©
}

// ë¬¼ë¥˜/ì² ë„/ë¬´ì—­ ê´€ë ¨ í‚¤ì›Œë“œ â€” ì´ ì¤‘ í•˜ë‚˜ë¼ë„ ì—†ìœ¼ë©´ ì¼ë°˜ ë‰´ìŠ¤ í”¼ë“œ ê¸°ì‚¬ ë“œë¡­
const RAIL_LOGISTICS_KEYWORDS = [
  'rail', 'railway', 'freight', 'cargo', 'logistics', 'container', 'teu',
  'corridor', 'route', 'belt road', 'belt and road', 'bri', 'silk road',
  'shipping', 'transport', 'transit', 'port', 'terminal', 'customs',
  'tcr', 'tsr', 'instc', 'train', 'intermodal', 'multimodal',
  'central asia', 'kazakh', 'uzbek', 'kyrgyz', 'tajik', 'azerbaijan',
  'china-europe', 'china europe', 'eurasian', 'trans-siberian',
  'supply chain', 'trade route', 'import', 'export', 'tariff', 'border',
  'é“è·¯', 'ç­åˆ—', 'ç‰©æµ', 'è´§è¿', 'é›†è£…ç®±', 'ä¸€å¸¦ä¸€è·¯', 'é€šé“', 'è¿è¾“',
];

function passesRailFilter(title: string): boolean {
  const lower = title.toLowerCase();
  return RAIL_LOGISTICS_KEYWORDS.some(kw => lower.includes(kw));
}

const CN_SOURCES: CnSource[] = [
  // Global Times / XinhuaëŠ” ì¼ë°˜ ë‰´ìŠ¤ í”¼ë“œ â†’ ë¬¼ë¥˜ í‚¤ì›Œë“œ í•„í„° í•„ìˆ˜
  { name: 'Global Times BRI',  url: 'https://www.globaltimes.cn/rss/outbrain.xml',                                          type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'Xinhua English',    url: 'https://english.news.cn/rss/world.xml',                                                type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'China Railway',     url: 'https://www.china-railway.com.cn/xwzx/zhxw/',                                         type: 'html', frequency: 'weekly' },
  { name: '95306',             url: 'https://www.95306.cn/',                                                                type: 'html', frequency: 'weekly' },
  { name: 'CRCT',              url: 'https://www.crct.com/index.php?m=content&c=index&a=lists&catid=34',                    type: 'html', frequency: 'weekly' },
  { name: "Xi'an Chang'an",    url: 'https://www.xaport.net/newabout',                                                     type: 'html', frequency: 'weekly' },
  { name: 'Chengdu Rail',      url: 'https://cdirs.cdiport.com/',                                                          type: 'html', frequency: 'weekly' },
  { name: 'BRI Portal',        url: 'https://www.yidaiyilu.gov.cn/',                                                       type: 'html', frequency: 'weekly' },
];

// â”€â”€ RSS íŒŒì‹± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    // ì¼ë°˜ ë‰´ìŠ¤ í”¼ë“œëŠ” ë¬¼ë¥˜ í‚¤ì›Œë“œ í•„í„° ì ìš©
    if (src.useKeywordFilter && !passesRailFilter(title)) continue;
    items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

// â”€â”€ HTML ë§í¬ íŒŒì‹± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Claude ë²ˆì—­ (ì¤‘êµ­ì–´ ì œëª© ë°°ì¹˜ ì²˜ë¦¬) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface TranslatedItem {
  title_en: string;
  title_cn: string;
  summary_en: string;
  url: string;
  source: string;
}

async function translateBatch(items: NewsItem[]): Promise<TranslatedItem[]> {
  const chineseItems = items.filter(i => /[ä¸€-é¿¿]/.test(i.title));
  if (chineseItems.length === 0) {
    return items.map(i => ({ title_en: i.title, title_cn: '', summary_en: i.summary_en, url: i.url, source: i.source }));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('âš ï¸ ANTHROPIC_API_KEY ë¯¸ì„¤ì • â€” ë²ˆì—­ ìŠ¤í‚µ');
    return items.map(i => ({ title_en: i.title, title_cn: /[ä¸€-é¿¿]/.test(i.title) ? i.title : '', summary_en: '', url: i.url, source: i.source } as TranslatedItem));
  }

  const client = new Anthropic({ apiKey });
  const inputJson = JSON.stringify(chineseItems.map(i => ({ title: i.title, url: i.url, source: i.source })));

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `ì•„ëž˜ ì¤‘êµ­ì–´ ë¬¼ë¥˜Â·ì² ë„ ë‰´ìŠ¤ ì œëª©ì„ ì˜ì–´ë¡œ ë²ˆì—­í•˜ê³  í•œ ì¤„ ìš”ì•½ì„ ì¶”ê°€í•˜ì„¸ìš”.
ë°˜ë“œì‹œ JSON ë°°ì—´ë¡œë§Œ ì‘ë‹µí•˜ì„¸ìš”. ë‹¤ë¥¸ í…ìŠ¤íŠ¸ ì—†ì´ JSONë§Œ.

ìž…ë ¥:
${inputJson}

ì¶œë ¥ í˜•ì‹:
[{"title_en": "...", "title_cn": "ì›ë¬¸", "summary_en": "1-sentence summary in English", "url": "...", "source": "..."}]`,
      }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('JSON íŒŒì‹± ì‹¤íŒ¨');
    const translated = JSON.parse(jsonMatch[0]) as TranslatedItem[];

    // ë¹„ì¤‘êµ­ì–´ ì•„ì´í…œì€ ê·¸ëŒ€ë¡œ merge
    const nonChinese = items
      .filter(i => !/[ä¸€-é¿¿]/.test(i.title))
      .map(i => ({ title_en: i.title, title_cn: '', summary_en: i.summary_en, url: i.url, source: i.source }));

    return [...translated, ...nonChinese];
  } catch (e) {
    console.warn(`âš ï¸ ë²ˆì—­ ì‹¤íŒ¨: ${(e as Error).message} â€” ì›ë¬¸ ì‚¬ìš©`);
    return items.map(i => ({ title_en: i.title, title_cn: /[ä¸€-é¿¿]/.test(i.title) ? i.title : '', summary_en: '', url: i.url, source: i.source }));
  }
}

// â”€â”€ ë©”ì¸ collect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      console.log(`âœ… ${src.name}: ${items.length}ê±´`);
    } catch (e) {
      console.log(`âš ï¸ ${src.name} ì‹¤íŒ¨: ${(e as Error).message}`);
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
  console.log(`\nâœ… rail_cn [${opts.frequency}]: ${success}ê±´ ìˆ˜ì§‘ ì™„ë£Œ`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
