// 글로벌 물류 매체 → maritime_news(lang='ja'). 일본판 뉴스의 소스.
//
// ■ 왜 일본 매체를 받지 않는가
// LNEWS·日本海事新聞·LOGISTICS TODAY 를 받다가 그만뒀다(2026-08).
// 일본 독자는 그 매체를 직접 본다. 요약을 한 번 거쳐 다시 보여줄 이유가 없다.
// 대신 한국판이 모아둔 영문 국제지(Container News·DC Velocity·gCaptain 등)를
// 받는다. 홍해·얼라이언스 개편·SCFI 같은 이야기는 일본 독자에게도 필요한데
// 일본어로는 잘 나오지 않는다. 여기가 실제로 값이 되는 자리다.
//
// ■ 한국어를 거치지 않는다
// 한국 풀에서는 원문 URL 만 받는다. 한국어 기사를 다시 옮기면 번역을 두 번
// 거치게 된다. 원문(영어)을 직접 읽고 일본어로 쓴다.
//
// ■ 무엇을 저장하는가
// 원문을 베끼지 않는다. 읽고 우리 문장으로 다시 쓴 기사를 저장한다.
// 한국판과 같은 형태다 — 제목·요지·본문·이미지·원문 링크.
// 기사 페이지 아래에 원문 링크를 두어 독자가 출처로 갈 수 있게 한다.
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
const { callDeepSeek } = require('../generators/lib/deepseek.js') as {
  callDeepSeek: (o: { system: string; messages: { role: string; content: string }[]; max_tokens?: number })
    => Promise<{ content: { type: string; text?: string }[] }>;
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 자체 기사는 제외한다 — generators/jp-news/translate.js 가 이미 일본어로 옮긴다. */
const EXCLUDE_SOURCES = ['Logisight'];

/** 며칠 치까지 거슬러 볼지. 너무 넓히면 오래된 기사가 새 기사처럼 올라온다. */
const LOOKBACK_DAYS = 14;

export type JpItem = {
  /** 한국판 행의 id. slug 를 만드는 데 쓴다. */
  koId: number;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
};

export type JpArticle = { title: string; summary: string; body: string };

const SYSTEM = [
  'あなたは日本の物流業界紙の記者である。英語の記事を読み、日本語の記事に書き起こす。',
  '',
  '[禁止] 原文を訳さない。読んで理解した内容を、日本の業界紙の文章として書き直す。',
  '入力に無い事実・数値・固有名詞を足さない。推測で補わない。',
  '「〜と思われる」「注目される」のような記者の感想を書かない。',
  '',
  '[見出し] 全角28字以内。何が起きたのかが分かる名詞句。煽らない。',
  '[要旨] 全角40〜70字の一文。一覧に出るので、これだけで用件が分かるようにする。',
  '[本文] 常体(だ・である)。段落4〜6、全角500〜800字。段落は空行で区切る。',
  '  1段落目に何が起きたのかを書く。以降に数値・当事者・背景・影響を置く。',
  '  小見出し・箇条書き・マークダウン記法は使わない。地の文だけで書く。',
  '',
  '社名・港名・指数名は日本の業界で通用する表記にする(例: Maersk→マースク、SCFI はそのまま)。',
  '出力は JSON のみ。{"title":"…","summary":"…","body":"…"} の形。前置きは書かない。',
].join('\n');

/**
 * 원문을 읽고 일본어 기사를 쓴다.
 *
 * 제목까지 만드는 이유: 한국판에 저장된 제목은 이미 한국어로 옮겨진 것이고,
 * 영문 원제를 그대로 두면 일본 독자가 목록에서 읽을 수 없다.
 */
export async function writeArticle(item: JpItem, body: string): Promise<JpArticle | null> {
  const text = body.slice(0, 5000);
  // 본문을 못 읽었으면 억지로 쓰지 않는다. 짧은 입력에 긴 기사를 요구하면
  // 모델이 없는 사실로 채운다.
  if (text.length < 300) return null;
  const user = `媒体: ${item.source}\n参考(韓国語版の見出し): ${item.title}\n\n原文:\n${text}`;
  const msg = await callDeepSeek({
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    max_tokens: 2600,
  });
  const raw = (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
  // 모델이 ```json 울타리를 두르는 경우가 있다.
  const j = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const o = JSON.parse(j) as Partial<JpArticle>;
    const title = (o.title || '').trim();
    const summary = (o.summary || '').trim();
    const text2 = (o.body || '').trim();
    if (title.length < 4 || summary.length < 20 || text2.length < 200) return null;
    return { title, summary, body: text2 };
  } catch {
    return null;
  }
}

/**
 * 기사 대표 이미지. og:image → twitter:image → JSON-LD 순으로 본다.
 * 없으면 null — 사이트가 이미지 없는 기사를 그대로 그린다.
 */
export async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const html = await r.text();
    const pick = (re: RegExp) => html.match(re)?.[1]?.trim() || null;
    const raw =
      pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
      ?? pick(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i);
    if (!raw) return null;
    // 상대 경로로 주는 매체가 있다. 절대 URL 로 만들어 두지 않으면 이미지가 깨진다.
    const abs = new URL(raw, url).toString();
    return /^https?:\/\//.test(abs) ? abs : null;
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
async function loadItems(sb: any): Promise<JpItem[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const { data, error } = await sb
    .from('maritime_news')
    .select('id,title,url,source,published_at,fetched_at')
    .eq('lang', 'ko')
    .not('source', 'in', `(${EXCLUDE_SOURCES.map((s) => `"${s}"`).join(',')})`)
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((r) => {
    const row = r as {
      id: number; title: string; url: string; source: string;
      published_at: string | null; fetched_at: string | null;
    };
    return {
      koId: row.id,
      title: row.title,
      url: row.url,
      source: row.source,
      publishedAt: row.published_at || row.fetched_at,
    };
  });
}

/**
 * slug 는 짧은 ASCII 로 만든다.
 *
 * 일본어 제목을 그대로 slug 에 넣으면 URL 이 퍼센트 인코딩으로 길어지고
 * 공유했을 때 읽을 수 없게 된다. 이미 한 번 겪어서 기존 일본어 기사도
 * n{원문ID} 형태를 쓰고 있다. 글로벌 기사는 g 를 붙여 구분한다.
 */
export function makeSlug(koId: number): string {
  return `g${koId}`;
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

  const items = await loadItems(sb);
  console.log(`  글로벌(한국판 수집분): ${items.length}건`);
  items.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

  // 이미 있는 원문 URL 은 건너뛴다. 기사 작성은 LLM 호출이라 중복은 그대로 비용이다.
  //
  // lang='ja' 로 좁히는 것이 핵심이다. 글로벌 기사의 원문 URL 은 한국어 행으로
  // 이미 존재하므로, 언어를 안 걸면 전부 "이미 있음"으로 걸러진다.
  // (유일키가 (url, lang) 이라 같은 URL 을 언어별로 가질 수 있다.)
  const urls = items.map((i) => i.url);
  const { data: seen } = await sb
    .from('maritime_news').select('url').eq('lang', 'ja').in('url', urls);
  const have = new Set(((seen ?? []) as { url: string }[]).map((r) => r.url));
  const unseen = items.filter((i) => !have.has(i.url));
  const fresh = unseen.slice(0, limit);

  // 중복 제거와 limit 절단을 따로 센다. 합쳐서 세면 limit 로 잘린 것을
  // "이미 있는 기사"로 읽게 되고, 중복 제거가 도는 줄로 오해한다.
  console.log(
    `📥 후보 ${items.length}건 · 기존 ${items.length - unseen.length}건 제외`
    + ` · 이번 회차 ${fresh.length}건${unseen.length > fresh.length ? ` (${unseen.length - fresh.length}건 이월)` : ''}`,
  );

  const res = { ok: 0, noBody: 0, error: 0 };
  for (const it of fresh) {
    try {
      const body = await rateLimited(it.url, () => fetchArticleBody(it.url));
      const art = await writeArticle(it, body || '');
      if (!art) { res.noBody++; console.warn(`⚠️ 본문 부족 — 건너뜀: ${it.title.slice(0, 40)}`); continue; }
      const image = await fetchOgImage(it.url);
      const row = {
        title: art.title,
        slug: makeSlug(it.koId),
        url: it.url,                 // 원문 링크. 기사 페이지 아래에 출처로 붙는다.
        source: it.source,
        published_at: it.publishedAt,
        summary: art.summary,
        content: art.body,
        image_url: image,
        image_source: image ? 'original' : null,
        image_credit: image ? it.source : null,
        lang: 'ja',
        category: categorize({ title: art.title }, '海上'),
        // 'brief' 라야 사이트가 자체 기사 페이지로 링크한다.
        // 'external' 이면 목록에서 원문으로 바로 튄다(isInternalNewsItem).
        agent_type: 'brief',
        fetched_at: new Date().toISOString(),
      };
      if (dryRun) {
        console.log(`· [dry] ${row.category} | ${row.title}`);
        console.log(`    ${art.summary}`);
        console.log(`    본문 ${art.body.length}자 · 이미지 ${image ? '있음' : '없음'} · /article/${row.slug}`);
        res.ok++; continue;
      }
      const { error } = await sb.from('maritime_news').upsert(row, { onConflict: 'url,lang' });
      if (error) { res.error++; console.error(`❌ ${art.title.slice(0, 30)}: ${error.message}`); }
      else { res.ok++; console.log(`✅ ${row.category} | ${row.title.slice(0, 40)} (${art.body.length}자${image ? ' · 이미지' : ''})`); }
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
