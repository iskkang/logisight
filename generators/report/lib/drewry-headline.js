'use strict';
// Drewry Cancelled Sailings Tracker — 헤드라인 1문장 경량 추출 (Playwright 불필요)
// 용도: 블랭크 세일링 블록의 헤드라인 수치(결항 "편수"/East-West 항로)를 Drewry로 인용.
// 출처: https://www.drewry.co.uk/.../cancelled-sailings-tracker
//   메타 description 에 "Across major East–West trades, M blank sailings ... out of N scheduled departures" 노출.

const TRACKER_URL =
  'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/cancelled-sailings-tracker';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function decodeEntities(s) {
  return String(s || '')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#x28;/gi, '(').replace(/&#x29;/gi, ')')
    .replace(/&#x3a;/gi, ':').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#x2013;/gi, '–')
    .replace(/&#x25;/gi, '%');
}

// HTML에서 헤드라인 추출 — title(발행일) + meta description(수치 문장)
function parseHeadline(html) {
  const clean = decodeEntities(html.replace(/\s+/g, ' '));

  // 발행일: <title>... Cancelled Sailings Tracker - 29 May</title>
  let asOf = null;
  const titleM = clean.match(/Cancelled Sailings Tracker[^<]*?-\s*([0-9]{1,2}\s+[A-Za-z]+(?:\s+[0-9]{4})?)/i);
  if (titleM) asOf = titleM[1].trim();

  // 수치 문장: meta description
  const descM = clean.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const desc  = descM ? decodeEntities(descM[1]).trim() : null;
  if (!desc) return null;

  // M blank sailings ... out of N scheduled departures
  const cntM = desc.match(/([0-9,]+)\s+blank sailings/i);
  const schM = desc.match(/out of\s+([0-9,]+)\s+scheduled departures/i);
  const blank     = cntM ? parseInt(cntM[1].replace(/,/g, ''), 10) : null;
  const scheduled = schM ? parseInt(schM[1].replace(/,/g, ''), 10) : null;
  // 비율: scheduled가 있으면 계산, 없으면 문장에 명시된 "N% cancellation rate" 직접 인용.
  const rateM = desc.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s+cancellation rate/i);
  const pct = (blank != null && scheduled && scheduled > 0)
    ? parseFloat(((blank / scheduled) * 100).toFixed(1))
    : (rateM ? parseFloat(rateM[1]) : null);

  // 향후 N주 horizon ("next five weeks" / "next 5 weeks" → 숫자)
  const WORD_NUM = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
  const wkM = desc.match(/next\s+([a-z0-9]+)\s+weeks/i);
  let horizon = null;
  if (wkM) {
    const w = wkM[1].toLowerCase();
    horizon = /^\d+$/.test(w) ? Number(w) : (WORD_NUM[w] ?? null);
  }

  return { asOf, sentence: desc, blank, scheduled, pct, horizon };
}

async function buildDrewryHeadline() {
  try {
    const r = await fetch(TRACKER_URL, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const parsed = parseHeadline(html);
    if (!parsed || parsed.blank == null) {
      console.warn('  drewry-headline: 헤드라인 파싱 실패 (구조 변경 가능)');
      return null;
    }
    console.log('  drewry-headline: OK (' + parsed.blank + '편/' + parsed.scheduled + '편, ' + parsed.asOf + ')');
    return { ...parsed, source: 'Drewry Cancelled Sailings Tracker', url: TRACKER_URL };
  } catch (e) {
    console.warn('  drewry-headline: 실패 —', e.message);
    return null;
  }
}

module.exports = { buildDrewryHeadline, TRACKER_URL };
