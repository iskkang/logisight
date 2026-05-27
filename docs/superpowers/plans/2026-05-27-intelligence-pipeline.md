# Intelligence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 철도(TCR/TSR/중앙아시아) + 해상(선사 advisory·chokepoints·항만 통계) 자동 수집 → Claude AI 큐레이션 → 통합 뉴스레터 이메일 파이프라인 구축.

**Architecture:**
- 수집기 4개 신규 (`rail_cn`, `rail_ops`, `carrier_advisories`, `ocean_news`, `chokepoints`, `port_stats`)
- AI 큐레이션 2개 (`curate-rail.js`, `curate-ocean.js`) → 각각 `curated-rail.json` / `curated-ocean.json` 출력
- 뉴스레터 생성기 1개 (`generate-newsletter.js`) → 철도 top1 main + 2 links + 해상 top1 main + 2 links
- GitHub Actions 2개 (`daily-newsletter.yml` 09:00 KST, `weekly-newsletter.yml` 목요일 11:00 KST)

**Tech Stack:** TypeScript (ts-node), Node.js CommonJS (scripts), Playwright, `@anthropic-ai/sdk`, `@supabase/supabase-js`, GitHub Actions

---

## File Map

| 파일 | 액션 | 역할 |
|------|------|------|
| `workers/collectors/rail_cn.ts` | 신규 | 중국어 공식 소스 8개 + Claude 번역 |
| `workers/collectors/rail_ops.ts` | 신규 | 러시아/CIS 운영사 뉴스 10개 (fetch/RSS) |
| `workers/collectors/carrier_advisories.ts` | 신규 | 선사 8개 Playwright scraping |
| `workers/collectors/ocean_news.ts` | 신규 | 해상 전문뉴스 6개 RSS/fetch |
| `workers/collectors/chokepoints.ts` | 신규 | UKMTO·Panama·Suez·BIMCO |
| `workers/collectors/port_stats.ts` | 신규 | 항만 월간 TEU → Supabase |
| `workers/collectors/index.ts` | 수정 | rail-daily/weekly, ocean-daily/weekly 그룹 추가 |
| `workers/collectors/utils/snapshot_writer.ts` | 수정 | carrier_advisory, risk section 추가 |
| `scripts/curate-rail.js` | 신규 | Claude: rail 뉴스 3개 픽 + 큐레이션 |
| `scripts/curate-ocean.js` | 신규 | Claude: ocean 뉴스 3개 픽 + 큐레이션 |
| `scripts/generate-newsletter.js` | 신규 | 통합 HTML 뉴스레터 생성 |
| `supabase/migrations/20260527000010_port_throughput.sql` | 신규 | port_throughput 테이블 + RLS |
| `.github/workflows/daily-news.yml` | 삭제 | 구 파이프라인 제거 |
| `.github/workflows/daily-newsletter.yml` | 신규 | 통합 일간 워크플로 |
| `.github/workflows/weekly-newsletter.yml` | 신규 | 통합 주간 워크플로 |
| `package.json` | 수정 | 6개 스크립트 추가 |

---

## Task 1: Supabase migration — port_throughput 테이블

**Files:**
- Create: `supabase/migrations/20260527000010_port_throughput.sql`

- [ ] **Step 1: SQL 파일 작성**

```sql
-- supabase/migrations/20260527000010_port_throughput.sql
CREATE TABLE IF NOT EXISTS port_throughput (
  id           BIGSERIAL PRIMARY KEY,
  port_code    TEXT NOT NULL,
  year         INT  NOT NULL,
  month        INT  NOT NULL,
  teu          BIGINT,
  source       TEXT,
  source_url   TEXT,
  fetched_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(port_code, year, month)
);

ALTER TABLE port_throughput ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read port_throughput"
  ON port_throughput FOR SELECT TO anon USING (true);

CREATE POLICY "service write port_throughput"
  ON port_throughput FOR ALL TO service_role USING (true);
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260527000010_port_throughput.sql
git commit -m "feat(db): add port_throughput table with RLS"
```

---

## Task 2: snapshot_writer.ts — carrier_advisory·risk section 추가

**Files:**
- Modify: `workers/collectors/utils/snapshot_writer.ts:27`

- [ ] **Step 1: loadExisting() 반환값 수정**

파일 `workers/collectors/utils/snapshot_writer.ts`의 `loadExisting()` 반환값을 다음으로 교체:

```typescript
// 변경 전
return { date: '', shipping: [], air: [], rail: [], trade: [] };

// 변경 후
return { date: '', shipping: [], air: [], rail: [], trade: [],
         carrier_advisory: [], risk: [] };
```

단, `NewsOutput` 인터페이스도 같이 수정:

```typescript
interface NewsOutput {
  date: string;
  shipping: object[];
  air: object[];
  rail: object[];
  trade: object[];
  carrier_advisory: object[];  // 신규
  risk: object[];              // 신규
}
```

- [ ] **Step 2: 커밋**

```bash
git add workers/collectors/utils/snapshot_writer.ts
git commit -m "feat(snapshot): add carrier_advisory and risk sections"
```

---

## Task 3: rail_cn.ts — 중국어 공식 소스 수집기

**Files:**
- Create: `workers/collectors/rail_cn.ts`

- [ ] **Step 1: 파일 작성**

```typescript
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
    return items.map(i => ({ title_en: i.title, title_cn: /[一-鿿]/.test(i.title) ? i.title : '', summary_en: '', url: i.url, source: i.source, translated: false } as TranslatedItem));
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
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx ts-node --project tsconfig.workers.json -e "require('./workers/collectors/rail_cn')"
```

Expected: no TypeScript errors (imports resolve, types match)

- [ ] **Step 3: 커밋**

```bash
git add workers/collectors/rail_cn.ts
git commit -m "feat(collectors): add rail_cn.ts — Chinese official sources with Claude translation"
```

---

## Task 4: rail_ops.ts — 러시아/CIS 운영사 뉴스 수집기

