// 일본 물류 매체 → maritime_news(lang='ja'). 일본판 뉴스의 1차 소스.
//
// 지금까지 일본판 뉴스는 한국 기사를 번역한 것이었다. 사이트의 나머지는 전부
// 일본 원본 데이터(日銀 SPPI·国交省 港湾統計·財務省 貿易統計)인데 뉴스만
// 번역본이라 결이 어긋났다.
//
// ■ 무엇을 저장하는가
// 원문 본문은 저장하지 않는다. RSS는 배포를 전제로 공개된 것이지만 본문 전재는
// 별개 문제이고, 두 매체 모두 RSS에 본문을 넣지 않은 것 자체가 의사 표시다.
// 원문을 읽고 우리 문장으로 3~4문장 요약을 쓴 뒤, 그 요약과 원문 링크만 남긴다.
// 독자는 목록에서 요지를 보고 원문으로 간다.
//
// ■ 분류
// 카테고리는 코드가 정한다(jp_category). LLM에 맡기면 같은 기사가 실행마다
// 다른 칸에 들어간다.
//
// 실행: npx tsx collectors/news_jp.ts [--dry-run] [--limit=N]
import ws from 'ws';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = ws as unknown as never;
import { createClient } from '@supabase/supabase-js';

import { fetchArticleBody } from './utils/article_body';
import { rateLimited } from './utils/rate_limiter';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { categorize } = require('./utils/jp_category') as {
  categorize: (i: { title?: string; tags?: string[] }) => string;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseJpFeed } = require('./utils/jp_feed') as {
  parseJpFeed: (xml: string, source: string) => JpItem[];
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callDeepSeek } = require('../generators/lib/deepseek.js') as {
  callDeepSeek: (o: { system: string; messages: { role: string; content: string }[]; max_tokens?: number })
    => Promise<{ content: { type: string; text?: string }[] }>;
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const JP_FEEDS = [
  { source: 'LOGISTICS TODAY', url: 'https://www.logi-today.com/feed' },
  { source: 'LNEWS', url: 'https://www.lnews.jp/feed' },
];

export type JpItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  tags: string[];
  blurb: string;
};


const SYSTEM = [
  'あなたは日本の物流業界紙の記者である。渡された記事を読み、要旨を自分の言葉で書く。',
  '[書き方] 常体(だ・である)。3〜4文。全角180〜260字。',
  '1文目に何が起きたのかを書く。2文目以降に数値・当事者・背景を足す。',
  '[禁止] 原文の文をそのまま写さない。言い換えて書く。',
  '入力に無い事実・数値を足さない。推測で補わない。',
  '「〜と思われる」「注目される」のような記者の感想を書かない。',
  '見出しの繰り返しで終わらせない。読んだ人が原文を開くかどうか判断できる中身にする。',
  '出力は要旨の本文だけ。前置き・見出し・引用符は書かない。',
].join('\n');

/** 원문을 읽고 우리 문장으로 요약. 본문은 저장하지 않는다. */
export async function summarize(item: JpItem, body: string): Promise<string | null> {
  const text = body.slice(0, 4000);
  if (text.length < 120) return null; // 본문을 못 읽었으면 억지 요약을 만들지 않는다
  const user = `見出し: ${item.title}\n媒体: ${item.source}\n\n本文:\n${text}`;
  // 요약은 건수가 많아 비용이 걸린다. 판단이 아니라 압축이라 DeepSeek으로 충분하다.
  const msg = await callDeepSeek({ system: SYSTEM, messages: [{ role: 'user', content: user }], max_tokens: 1200 });
  const s = (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
  return s.length >= 60 ? s : null;
}

async function fetchFeed(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limArg ? Number(limArg.split('=')[1]) : 12;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE 환경변수 없음');
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY 미설정');
  const sb = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });

  const items: JpItem[] = [];
  for (const f of JP_FEEDS) {
    try {
      const got = parseJpFeed(await rateLimited(f.url, () => fetchFeed(f.url)), f.source);
      items.push(...got);
      console.log(`  ${f.source}: ${got.length}건`);
    } catch (e) {
      console.error(`❌ ${f.source} 피드 실패:`, (e as Error).message);
    }
  }
  items.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

  // 이미 있는 원문 URL은 건너뛴다. 요약은 LLM 호출이라 중복은 그대로 비용이다.
  const urls = items.map((i) => i.url);
  const { data: seen } = await sb.from('maritime_news').select('url').in('url', urls);
  const have = new Set((seen ?? []).map((r: { url: string }) => r.url));
  const unseen = items.filter((i) => !have.has(i.url));
  const fresh = unseen.slice(0, limit);
  // 중복 제거와 limit 절단을 따로 센다. 합쳐서 세면 limit로 잘린 것을
  // "이미 있는 기사"로 읽게 되고, 중복 제거가 도는 줄로 오해한다.
  console.log(
    `📥 피드 ${items.length}건 · 기존 ${items.length - unseen.length}건 제외`
    + ` · 이번 회차 ${fresh.length}건${unseen.length > fresh.length ? ` (limit ${limit}로 ${unseen.length - fresh.length}건 이월)` : ''}`,
  );

  const res = { ok: 0, noBody: 0, error: 0 };
  for (const it of fresh) {
    try {
      const body = await rateLimited(it.url, () => fetchArticleBody(it.url));
      const summary = await summarize(it, body || '');
      if (!summary) { res.noBody++; console.warn(`⚠️ 본문 부족 — 건너뜀: ${it.title.slice(0, 40)}`); continue; }
      const row = {
        title: it.title,
        url: it.url,                 // 원문 링크. 자체 기사 페이지를 만들지 않는다.
        source: it.source,
        published_at: it.publishedAt,
        summary,
        content: null,               // 본문은 저장하지 않는다
        lang: 'ja',
        category: categorize(it),
        agent_type: 'external', // 사이트의 기존 규약 — isInternalNewsItem이 이 값으로 외부 링크를 판단한다
        fetched_at: new Date().toISOString(),
      };
      if (dryRun) { console.log(`· [dry] ${row.category} | ${row.title.slice(0, 34)}\n    ${summary.slice(0, 90)}…`); res.ok++; continue; }
      const { error } = await sb.from('maritime_news').upsert(row, { onConflict: 'url' });
      if (error) { res.error++; console.error(`❌ ${it.title.slice(0, 30)}: ${error.message}`); }
      else { res.ok++; console.log(`✅ ${row.category} | ${row.title.slice(0, 42)}`); }
    } catch (e) {
      res.error++;
      console.error(`❌ ${it.title.slice(0, 30)}: ${(e as Error).message}`);
    }
  }
  console.log(`📊 저장 ${res.ok} · 본문부족 ${res.noBody} · 오류 ${res.error}${dryRun ? ' (DRY RUN)' : ''}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('news_jp 실패:', e.message); process.exit(1); });
}
