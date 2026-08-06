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
  categorize: (i: { title?: string; tags?: string[] }, fallback?: string) => string;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseJpFeed } = require('./utils/jp_feed') as {
  parseJpFeed: (xml: string, source: string) => JpItem[];
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseJmdList } = require('./utils/jmd_list') as {
  parseJmdList: (html: string) => JpItem[];
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

// RSS가 없어 목록 페이지를 읽는 곳. robots.txt의 * 블록에 제한이 없다.
// 해사 전문지라 海上·港湾·航空이 여기서 나온다 — RSS 두 곳은 국내 물류에 쏠려
// 9건 중 8건이 物流로 갔다.
export const JP_PAGES = [
  { source: '日本海事新聞', url: 'https://www.jmd.co.jp/news/', fallbackCategory: '海上' },
];

/**
 * 한국판이 이미 모아둔 글로벌 매체. 한국 뉴스가 아니라 영문 국제 매체다.
 * 홍해·얼라이언스 개편·SCFI 같은 이야기는 일본 독자에게도 그대로 필요하다.
 *
 * 자체 기사(source='Logisight')는 제외한다 — 그쪽은
 * generators/jp-news/translate.js 가 이미 일본어로 옮기고 있다.
 */
const GLOBAL_EXCLUDE_SOURCES = ['Logisight'];

/** 며칠 치까지 거슬러 볼지. 너무 넓히면 오래된 기사가 새 기사처럼 올라온다. */
const GLOBAL_LOOKBACK_DAYS = 14;

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
  '1文目に何が起きたのかを書く。2文目以降に数値・当事者・背景を足す。',
  '[禁止] 原文の文をそのまま写さない。言い換えて書く。',
  '入力に無い事実・数値を足さない。推測で補わない。',
  '「〜と思われる」「注目される」のような記者の感想を書かない。',
  '見出しの繰り返しで終わらせない。読んだ人が原文を開くかどうか判断できる中身にする。',
  '出力は要旨の本文だけ。前置き・見出し・引用符は書かない。',
].join('\n');

/**
 * 원문을 읽고 우리 문장으로 요약. 본문은 저장하지 않는다.
 *
 * 요구 분량을 입력 길이에 맞춘다. 日本海事新聞은 리드 문단까지만 공개하고 그
 * 뒤는 구독제다. 짧은 입력에 긴 요약을 요구하면 모델이 없는 사실로 채운다.
 */