**Files:**
- Create: `workers/collectors/rail_ops.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// workers/collectors/rail_ops.ts
// 러시아/CIS 운영사 뉴스 수집기 (fetch/RSS 기반, Playwright 미사용)
// 소스: RZD, RZD Logistics, FESCO, TransContainer, Delo, PortNews, SeaNews, KTZ, UTLC, Index1520

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface OpsSource {
  name: string;
  url: string;
  type: 'rss' | 'html';
  frequency: 'daily' | 'weekly';
}

const OPS_SOURCES: OpsSource[] = [
  { name: 'PortNews EN',        url: 'https://en.portnews.ru/rss/',              type: 'rss',  frequency: 'daily'  },
  { name: 'FESCO News',         url: 'https://www.fesco.com/en/press-center/news/', type: 'html', frequency: 'daily'  },
  { name: 'RZD Official EN',    url: 'https://eng.rzd.ru/en/9631?rubricator_id=881', type: 'html', frequency: 'weekly' },
  { name: 'RZD Logistics',      url: 'https://rzdlog.com/press-center/news/',    type: 'html', frequency: 'weekly' },
  { name: 'TransContainer',     url: 'https://trcont.com/en/',                   type: 'html', frequency: 'weekly' },
  { name: 'Delo Group',         url: 'https://www.delo-group.com/',              type: 'html', frequency: 'weekly' },
  { name: 'SeaNews Freight',    url: 'https://www.freight.ru/en/',               type: 'html', frequency: 'weekly' },
  { name: 'KTZ Express',        url: 'https://www.ktze.kz/en',                  type: 'html', frequency: 'weekly' },
  { name: 'UTLC ERA',           url: 'https://www.utlc.com/en/',                type: 'html', frequency: 'weekly' },
  { name: 'Index1520',          url: 'https://index1520.com/en/',               type: 'html', frequency: 'weekly' },
];

async function parseRss(src: OpsSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title   = (b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '').trim();
    const link    = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    if (!title || !link) continue;
    items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchHtmlLinks(src: OpsSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const base = new URL(src.url).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/g)) {
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

export async function collect(opts: { frequency: 'daily' | 'weekly' } = { frequency: 'daily' }): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'rail', data: [] };
  const sources = OPS_SOURCES.filter(s => s.frequency === opts.frequency);

  const settled = await Promise.allSettled(
    sources.map(src => rateLimited(src.url, () => src.type === 'rss' ? parseRss(src) : fetchHtmlLinks(src)))
  );

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const res = settled[i];
    if (res.status === 'rejected') {
      console.log(`⚠️ ${src.name} 실패: ${(res.reason as Error).message}`);
      result.data.push({ data_type: 'news', data_key: `${src.name}_error`, data_value: {}, source: src.name, source_url: src.url, is_complete: false, error_message: (res.reason as Error).message });
      continue;
    }
    for (const item of res.value) {
      result.data.push({
        data_type: 'news',
        data_key: `RAIL_OPS_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, section: 'rail', language: 'en', category: 'rail_operator' },
        source: src.name, source_url: src.url, is_complete: true,
      });
    }
    console.log(`✅ ${src.name}: ${res.value.length}건`);
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ rail_ops [${opts.frequency}]: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
```

- [ ] **Step 2: 커밋**

```bash
git add workers/collectors/rail_ops.ts
git commit -m "feat(collectors): add rail_ops.ts — Russian/CIS operator news sources"
```

---

## Task 5: carrier_advisories.ts — 선사 8개 (Playwright)

**Files:**
- Create: `workers/collectors/carrier_advisories.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// workers/collectors/carrier_advisories.ts
// 선사 Customer Advisory 수집기 — Playwright headless
// 대상: Maersk, MSC, CMA CGM, Hapag-Lloyd, ONE, HMM, COSCO, Yang Ming

import { chromium, type Browser } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

// 선사 advisory 키워드 — 이 키워드가 있으면 importance_hint: 'high'
const HIGH_IMPORTANCE_KEYWORDS = [
  'blank sailing', 'void sailing', 'service suspension', 'port omission',
  'surcharge', 'gri', 'pss', 'efs', 'war risk', 'red sea', 'disruption',
  'deviation', 'cancelled', 'omit', 'emergency', 'service alert',
];

interface CarrierSource {
  name: string;
  url: string;
  selectors: string[];  // 순서대로 시도, 첫 번째 성공 사용
}

const CARRIERS: CarrierSource[] = [
  {
    name: 'Maersk',
    url: 'https://www.maersk.com/news',
    selectors: ['[data-test="news-item"] a', 'article a', '.news-card a', 'h3 a', 'h2 a'],
  },
  {
    name: 'MSC',
    url: 'https://www.msc.com/en/newsroom/customer-advisories',
    selectors: ['.advisory-item a', 'article a', 'h3 a', 'h2 a', 'li a'],
  },
  {
    name: 'CMA CGM',
    url: 'https://www.cma-cgm.com/latest-news',
    selectors: ['.news-item a', 'article a', 'h2 a', 'h3 a'],
  },
  {
    name: 'Hapag-Lloyd',
    url: 'https://www.hapag-lloyd.com/en/services-information/operational-updates/overview.html',
    selectors: ['.update-item a', '.news-list a', 'article a', 'h3 a', 'h2 a'],
  },
  {
    name: 'ONE',
    url: 'https://www.one-line.com/en/news/156/all-years/all-months',
    selectors: ['.news-list a', 'article a', 'h3 a', 'h2 a'],
  },
  {
    name: 'HMM',
    url: 'https://www.hmm21.com/company/newsList.do',
    selectors: ['.board-list a', 'td a', '.title a', 'h3 a'],
  },
  {
    name: 'COSCO',
    url: 'https://lines.coscoshipping.com/',
    selectors: ['.news-item a', 'article a', 'h2 a', 'h3 a'],
  },
  {
    name: 'Yang Ming',
    url: 'https://www.yangming.com/en/about_us/news/notice',
    selectors: ['.notice-list a', 'article a', 'h3 a', 'td a'],
  },
];

function detectImportance(title: string): 'high' | 'normal' {
  const lower = title.toLowerCase();
  return HIGH_IMPORTANCE_KEYWORDS.some(kw => lower.includes(kw)) ? 'high' : 'normal';
}

