'use strict';
// 日本海事新聞(jmd.co.jp) 목록 파싱.
//
// RSS가 없어 목록 페이지를 읽는다. robots.txt는 * 블록에 제한이 없다.
// 기사 본문은 구독제라 열지 않는다 — 목록에 공개된 리드 문단만 쓴다.
// 그 리드를 근거로 우리 문장의 요약을 쓰고, 원문으로 링크한다.
//
// 블록 모양:
//   <article>
//     <span class="font-bold">2026年08月05日付&nbsp;主要ニュース</span>
//     <time pubdate="2026/08/05 00:00">…</time>
//     <h1 class="kiji-index--headline--top--title"><a href="article.php?no=317619">제목</a></h1>
//     <p>리드…</p>
//   </article>

const BASE = 'https://www.jmd.co.jp/';

const text = (s) => String(s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

/** "2026/08/05 00:00" → ISO. 일본 시간대로 읽는다(사이트가 JST 표기다). */
function toIso(pubdate) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?/.exec(String(pubdate || '').trim());
  if (!m) return null;
  const [, y, mo, d, hh = '00', mm = '00'] = m;
  const t = new Date(`${y}-${mo}-${d}T${hh}:${mm}:00+09:00`);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

/**
 * @param {string} html 목록 페이지 HTML
 * @returns {{title:string,url:string,source:string,publishedAt:string|null,tags:string[],blurb:string}[]}
 */
/**
 * 목록에는 두 가지 모양이 섞여 있다.
 *  1) 톱기사 — <article> 블록. 리드 문단까지 있다.
 *  2) 나머지 — <h3><a href="article.php?no=…"><span class="…kiji_date">날짜</span>
 *     <span class="…kiji_title_block_title">제목</span> — 리드가 없다.
 * 2를 놓치면 하루 1건만 걷힌다(실제로 54건 중 1건만 잡혔다).
 *
 * @param {string} html 목록 페이지 HTML
 * @returns {{title:string,url:string,source:string,publishedAt:string|null,tags:string[],blurb:string}[]}
 */
function parseJmdList(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<article[\s>][\s\S]*?<\/article>/gi)) {
    const b = m[0];
    const link = /<a[^>]+href="(article\.php\?no=\d+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!link) continue;
    const url = BASE + link[1];
    if (seen.has(url)) continue;   // 같은 기사가 목록에 두 번 나오는 자리가 있다
    seen.add(url);

    const title = text(link[2]);
    if (!title) continue;

    const time = /<time[^>]+pubdate="([^"]+)"/i.exec(b);
    // 섹션 라벨: "2026年08月05日付 主要ニュース" 에서 날짜를 떼고 남는 말.
    const label = /<span[^>]*class="[^"]*font-bold[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(b);
    const tag = label ? text(label[1]).replace(/^\d{4}年\d{2}月\d{2}日付\s*/, '').trim() : '';

    const lead = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(b);
    out.push({
      title,
      url,
      source: '日本海事新聞',
      publishedAt: time ? toIso(time[1]) : null,
      tags: tag ? [tag] : [],
      blurb: lead ? text(lead[1]).replace(/…$/, '') : '',
    });
  }

  // 2) 카테고리 목록 항목. 리드가 없어 blurb는 비운다 — 수집기가 기사 페이지의
  //    공개 리드를 따로 읽는다.
  for (const m of String(html).matchAll(/<a[^>]+href="(article\.php\?no=\d+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
    const url = BASE + m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    const inner = m[2];
    const t = /class="[^"]*kiji_title_block_title[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
    const title = text(t ? t[1] : inner);
    if (!title || title.length < 6) continue;
    const d = /class="[^"]*kiji_date[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
    out.push({
      title,
      url,
      source: '日本海事新聞',
      publishedAt: d ? toIso(text(d[1])) : null,
      tags: [],
      blurb: '',
    });
  }
  return out;
}

module.exports = { parseJmdList, toIso, BASE };