export async function summarize(item: JpItem, body: string): Promise<string | null> {
  const text = body.slice(0, 4000);
  if (text.length < 120) return null; // 본문을 못 읽었으면 억지 요약을 만들지 않는다
  const shape = text.length < 400
    ? '[書き方] 常体(だ・である)。2〜3文。全角100〜160字。入力が短いので無理に長くしない。'
    : '[書き方] 常体(だ・である)。3〜4文。全角180〜260字。';
  const user = `${shape}\n\n見出し: ${item.title}\n媒体: ${item.source}\n\n本文:\n${text}`;
  // 요약은 건수가 많아 비용이 걸린다. 판단이 아니라 압축이라 DeepSeek으로 충분하다.
  const msg = await callDeepSeek({ system: SYSTEM, messages: [{ role: 'user', content: user }], max_tokens: 1200 });
  const s = (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
  return s.length >= 60 ? s : null;
}

/**
 * 글로벌 기사는 원문이 영어다. 한국어 행을 다시 옮기면 번역을 두 번 거치게 되므로,
 * 원문을 읽어 일본어 제목과 요지를 한 번에 만든다.
 *
 * 제목까지 만드는 이유: 한국판에 저장된 제목은 이미 한국어로 옮겨진 것이고,
 * 영문 원제를 그대로 두면 일본 독자가 목록에서 읽을 수 없다.
 */
const GLOBAL_SYSTEM = [
  'あなたは日本の物流業界紙の記者である。英語の記事を読み、日本語で見出しと要旨を書く。',
  '見出しは全角28字以内。何が起きたのかが分かる名詞句にする。煽らない。',
  '要旨は常体(だ・である)で3〜4文、全角180〜260字。',
  '1文目に何が起きたのかを書く。2文目以降に数値・当事者・背景を足す。',
  '[禁止] 原文を直訳しない。日本の業界紙の言い回しに置き換える。',
  '入力に無い事実・数値を足さない。推測で補わない。',
  '社名・港名・指数名は日本の業界で通用する表記にする(例: Maersk→マースク、SCFI はそのまま)。',
  '出力は JSON のみ。{"title":"…","summary":"…"} の形。前置きは書かない。',
].join('\n');

export async function summarizeGlobal(
  item: JpItem,
  body: string,
): Promise<{ title: string; summary: string } | null> {
  const text = body.slice(0, 4000);
  if (text.length < 120) return null;
  const user = `媒体: ${item.source}\n参考(韓国語版の見出し): ${item.title}\n\n原文:\n${text}`;
  const msg = await callDeepSeek({
    system: GLOBAL_SYSTEM,
    messages: [{ role: 'user', content: user }],
    max_tokens: 1200,
  });
  const raw = (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
  // 모델이 ```json 울타리를 두르는 경우가 있다.
  const j = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const o = JSON.parse(j) as { title?: string; summary?: string };
    const title = (o.title || '').trim();
    const summary = (o.summary || '').trim();
    return title.length >= 4 && summary.length >= 60 ? { title, summary } : null;
  } catch {
    return null;
  }
}

/**
 * 한국판이 모아둔 글로벌 매체 기사 목록. 원문 URL만 가져오고 본문은 여기서 읽지 않는다.
 * 날짜가 비어 있는 행이 있어 fetched_at 으로 메운다 — 비워두면 목록 정렬이 무너진다.
 */
// createClient 의 반환 타입은 제네릭이 깊어, 구조적으로 좁히면 오히려
// "type instantiation is excessively deep" 로 터진다. 파일 상단의 다른
// require 들과 같은 방식으로 느슨하게 받고 결과만 좁힌다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadGlobalItems(sb: any): Promise<JpItem[]> {
  const since = new Date(Date.now() - GLOBAL_LOOKBACK_DAYS * 86400_000).toISOString();
  const { data, error } = await sb
    .from('maritime_news')
    .select('title,url,source,published_at,fetched_at,category')
    .eq('lang', 'ko')
    .not('source', 'in', `(${GLOBAL_EXCLUDE_SOURCES.map((s) => `"${s}"`).join(',')})`)
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((r) => {
    const row = r as {
      title: string; url: string; source: string;
      published_at: string | null; fetched_at: string | null;
    };
    return {
      title: row.title,
      url: row.url,
      source: row.source,
      publishedAt: row.published_at || row.fetched_at,
      tags: [],
      blurb: '',
    };
  });
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
  // 일본 매체만 돌리고 싶을 때. 글로벌은 한국판 수집분에 의존하므로 따로 끌 수 있어야 한다.
  const noGlobal = process.argv.includes('--no-global');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE 환경변수 없음');
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY 미설정');
  const sb = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });

  const items: (JpItem & { fallbackCategory?: string })[] = [];
  for (const f of JP_FEEDS) {
    try {
      const got = parseJpFeed(await rateLimited(f.url, () => fetchFeed(f.url)), f.source);
      items.push(...got);
      console.log(`  ${f.source}: ${got.length}건`);
    } catch (e) {
      console.error(`❌ ${f.source} 피드 실패:`, (e as Error).message);
    }
  }
  for (const p of JP_PAGES) {
    try {
      // 날짜가 없는 항목은 기사가 아니라 지수·섹션 링크다(예: '上海発コンテナ運賃(SCFI)').
      const got = parseJmdList(await rateLimited(p.url, () => fetchFeed(p.url)))
        .filter((x) => x.publishedAt)
        .map((x) => ({ ...x, fallbackCategory: p.fallbackCategory }));
      items.push(...got);
      console.log(`  ${p.source}: ${got.length}건`);
    } catch (e) {
      console.error(`❌ ${p.source} 목록 실패:`, (e as Error).message);
    }
  }
  // 한국판이 모아둔 글로벌 매체. 일본 매체가 다루지 않는 국제 이슈가 여기서 온다.
  const globalItems: JpItem[] = [];
  if (!noGlobal) {
    try {
      const got = await loadGlobalItems(sb);
      globalItems.push(...got);
      console.log(`  글로벌(한국판 수집분): ${got.length}건`);
    } catch (e) {
      console.error('❌ 글로벌 목록 실패:', (e as Error).message);
    }
  }

  items.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  globalItems.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

  // 이미 있는 원문 URL은 건너뛴다. 요약은 LLM 호출이라 중복은 그대로 비용이다.
  //
  // lang='ja' 로 좁히는 것이 핵심이다. 글로벌 기사의 원문 URL 은 한국어 행으로
  // 이미 존재하므로, 언어를 안 걸면 전부 "이미 있음"으로 걸러진다.
  // (유일키가 (url, lang) 이라 같은 URL 을 언어별로 가질 수 있다.)
  const urls = [...items, ...globalItems].map((i) => i.url);
  const { data: seen } = await sb
    .from('maritime_news').select('url').eq('lang', 'ja').in('url', urls);
  const have = new Set((seen ?? []).map((r: { url: string }) => r.url));
  const unseen = items.filter((i) => !have.has(i.url));
  const unseenGlobal = globalItems.filter((i) => !have.has(i.url));

  // 회차 예산을 둘로 나눈다. 한쪽이 많다고 다른 쪽을 굶기지 않는다 —
  // 글로벌만 200건 대기하는 날에 일본 매체 신착이 계속 밀리면
  // 정작 일본 독자가 볼 국내 기사가 며칠씩 안 올라온다.
  const jpQuota = Math.ceil(limit * 0.6);
  const fresh = unseen.slice(0, jpQuota);
  const freshGlobal = unseenGlobal.slice(0, limit - fresh.length);

  // 중복 제거와 limit 절단을 따로 센다. 합쳐서 세면 limit로 잘린 것을
  // "이미 있는 기사"로 읽게 되고, 중복 제거가 도는 줄로 오해한다.
  const carry = (unseen.length - fresh.length) + (unseenGlobal.length - freshGlobal.length);
  console.log(
    `📥 일본매체 ${items.length}건 · 글로벌 ${globalItems.length}건`
    + ` · 기존 ${(items.length - unseen.length) + (globalItems.length - unseenGlobal.length)}건 제외`
    + ` · 이번 회차 일본 ${fresh.length} + 글로벌 ${freshGlobal.length}${carry ? ` (${carry}건 이월)` : ''}`,
  );

  const res = { ok: 0, noBody: 0, error: 0 };
  for (const it of fresh) {
    try {
      // 목록에 리드가 있으면 그것으로 충분하다 — 기사 페이지를 또 열 이유가 없다.
      const body = it.blurb && it.blurb.length >= 120
        ? it.blurb
        : await rateLimited(it.url, () => fetchArticleBody(it.url));
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
        category: categorize(it, it.fallbackCategory),
        agent_type: 'external', // 사이트의 기존 규약 — isInternalNewsItem이 이 값으로 외부 링크를 판단한다
        fetched_at: new Date().toISOString(),
      };
      if (dryRun) { console.log(`· [dry] ${row.category} | ${row.title.slice(0, 34)}\n    ${summary.slice(0, 90)}…`); res.ok++; continue; }
      const { error } = await sb.from('maritime_news').upsert(row, { onConflict: 'url,lang' });
      if (error) { res.error++; console.error(`❌ ${it.title.slice(0, 30)}: ${error.message}`); }
      else { res.ok++; console.log(`✅ ${row.category} | ${row.title.slice(0, 42)}`); }
    } catch (e) {
      res.error++;
      console.error(`❌ ${it.title.slice(0, 30)}: ${(e as Error).message}`);
    }
  }

  // 글로벌 기사. 원문이 영어라 제목까지 새로 만든다.
  for (const it of freshGlobal) {
    try {
      const body = await rateLimited(it.url, () => fetchArticleBody(it.url));
      const out = await summarizeGlobal(it, body || '');
      if (!out) { res.noBody++; console.warn(`⚠️ 본문 부족 — 건너뜀: ${it.title.slice(0, 40)}`); continue; }
      const row = {
        title: out.title,
        url: it.url,                 // 원문 링크. 독자를 원문으로 보낸다.
        source: it.source,
        published_at: it.publishedAt,
        summary: out.summary,
        content: null,
        lang: 'ja',
        category: categorize({ title: out.title }, '海上'),
        agent_type: 'external',
        fetched_at: new Date().toISOString(),
      };
      if (dryRun) { console.log(`· [dry/글로벌] ${row.category} | ${row.title.slice(0, 34)}\n    ${out.summary.slice(0, 90)}…`); res.ok++; continue; }
      const { error } = await sb.from('maritime_news').upsert(row, { onConflict: 'url,lang' });
      if (error) { res.error++; console.error(`❌ ${out.title.slice(0, 30)}: ${error.message}`); }
      else { res.ok++; console.log(`🌐 ${row.category} | ${row.title.slice(0, 42)}`); }
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