async function scrapeCarrier(browser: Browser, carrier: CarrierSource): Promise<NewsItem[]> {
  const page = await browser.newPage();
  try {
    await page.goto(carrier.url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // 각 셀렉터를 순서대로 시도
    for (const selector of carrier.selectors) {
      const items = await page.evaluate((sel) => {
        const links = Array.from(document.querySelectorAll(sel));
        const seen = new Set<string>();
        return links
          .map(a => ({
            title: (a as HTMLElement).textContent?.trim().replace(/\s+/g, ' ') || '',
            url: (a as HTMLAnchorElement).href || '',
          }))
          .filter(item => {
            if (item.title.length < 8 || item.title.length > 200) return false;
            if (!item.url || item.url.includes('#') || item.url.includes('javascript')) return false;
            if (seen.has(item.title)) return false;
            seen.add(item.title);
            return true;
          })
          .slice(0, 5);
      }, selector);

      if (items.length > 0) {
        return items.map(item => ({
          title: item.title,
          url: item.url,
          published_at: new Date().toISOString(),
          summary_en: '',
          source: carrier.name,
        }));
      }
    }
    return [];
  } catch (e) {
    console.log(`⚠️ ${carrier.name} scrape 실패: ${(e as Error).message}`);
    return [];
  } finally {
    await page.close();
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'carrier_advisory', data: [] };
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });

    for (const carrier of CARRIERS) {
      try {
        const items = await rateLimited(carrier.url, () => scrapeCarrier(browser!, carrier));
        for (const item of items) {
          const importance = detectImportance(item.title);
          result.data.push({
            data_type: 'news',
            data_key: `CARRIER_${carrier.name}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            data_value: { ...item, section: 'carrier_advisory', language: 'en', category: 'carrier_advisory', importance_hint: importance },
            source: carrier.name,
            source_url: carrier.url,
            is_complete: true,
          });
        }
        console.log(`✅ ${carrier.name}: ${items.length}건 (high: ${items.filter(i => detectImportance(i.title) === 'high').length}건)`);
      } catch (e) {
        console.log(`⚠️ ${carrier.name} 전체 실패: ${(e as Error).message}`);
        result.data.push({ data_type: 'news', data_key: `${carrier.name}_error`, data_value: {}, source: carrier.name, source_url: carrier.url, is_complete: false, error_message: (e as Error).message });
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ carrier_advisories: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
```

- [ ] **Step 2: 커밋**

```bash
git add workers/collectors/carrier_advisories.ts
git commit -m "feat(collectors): add carrier_advisories.ts — 8 carriers via Playwright"
```

---

## Task 6: ocean_news.ts — 해상 전문뉴스 (RSS/fetch)

**Files:**
- Create: `workers/collectors/ocean_news.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// workers/collectors/ocean_news.ts
// 해상 전문뉴스 수집기 — RSS 기반 (news_global.ts에 없는 소스)
// 소스: Container News, Hellenic, Seatrade, Maritime Executive, gCaptain (daily)
//       Sea-Intelligence (weekly, HTML)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; news-bot)' };

// 키워드 필터 — 없는 기사 드롭 (노이즈 감소)
const SHIPPING_KEYWORDS = [
  'container', 'blank sailing', 'surcharge', 'congestion', 'port',
  'gri', 'void', 'omission', 'freight rate', 'schedule', 'carrier',
  'shipping', 'disruption', 'vessel', 'terminal', 'throughput',
];

interface OceanNewsSource {
  name: string;
  url: string;
  type: 'rss' | 'html';
  frequency: 'daily' | 'weekly';
  useKeywordFilter: boolean;
}

const OCEAN_NEWS_SOURCES: OceanNewsSource[] = [
  { name: 'Container News',      url: 'https://container-news.com/feed/',                    type: 'rss',  frequency: 'daily',  useKeywordFilter: false },
  { name: 'Hellenic Shipping',   url: 'https://www.hellenicshippingnews.com/feed/',           type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'Seatrade Maritime',   url: 'https://www.seatrade-maritime.com/feed/',              type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'Maritime Executive',  url: 'https://maritime-executive.com/feed/',                 type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'gCaptain',           url: 'https://gcaptain.com/feed/',                           type: 'rss',  frequency: 'daily',  useKeywordFilter: true  },
  { name: 'Sea-Intelligence',    url: 'https://www.sea-intelligence.com/press-room',          type: 'html', frequency: 'weekly', useKeywordFilter: false },
];

function passesKeywordFilter(title: string): boolean {
  const lower = title.toLowerCase();
  return SHIPPING_KEYWORDS.some(kw => lower.includes(kw));
}

async function parseRss(src: OceanNewsSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items: NewsItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title   = (b.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || b.match(/<title>(.*?)<\/title>/)?.[1] || '').trim();
    const link    = (b.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    if (!title || !link) continue;
    if (src.useKeywordFilter && !passesKeywordFilter(title)) continue;
    items.push({ title, url: link, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), summary_en: '', source: src.name });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchHtmlLinks(src: OceanNewsSource): Promise<NewsItem[]> {
  const res = await fetch(src.url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const base = new URL(src.url).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/g)) {
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

export async function collect(opts: { frequency: 'daily' | 'weekly' } = { frequency: 'daily' }): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const sources = OCEAN_NEWS_SOURCES.filter(s => s.frequency === opts.frequency);

  const settled = await Promise.allSettled(
    sources.map(src => rateLimited(src.url, () => src.type === 'rss' ? parseRss(src) : fetchHtmlLinks(src)))
  );

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const res = settled[i];
    if (res.status === 'rejected') {
      console.log(`⚠️ ${src.name} 실패: ${(res.reason as Error).message}`);
      continue;
    }
    for (const item of res.value) {
      result.data.push({
        data_type: 'news',
        data_key: `OCEAN_NEWS_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, section: 'shipping', language: 'en', category: 'ocean_news' },
        source: src.name, source_url: src.url, is_complete: true,
      });
    }
    console.log(`✅ ${src.name}: ${res.value.length}건`);
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ ocean_news [${opts.frequency}]: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
```

- [ ] **Step 2: 커밋**

```bash
git add workers/collectors/ocean_news.ts
git commit -m "feat(collectors): add ocean_news.ts — Container News/Hellenic/Seatrade/gCaptain RSS"
```

---

## Task 7: chokepoints.ts — UKMTO·Panama·Suez·BIMCO

**Files:**
- Create: `workers/collectors/chokepoints.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// workers/collectors/chokepoints.ts
// 항로 리스크 수집기 — UKMTO(daily), Panama/Suez/BIMCO(weekly)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult, NewsItem } from './types';

const BOT_HEADERS = {
  'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
  'Accept-Language': 'en-US,en;q=0.9',
};

function detectRegion(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('red sea') || t.includes('bab-el-mandeb') || t.includes('houthi')) return 'Red Sea';
  if (t.includes('gulf of aden'))    return 'Gulf of Aden';
  if (t.includes('indian ocean'))    return 'Indian Ocean';
  if (t.includes('gulf of oman') || t.includes('hormuz')) return 'Gulf of Oman';
  if (t.includes('arabian sea'))     return 'Arabian Sea';
  return 'Other';
}

async function fetchUKMTO(): Promise<NewsItem[]> {
  const url = 'https://www.ukmto.org/recent-incidents';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,150})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
    if (seen.has(title)) continue;
    if (href.startsWith('/')) href = `https://www.ukmto.org${href}`;
    if (!href.startsWith('http')) continue;
    const region = detectRegion(title);
    seen.add(title);
    items.push({ title: `[${region}] ${title}`, url: href, published_at: new Date().toISOString(), summary_en: '', source: 'UKMTO' });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchHtmlLinks(url: string, sourceName: string): Promise<NewsItem[]> {
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const base = new URL(url).origin;
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/g)) {
    let href = m[1].trim();
    const title = m[2].trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('javascript') || href.startsWith('#')) continue;
    if (seen.has(title)) continue;
    if (href.startsWith('/')) href = `${base}${href}`;
    if (!href.startsWith('http')) continue;
    seen.add(title);
    items.push({ title, url: href, published_at: new Date().toISOString(), summary_en: '', source: sourceName });
    if (items.length >= 5) break;
  }
  return items;
}

export async function collect(opts: { frequency: 'daily' | 'weekly' } = { frequency: 'daily' }): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'risk', data: [] };

  // UKMTO — daily
  try {
    const items = await rateLimited('https://www.ukmto.org', () => fetchUKMTO());
    for (const item of items) {
      result.data.push({
        data_type: 'news',
        data_key: `UKMTO_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        data_value: { ...item, section: 'risk', language: 'en', category: 'maritime_security' },
        source: 'UKMTO', source_url: 'https://www.ukmto.org/recent-incidents', is_complete: true,
      });
    }
    console.log(`✅ UKMTO: ${items.length}건`);
  } catch (e) {
    console.log(`⚠️ UKMTO 실패: ${(e as Error).message}`);
  }

  if (opts.frequency === 'weekly') {
    const weeklySources = [
      { name: 'Panama Canal', url: 'https://pancanal.com/en/maritime-services/advisory-to-shipping/' },
      { name: 'BIMCO',        url: 'https://www.bimco.org/news' },
    ];
    for (const src of weeklySources) {
      try {
        const items = await rateLimited(src.url, () => fetchHtmlLinks(src.url, src.name));
        for (const item of items) {
          result.data.push({
            data_type: 'news',
            data_key: `CHOKE_${src.name}_${Date.now()}`,
            data_value: { ...item, section: 'risk', language: 'en', category: 'chokepoint' },
            source: src.name, source_url: src.url, is_complete: true,
          });
        }
        console.log(`✅ ${src.name}: ${items.length}건`);
      } catch (e) {
        console.log(`⚠️ ${src.name} 실패: ${(e as Error).message}`);
      }
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ chokepoints [${opts.frequency}]: ${success}건 수집 완료`);
  return result;
}

if (require.main === module) {
  const freq = (process.argv[2] as 'daily' | 'weekly') || 'daily';
  collect({ frequency: freq }).then(r => snapshotWriter(r)).catch(console.error);
}
```

- [ ] **Step 2: 커밋**

```bash
git add workers/collectors/chokepoints.ts
git commit -m "feat(collectors): add chokepoints.ts — UKMTO/Panama/BIMCO risk feed"
```

---

## Task 8: port_stats.ts — 항만 월간 TEU → Supabase

**Files:**
- Create: `workers/collectors/port_stats.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// workers/collectors/port_stats.ts
// 항만 월간 TEU 통계 수집기 — Supabase port_throughput 테이블에 직접 저장
// 소스: Port of LA, Port of LB (HTML 파싱), Singapore (CSV), Rotterdam/Antwerp (HTML)

import { rateLimited } from './utils/rate_limiter';
import { dbUpsert } from './utils/supabase_writer';
import type { CollectorResult } from './types';

const BOT_HEADERS = { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; stats-bot)' };
const TODAY = new Date();
const YEAR  = TODAY.getUTCFullYear();
const MONTH = TODAY.getUTCMonth() + 1;

interface PortRow {
  port_code: string;
  year: number;
  month: number;
  teu: number | null;
  source: string;
  source_url: string;
}

// ── Port of LA — HTML 테이블에서 최신 TEU 파싱 ─────────────────────
async function fetchPortLA(): Promise<PortRow | null> {
  const url = 'https://portoflosangeles.org/business/statistics/container-statistics';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // 최신 연도 TEU 숫자 패턴 (예: "1,234,567")
  const match = html.match(/(\d{1,3}(?:,\d{3})+)\s*(?:TEU|teu)/i);
  const teu = match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
  return { port_code: 'LA', year: YEAR, month: MONTH - 1 || 12, teu, source: 'Port of LA', source_url: url };
}

// ── Port of Long Beach — HTML 파싱 ────────────────────────────────
async function fetchPortLB(): Promise<PortRow | null> {
  const url = 'https://polb.com/business/port-statistics/';
  const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/(\d{1,3}(?:,\d{3})+)\s*(?:TEU|teu)/i);
  const teu = match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
  return { port_code: 'LB', year: YEAR, month: MONTH - 1 || 12, teu, source: 'Port of Long Beach', source_url: url };
}

// ── Singapore MPA — data.gov.sg CSV ───────────────────────────────
async function fetchSingapore(): Promise<PortRow | null> {
  const url = 'https://data.gov.sg/datasets/d_da030f7028200d19ffcbe4a2d71af39c/view';
  try {
    const res = await fetch(url, { headers: BOT_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // CSV: 최신 행에서 TEU 추출
    const lines = text.trim().split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1];
    const parts = lastLine.split(',');
    const teu = parts.length >= 2 ? parseInt(parts[parts.length - 1].trim().replace(/"/g, ''), 10) : null;
    return { port_code: 'SGP', year: YEAR, month: MONTH - 1 || 12, teu: isNaN(teu ?? NaN) ? null : teu, source: 'Singapore MPA', source_url: url };
  } catch {
    return null;
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  const rows: PortRow[] = [];

  const fetchers = [
    { name: 'Port of LA', fn: () => fetchPortLA() },
    { name: 'Port of LB', fn: () => fetchPortLB() },
    { name: 'Singapore',  fn: () => fetchSingapore() },
  ];

  for (const f of fetchers) {
    try {
      const row = await rateLimited(f.name, f.fn);
      if (row && row.teu !== null) {
        rows.push(row);
        result.data.push({ data_type: 'port_stat', data_key: `PORT_${row.port_code}`, data_value: row, source: row.source, source_url: row.source_url, is_complete: true });
        console.log(`✅ ${f.name}: ${row.teu?.toLocaleString()} TEU (${row.year}-${String(row.month).padStart(2, '0')})`);
      } else {
        console.log(`⚠️ ${f.name}: TEU 파싱 실패`);
        result.data.push({ data_type: 'port_stat', data_key: `PORT_${f.name}_error`, data_value: {}, source: f.name, source_url: '', is_complete: false, error_message: 'TEU 파싱 실패' });
      }
    } catch (e) {
      console.log(`⚠️ ${f.name} 실패: ${(e as Error).message}`);
      result.data.push({ data_type: 'port_stat', data_key: `PORT_${f.name}_error`, data_value: {}, source: f.name, source_url: '', is_complete: false, error_message: (e as Error).message });
    }
  }

  if (rows.length > 0) {
    await dbUpsert('port_throughput', rows, 'port_code,year,month').catch(e =>
      console.warn('[port_throughput] Supabase persist skipped:', (e as Error).message)
    );
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`\n✅ port_stats: ${success}/${result.data.length}개 수집 완료`);
  return result;
}

if (require.main === module) {
  collect().catch(console.error);
}
```

- [ ] **Step 2: 커밋**

```bash
git add workers/collectors/port_stats.ts
git commit -m "feat(collectors): add port_stats.ts — LA/LB/Singapore monthly TEU to Supabase"
```

---

## Task 9: index.ts + package.json 수정

**Files:**
- Modify: `workers/collectors/index.ts`
- Modify: `package.json`

- [ ] **Step 1: index.ts에 새 import + 그룹 추가**

`workers/collectors/index.ts` 상단 import 섹션에 추가:

```typescript
import { collect as collectRailCN }            from './rail_cn';
import { collect as collectRailOps }           from './rail_ops';
import { collect as collectCarrierAdvisories } from './carrier_advisories';
import { collect as collectOceanNews }         from './ocean_news';
import { collect as collectChokepoints }       from './chokepoints';
import { collect as collectPortStats }         from './port_stats';
```

기존 `GROUPS` 배열 끝에 추가:

```typescript
  {
    name: 'rail-daily',
    collectors: [
      { name: 'rail_cn_daily',  fn: () => collectRailCN({ frequency: 'daily' }) },
      { name: 'rail_ops_daily', fn: () => collectRailOps({ frequency: 'daily' }) },
    ],
  },
  {
    name: 'rail-weekly',
    collectors: [
      { name: 'rail_cn_weekly',  fn: () => collectRailCN({ frequency: 'weekly' }) },
      { name: 'rail_ops_weekly', fn: () => collectRailOps({ frequency: 'weekly' }) },
    ],
  },
  {
    name: 'ocean-daily',
    collectors: [
      { name: 'carrier_advisories',  fn: collectCarrierAdvisories },
      { name: 'ocean_news_daily',    fn: () => collectOceanNews({ frequency: 'daily' }) },
      { name: 'chokepoints_daily',   fn: () => collectChokepoints({ frequency: 'daily' }) },
    ],
  },
  {
    name: 'ocean-weekly',
    collectors: [
      { name: 'carrier_advisories',  fn: collectCarrierAdvisories },
      { name: 'ocean_news_weekly',   fn: () => collectOceanNews({ frequency: 'weekly' }) },
      { name: 'chokepoints_weekly',  fn: () => collectChokepoints({ frequency: 'weekly' }) },
      { name: 'port_stats',          fn: collectPortStats },
    ],
  },
```

`GROUP_MAP`에도 추가:

```typescript
  'rail-daily':   'rail-daily',
  'rail-weekly':  'rail-weekly',
  'ocean-daily':  'ocean-daily',
  'ocean-weekly': 'ocean-weekly',
```

- [ ] **Step 2: package.json 스크립트 추가**

`package.json`의 `scripts` 섹션에 추가:

```json
"collect:rail:daily":   "ts-node --project tsconfig.workers.json workers/collectors/index.ts rail-daily",
"collect:rail:weekly":  "ts-node --project tsconfig.workers.json workers/collectors/index.ts rail-weekly",
"collect:ocean:daily":  "ts-node --project tsconfig.workers.json workers/collectors/index.ts ocean-daily",
"collect:ocean:weekly": "ts-node --project tsconfig.workers.json workers/collectors/index.ts ocean-weekly",
"curate:rail":          "node scripts/curate-rail.js",
"curate:ocean":         "node scripts/curate-ocean.js",
"newsletter:generate":  "node scripts/generate-newsletter.js"
```

- [ ] **Step 3: 타입 체크**

```bash
npx ts-node --project tsconfig.workers.json -e "console.log('index ok')" 2>&1 | head -20
```

Expected: `index ok` (no TS errors)

- [ ] **Step 4: 커밋**

```bash
git add workers/collectors/index.ts package.json
git commit -m "feat(collectors): register rail-daily/weekly, ocean-daily/weekly groups in index.ts"
```

---

## Task 10: curate-rail.js — AI 큐레이션 (철도)

**Files:**
- Create: `scripts/curate-rail.js`

- [ ] **Step 1: 파일 작성**

```javascript
// scripts/curate-rail.js
// 철도 뉴스 AI 큐레이션
// 입력: content/drafts/latest-news.json (.rail 배열)
// 출력: content/drafts/curated-rail.json

const fs      = require('fs');
const path    = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

const NEWS_PATH   = path.resolve(__dirname, '../content/drafts/latest-news.json');
const OUT_PATH    = path.resolve(__dirname, '../content/drafts/curated-rail.json');
const TODAY       = new Date().toISOString().slice(0, 10);

// --window=7d 인수 확인
const windowArg = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 1;
const cutoff    = new Date(Date.now() - windowDays * 86_400_000).toISOString();

function loadRailItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
  const items = (data.rail || []).filter(i => {
    if (!i.published_at) return true; // 날짜 없으면 포함
    return i.published_at >= cutoff;
  });
  // 중복 URL dedup
  const seen = new Set();
  return items.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

async function curate(items) {
  if (items.length === 0) {
    console.warn('⚠️ rail 뉴스 0건 — 스킵');
    process.exit(0);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const itemList = items.map((i, idx) =>
    `${idx + 1}. [${i.source}] ${i.title_en || i.title} — ${i.url}`
  ).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 물류 인텔리전스 에디터입니다.
한국·CIS·중앙아시아 특화 시각으로 철도 뉴스를 평가합니다.

아래 뉴스 목록에서 MTL 화주·포워더에게 가장 중요한 3개를 선정하세요.

평가 기준:
+3: 한국↔CIS/중앙아시아 노선 직접 영향 (KR-ANDIJAN, KR-ALMATY, TCR/TSR)
+2: 구체적 수치 포함 (운임·물동량·지연일수·TEU)
+2: MTL 핵심 서비스 직결 (TCR/TSR/INSTC/중유럽반열)
+1: 지정학·정책 변화 (러시아 제재, 카자흐 통과세, 중국 운임정책)
-2: 단순 수상·인사 발표
-2: 한국·CIS 노선과 무관한 이슈

출력 규칙 (엄격히 준수):
- main.what: 200자 이하. 무슨 일이 일어났나. 핵심 사실 1~2문장.
- main.why_now: 200자 이하. 왜 지금 중요한가. 1~2문장.
- main.checkpoint: 200자 이하. 화주·포워더가 지금 할 일 1가지.
- MTL 영업 포인트는 출력하지 말 것.
- links: 2번째, 3번째 뉴스의 한국어 제목과 원본 URL만.

뉴스 목록:
${itemList}

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "date": "${TODAY}",
  "curated_at": "${new Date().toISOString()}",
  "section": "rail",
  "main": {
    "title": "영어 제목",
    "title_ko": "한국어 제목",
    "url": "원본 URL",
    "source": "출처명",
    "image_url": null,
    "what": "200자 이하",
    "why_now": "200자 이하",
    "checkpoint": "200자 이하",
    "importance_score": 7
  },
  "links": [
    { "title": "영어 제목2", "title_ko": "한국어 제목2", "url": "URL2", "source": "출처2" },
    { "title": "영어 제목3", "title_ko": "한국어 제목3", "url": "URL3", "source": "출처3" }
  ],
  "total_collected": ${items.length},
  "excluded_count": ${Math.max(0, items.length - 3)}
}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude 응답에서 JSON 추출 실패');

  const result = JSON.parse(jsonMatch[0]);

  // 200자 초과 필드 강제 단축
  for (const field of ['what', 'why_now', 'checkpoint']) {
    if (result.main[field] && result.main[field].length > 200) {
      result.main[field] = result.main[field].slice(0, 197) + '…';
    }
  }

  return result;
}

async function main() {
  const items = loadRailItems();
  console.log(`📰 rail 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  const curated = await curate(items);

  fs.writeFileSync(OUT_PATH, JSON.stringify(curated, null, 2), 'utf-8');
  // 날짜별 보존
  const archivePath = OUT_PATH.replace('curated-rail.json', `curated-rail-${TODAY}.json`);
  fs.writeFileSync(archivePath, JSON.stringify(curated, null, 2), 'utf-8');

  console.log(`✅ curated-rail.json 생성 완료 (main: ${curated.main?.title_ko})`);
}

main().catch(e => { console.error('❌ curate-rail 실패:', e.message); process.exit(1); });
```

- [ ] **Step 2: 로컬 테스트 (latest-news.json에 rail 데이터 있을 경우)**

```bash
ANTHROPIC_API_KEY=sk-... node scripts/curate-rail.js
```

Expected: `content/drafts/curated-rail.json` 생성, `main.what` 200자 이하

- [ ] **Step 3: 커밋**

```bash
git add scripts/curate-rail.js
git commit -m "feat(scripts): add curate-rail.js — AI picks top 3 rail news, 200 char limit"
```

---

## Task 11: curate-ocean.js — AI 큐레이션 (해상)

**Files:**
- Create: `scripts/curate-ocean.js`

- [ ] **Step 1: 파일 작성**

```javascript
// scripts/curate-ocean.js
// 해상 뉴스 AI 큐레이션
// 입력: content/drafts/latest-news.json (.shipping + .carrier_advisory + .risk)
// 출력: content/drafts/curated-ocean.json

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

const NEWS_PATH   = path.resolve(__dirname, '../content/drafts/latest-news.json');
const OUT_PATH    = path.resolve(__dirname, '../content/drafts/curated-ocean.json');
const TODAY       = new Date().toISOString().slice(0, 10);

const windowArg  = process.argv.find(a => a.startsWith('--window='));
const windowDays = windowArg ? parseInt(windowArg.split('=')[1]) : 1;
const cutoff     = new Date(Date.now() - windowDays * 86_400_000).toISOString();

function loadOceanItems() {
  if (!fs.existsSync(NEWS_PATH)) {
    console.warn('⚠️ latest-news.json 없음 — 스킵');
    process.exit(0);
  }
  const data = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));

  // shipping + carrier_advisory + risk 합산
  const allItems = [
    ...(data.shipping         || []),
    ...(data.carrier_advisory || []),
    ...(data.risk             || []),
  ].filter(i => !i.published_at || i.published_at >= cutoff);

  // 중복 URL dedup
  const seen = new Set();
  return allItems.filter(i => {
    if (!i.url || seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

// Supabase에서 port_throughput 최근 2개월 로드 (선택적)
async function loadPortContext() {
  const url     = process.env.SUPABASE_URL;
  const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svcKey) return '';
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(url, svcKey);
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const { data } = await sb
      .from('port_throughput')
      .select('port_code,year,month,teu')
      .gte('year', twoMonthsAgo.getFullYear())
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(10);
    if (!data || data.length === 0) return '';
    return '\n[항만 최신 통계]\n' + data
      .map(r => `- ${r.port_code}: ${r.year}-${String(r.month).padStart(2, '0')} = ${r.teu?.toLocaleString() || 'N/A'} TEU`)
      .join('\n');
  } catch {
    return '';
  }
}

async function curate(items, portContext) {
  if (items.length === 0) {
    console.warn('⚠️ ocean 뉴스 0건 — 스킵');
    process.exit(0);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const itemList = items.map((i, idx) => {
    const hint = i.importance_hint === 'high' ? ' ⚡HIGH' : '';
    return `${idx + 1}. [${i.source}]${hint} ${i.title_en || i.title} — ${i.url}`;
  }).join('\n');

  const prompt = `당신은 MTL Shipping Agency의 해운 인텔리전스 에디터입니다.
한국·CIS·극동러시아 항로 특화 시각으로 평가합니다.
${portContext}

아래 뉴스 목록에서 MTL 화주·포워더에게 가장 중요한 3개를 선정하세요.

평가 기준:
+3: 한국↔유럽/미주/CIS 노선 직접 영향
+3: Blank Sailing / Void Sailing / Service Suspension 선사 공지
+2: 운임 수치 포함 (WCI·SCFI·FBX, $/FEU)
+2: Red Sea / Suez / Panama / Hormuz 실제 인시던트 또는 제한 (⚡HIGH 태그 우선)
+2: Surcharge 신설·인상 공지 (GRI·PSS·EFS)
+1: 항만 혼잡·대기 시간 정보
-2: 수상·인사 발표, M&A
-2: 미주·유럽 내부 이슈
-3: 광고성 자료

출력 규칙 (엄격히 준수):
- main.what: 200자 이하.
- main.why_now: 200자 이하.
- main.checkpoint: 200자 이하.
- MTL 영업 포인트는 출력하지 말 것.

뉴스 목록:
${itemList}

아래 JSON 형식으로만 응답하세요:
{
  "date": "${TODAY}",
  "curated_at": "${new Date().toISOString()}",
  "section": "ocean",
  "main": {
    "title": "영어 제목",
    "title_ko": "한국어 제목",
    "url": "원본 URL",
    "source": "출처명",
    "image_url": null,
    "what": "200자 이하",
    "why_now": "200자 이하",
    "checkpoint": "200자 이하",
    "importance_score": 7
  },
  "links": [
    { "title": "영어 제목2", "title_ko": "한국어 제목2", "url": "URL2", "source": "출처2" },
    { "title": "영어 제목3", "title_ko": "한국어 제목3", "url": "URL3", "source": "출처3" }
  ],
  "total_collected": ${items.length},
  "excluded_count": ${Math.max(0, items.length - 3)}
}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude 응답에서 JSON 추출 실패');

  const result = JSON.parse(jsonMatch[0]);

  for (const field of ['what', 'why_now', 'checkpoint']) {
    if (result.main[field] && result.main[field].length > 200) {
      result.main[field] = result.main[field].slice(0, 197) + '…';
    }
  }

  return result;
}

async function main() {
  const items      = loadOceanItems();
  const portCtx    = await loadPortContext();
  console.log(`📰 ocean 뉴스 ${items.length}건 로드 (window: ${windowDays}d)`);

  const curated = await curate(items, portCtx);

  fs.writeFileSync(OUT_PATH, JSON.stringify(curated, null, 2), 'utf-8');
  const archivePath = OUT_PATH.replace('curated-ocean.json', `curated-ocean-${TODAY}.json`);
  fs.writeFileSync(archivePath, JSON.stringify(curated, null, 2), 'utf-8');

  console.log(`✅ curated-ocean.json 생성 완료 (main: ${curated.main?.title_ko})`);
}

main().catch(e => { console.error('❌ curate-ocean 실패:', e.message); process.exit(1); });
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/curate-ocean.js
git commit -m "feat(scripts): add curate-ocean.js — AI picks top 3 ocean news with chokepoint weighting"
```

---

## Task 12: generate-newsletter.js — 통합 HTML 뉴스레터

**Files:**
- Create: `scripts/generate-newsletter.js`

- [ ] **Step 1: 파일 작성**

```javascript
// scripts/generate-newsletter.js
// 통합 뉴스레터 HTML 생성
// 입력: curated-rail.json + curated-ocean.json
// 출력: newsletter-YYYY-MM-DD.html
// 구조: [Rail 메인 + 2 링크] + [Ocean 메인 + 2 링크]

const fs   = require('fs');
const path = require('path');

const RAIL_PATH  = path.resolve(__dirname, '../content/drafts/curated-rail.json');
const OCEAN_PATH = path.resolve(__dirname, '../content/drafts/curated-ocean.json');
const TODAY      = new Date().toISOString().slice(0, 10);
const OUT        = path.resolve(__dirname, `../content/drafts/newsletter-${TODAY}.html`);

const BLOCKED_DOMAINS = ['freightwaves.com', 'wsj.com', 'ft.com', 'bloomberg.com', 'lloydslist.com'];

function safeUrl(url, title) {
  try {
    const u = new URL(url);
    const isHomepage = !u.pathname || u.pathname === '/';
    const isBlocked  = BLOCKED_DOMAINS.some(d => u.hostname.includes(d));
    if (isHomepage || isBlocked) return 'https://www.google.com/search?q=' + encodeURIComponent(title);
    return url;
  } catch { return '#'; }
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function sectionHtml(data, opts) {
  if (!data || !data.main) return '';
  const { bgColor, borderColor, icon, label } = opts;
  const m = data.main;
  const links = (data.links || []).slice(0, 2);

  const imageHtml = m.image_url
    ? `<img src="${esc(m.image_url)}" width="560" style="width:100%;height:200px;object-fit:cover;border-radius:8px 8px 0 0;display:block;" alt="">
       <div style="font-size:10px;color:#94A3B8;text-align:right;padding:2px 6px;">Photo: Unsplash</div>`
    : `<div style="height:120px;border-radius:8px 8px 0 0;background:${bgColor};display:flex;align-items:center;justify-content:center;">
         <span style="font-size:32px;">${icon}</span>
       </div>`;

  const linkItems = links.map(l =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #F1F5F9;">
      <span style="color:#64748B;margin-right:6px;">▶</span>
      <a href="${safeUrl(l.url, l.title_ko || l.title)}" target="_blank" rel="noopener noreferrer"
         style="font-size:13px;color:#1B4D8C;text-decoration:none;font-weight:600;word-break:keep-all;">
        ${esc(l.title_ko || l.title)}
      </a>
      <span style="font-size:11px;color:#94A3B8;margin-left:6px;">${esc(l.source || '')}</span>
    </td></tr>`
  ).join('');

  return `
  <!-- ===== ${label} 섹션 ===== -->
  <tr><td style="padding:20px 20px 0;">
    <div style="font-size:11px;font-weight:800;color:#0F2D5A;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">
      ${icon} ${label}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="border:2px solid ${borderColor};border-radius:10px;overflow:hidden;background:#FFFFFF;">
      <tr><td>
        ${imageHtml}
        <div style="padding:18px 20px;">
          <div style="font-size:11px;color:#64748B;margin-bottom:6px;">${esc(m.source || '')}</div>
          <h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#0F2D5A;line-height:1.4;word-break:keep-all;">
            ${esc(m.title_ko || m.title)}
          </h2>

          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">What</div>
            <div style="font-size:13px;color:#374151;line-height:1.6;word-break:keep-all;">${esc(m.what || '')}</div>
          </div>

          <div style="margin-bottom:10px;padding:12px;background:#F8FAFC;border-radius:6px;">
            <div style="font-size:10px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Why Now</div>
            <div style="font-size:13px;color:#374151;line-height:1.6;word-break:keep-all;">${esc(m.why_now || '')}</div>
          </div>

          <div style="margin-bottom:14px;padding:12px;background:#F0FDF4;border-radius:6px;border-left:3px solid #00A85A;">
            <div style="font-size:10px;font-weight:700;color:#00A85A;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">💡 체크포인트</div>
            <div style="font-size:13px;color:#374151;line-height:1.6;word-break:keep-all;">${esc(m.checkpoint || '')}</div>
          </div>

          <div style="text-align:right;">
            <a href="${safeUrl(m.url, m.title_ko || m.title)}" target="_blank" rel="noopener noreferrer"
               style="font-size:12px;color:${borderColor};font-weight:700;text-decoration:none;">원문 보기 →</a>
          </div>
        </div>
      </td></tr>
    </table>
  </td></tr>

  ${links.length > 0 ? `
  <!-- ${label} 추가 뉴스 링크 -->
  <tr><td style="padding:8px 20px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      ${linkItems}
    </table>
  </td></tr>` : ''}`;
}

function build(rail, ocean) {
  const dateFormatted = (() => {
    try { return new Date(TODAY).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); }
    catch { return TODAY; }
  })();

  const railHtml  = sectionHtml(rail,  { bgColor: '#EFF6FF', borderColor: '#1B4D8C', icon: '🚂', label: 'RAIL INTELLIGENCE'  });
  const oceanHtml = sectionHtml(ocean, { bgColor: '#ECFDF5', borderColor: '#0E7490', icon: '🚢', label: 'OCEAN INTELLIGENCE' });

  if (!railHtml && !oceanHtml) {
    console.warn('⚠️ rail + ocean 모두 없음 — HTML 생성 스킵');
    process.exit(0);
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Logisight Daily — ${TODAY}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
       style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

  <!-- HEADER -->
  <tr><td style="background:#EFF6FF;padding:24px 28px 20px;border-bottom:3px solid #1B4D8C;">
    <div style="font-size:11px;font-weight:700;color:#1B4D8C;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;">
      MTL Logisight Intelligence
    </div>
    <div style="font-size:24px;font-weight:800;color:#0F2D5A;line-height:1.2;margin-bottom:4px;">Logisight Daily</div>
    <div style="font-size:13px;color:#475569;">${dateFormatted}</div>
  </td></tr>

  ${railHtml}
  ${oceanHtml}

  <!-- CTA -->
  <tr><td style="padding:20px 20px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border:1px solid #BFDBFE;border-radius:12px;">
      <tr><td style="padding:20px;">
        <div style="font-size:14px;font-weight:700;color:#0F2D5A;margin-bottom:4px;">📊 더 깊은 데이터가 필요하다면</div>
        <div style="font-size:12px;color:#475569;margin-bottom:12px;">SCFI·WCI·KCCI 실시간 + TCR/TSR 동향 + 화물 트래킹</div>
        <a href="https://logisight.mtlship.com" target="_blank" rel="noopener noreferrer"
           style="display:inline-block;background:#1B4D8C;color:#FFFFFF;font-size:12px;font-weight:700;text-decoration:none;padding:8px 18px;border-radius:6px;">
          Logisight 대시보드 →
        </a>
      </td></tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#1E293B;border-radius:0 0 16px 16px;padding:20px 24px;text-align:center;">
    <div style="font-size:12px;font-weight:700;color:#FFFFFF;margin-bottom:4px;">Logisight Daily</div>
    <div style="font-size:11px;color:#94A3B8;line-height:1.8;margin-bottom:8px;">
      발행: MTL Shipping Agency &nbsp;·&nbsp; newsletter@mtlship.com<br>${dateFormatted}
    </div>
    <div style="font-size:11px;">
      <a href="#" style="color:#93C5FD;text-decoration:none;">수신 거부</a>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      <a href="https://logisight.mtlship.com" rel="noopener noreferrer" style="color:#93C5FD;text-decoration:none;">웹에서 보기</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const rail  = loadJson(RAIL_PATH);
const ocean = loadJson(OCEAN_PATH);
const html  = build(rail, ocean);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf-8');
console.log(`✅ newsletter HTML 생성: ${OUT}`);
```

- [ ] **Step 2: 더미 JSON으로 로컬 테스트**

```bash
# 더미 curated-rail.json 생성
node -e "
const fs = require('fs');
fs.writeFileSync('content/drafts/curated-rail.json', JSON.stringify({
  date: '2026-05-27', section: 'rail',
  main: { title: 'Test Rail', title_ko: '테스트 철도 뉴스', url: 'https://example.com/rail', source: 'Test', image_url: null,
    what: '중국-유럽 철도 Q1 물동량이 전년 대비 29% 증가했다.', why_now: '이란 전쟁으로 해상 비용이 급등하면서 TCR 경쟁력이 높아졌다.', checkpoint: 'TCR 슬롯을 6월 전에 선점할 것.', importance_score: 7 },
  links: [{ title: 'Link 1', title_ko: '링크 1', url: 'https://example.com/1', source: 'RailFreight' }, { title: 'Link 2', title_ko: '링크 2', url: 'https://example.com/2', source: 'RZD' }],
  total_collected: 20, excluded_count: 17
}));
fs.writeFileSync('content/drafts/curated-ocean.json', JSON.stringify({
  date: '2026-05-27', section: 'ocean',
  main: { title: 'Maersk blank sailing W24', title_ko: 'Maersk W24 블랭크 세일링 공지', url: 'https://example.com/ocean', source: 'Maersk', image_url: null,
    what: 'Maersk가 W24 아시아-유럽 항로에서 블랭크 세일링을 발표했다.', why_now: '수요 약세로 선사들이 공급 조절에 나서고 있어 화주 일정에 영향이 예상된다.', checkpoint: '대체 선사 또는 다음 주 부킹으로 전환할 것.', importance_score: 8 },
  links: [{ title: 'SCFI drops 3.2%', title_ko: 'SCFI 3.2% 하락', url: 'https://example.com/scfi', source: 'SSE' }, { title: 'UKMTO Red Sea incident', title_ko: 'UKMTO 홍해 인시던트', url: 'https://example.com/ukmto', source: 'UKMTO' }],
  total_collected: 35, excluded_count: 32
}));
console.log('더미 JSON 생성 완료');
"

node scripts/generate-newsletter.js
```

Expected: `content/drafts/newsletter-2026-05-27.html` 생성

- [ ] **Step 3: HTML 확인**

```bash
# HTML 파일 크기 및 핵심 태그 확인
node -e "
const fs = require('fs');
const html = fs.readFileSync('content/drafts/newsletter-2026-05-27.html', 'utf-8');
console.log('파일 크기:', html.length, 'bytes');
console.log('Rail 섹션 포함:', html.includes('RAIL INTELLIGENCE'));
console.log('Ocean 섹션 포함:', html.includes('OCEAN INTELLIGENCE'));
console.log('MTL 영업 포인트 없음:', !html.includes('MTL 영업 포인트'));
console.log('원문 보기 링크 수:', (html.match(/원문 보기/g) || []).length);
console.log('추가 뉴스 링크 수:', (html.match(/▶/g) || []).length);
"
```

Expected:
- Rail/Ocean 섹션 포함: true
- MTL 영업 포인트 없음: true
- 원문 보기 링크 수: 2
- 추가 뉴스 링크 수: 4

- [ ] **Step 4: 커밋**

```bash
git add scripts/generate-newsletter.js
git commit -m "feat(scripts): add generate-newsletter.js — unified rail+ocean HTML template"
```

---

## Task 13: 구 daily-news.yml 삭제 + 새 워크플로 추가

**Files:**
- Delete: `.github/workflows/daily-news.yml`
- Create: `.github/workflows/daily-newsletter.yml`
- Create: `.github/workflows/weekly-newsletter.yml`

- [ ] **Step 1: daily-news.yml 삭제**

```bash
git rm .github/workflows/daily-news.yml
```

- [ ] **Step 2: daily-newsletter.yml 작성**

```yaml
# .github/workflows/daily-newsletter.yml
name: Daily Newsletter

on:
  schedule:
    - cron: '0 0 * * *'   # 09:00 KST (UTC 00:00)
  workflow_dispatch:

jobs:
  newsletter:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Collect rail (daily)
        run: npm run collect:rail:daily
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Collect ocean (daily)
        run: npm run collect:ocean:daily
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Curate rail
        run: npm run curate:rail
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Curate ocean
        run: npm run curate:ocean
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Generate newsletter HTML
        run: npm run newsletter:generate

      - name: Send newsletter
        run: |
          TODAY=$(date +%Y-%m-%d)
          HTML_PATH="content/drafts/newsletter-${TODAY}.html"
          if [ -f "$HTML_PATH" ]; then
            echo "📄 HTML 발송: $HTML_PATH"
            node scripts/send-newsletter.js --html="$HTML_PATH"
          else
            echo "⚠️ HTML 없음 — 발송 스킵"
          fi
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          SEND_TO: ${{ secrets.INTERNAL_EMAIL }}
```

- [ ] **Step 3: weekly-newsletter.yml 작성**

```yaml
# .github/workflows/weekly-newsletter.yml
name: Weekly Newsletter

on:
  schedule:
    - cron: '0 2 * * 4'   # 목요일 02:00 UTC (11:00 KST) — WCI 발표일
  workflow_dispatch:

jobs:
  weekly:
    runs-on: ubuntu-latest
    timeout-minutes: 40

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Collect rail (weekly)
        run: npm run collect:rail:weekly
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Collect ocean (weekly)
        run: npm run collect:ocean:weekly
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Curate rail (7d window)
        run: npm run curate:rail -- --window=7d
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Curate ocean (7d window)
        run: npm run curate:ocean -- --window=7d
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Generate newsletter HTML
        run: npm run newsletter:generate

      - name: Send weekly newsletter
        run: |
          TODAY=$(date +%Y-%m-%d)
          HTML_PATH="content/drafts/newsletter-${TODAY}.html"
          if [ -f "$HTML_PATH" ]; then
            node scripts/send-newsletter.js --html="$HTML_PATH"
          else
            echo "⚠️ HTML 없음 — 발송 스킵"
          fi
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          SEND_TO: ${{ secrets.INTERNAL_EMAIL }}
```

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/daily-newsletter.yml .github/workflows/weekly-newsletter.yml
git commit -m "feat(ci): add daily-newsletter.yml + weekly-newsletter.yml, remove daily-news.yml"
```

---

## Task 14: 최종 E2E 검증

- [ ] **Step 1: 수집기 smoke test (rail daily)**

```bash
ANTHROPIC_API_KEY=sk-... npm run collect:rail:daily 2>&1 | tail -5
```

Expected: `✅ rail_cn [daily]: N건 수집 완료` + `✅ rail_ops [daily]: N건 수집 완료`

- [ ] **Step 2: 수집기 smoke test (ocean daily)**

```bash
ANTHROPIC_API_KEY=sk-... npm run collect:ocean:daily 2>&1 | tail -5
```

Expected: `✅ carrier_advisories: N건 수집 완료` + `✅ ocean_news [daily]: N건 수집 완료` + `✅ chokepoints [daily]: N건 수집 완료`

- [ ] **Step 3: 큐레이션 테스트**

```bash
ANTHROPIC_API_KEY=sk-... npm run curate:rail && ANTHROPIC_API_KEY=sk-... npm run curate:ocean
```

Expected:
- `content/drafts/curated-rail.json` 생성
- `content/drafts/curated-ocean.json` 생성
- 각 파일의 `main.what` 길이 ≤ 200자 확인:

```bash
node -e "
const r = require('./content/drafts/curated-rail.json');
const o = require('./content/drafts/curated-ocean.json');
console.log('rail what 길이:', r.main.what.length, r.main.what.length <= 200 ? '✅' : '❌');
console.log('rail why_now 길이:', r.main.why_now.length, r.main.why_now.length <= 200 ? '✅' : '❌');
console.log('ocean what 길이:', o.main.what.length, o.main.what.length <= 200 ? '✅' : '❌');
console.log('rail mtl_point 없음:', !r.main.mtl_point ? '✅' : '❌');
"
```

- [ ] **Step 4: 뉴스레터 생성 테스트**

```bash
npm run newsletter:generate
```

```bash
node -e "
const fs = require('fs');
const TODAY = new Date().toISOString().slice(0,10);
const html = fs.readFileSync('content/drafts/newsletter-' + TODAY + '.html', 'utf-8');
const checks = {
  'Rail 섹션': html.includes('RAIL INTELLIGENCE'),
  'Ocean 섹션': html.includes('OCEAN INTELLIGENCE'),
  'MTL 영업 포인트 없음': !html.includes('MTL 영업 포인트'),
  '원문 링크 2개': (html.match(/원문 보기/g)||[]).length === 2,
  '추가 링크 4개': (html.match(/▶/g)||[]).length === 4,
};
Object.entries(checks).forEach(([k,v]) => console.log(v ? '✅' : '❌', k));
"
```

Expected: 모든 항목 ✅

- [ ] **Step 5: 최종 커밋**

```bash
git add .
git commit -m "feat: complete intelligence pipeline — rail + ocean + newsletter

- rail_cn.ts (8 Chinese sources + Claude translation)
- rail_ops.ts (10 Russian/CIS operator sources)
- carrier_advisories.ts (8 carriers, Playwright)
- ocean_news.ts (6 RSS sources)
- chokepoints.ts (UKMTO/Panama/BIMCO)
- port_stats.ts (LA/LB/Singapore -> Supabase)
- curate-rail.js + curate-ocean.js (Claude sonnet, 3 picks, 200 char limit)
- generate-newsletter.js (unified HTML, no MTL営業 point)
- daily-newsletter.yml + weekly-newsletter.yml
- remove daily-news.yml"
```
