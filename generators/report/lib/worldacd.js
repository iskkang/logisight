'use strict';
// WorldACD Weekly Air Cargo Trends — 구조화 주간 데이터 파싱.
// 출처: https://www.worldacd.com/feed/ (RSS) → 최신 "Weekly Air Cargo Trends" 포스트.
// 목적: section-runner의 WorldACD 강제 스트립을 *검증된 실데이터*로 대체(스트립 해제).
//
// ⚠️ 본문이 prose라 파서가 fragile하다. 못 잡은 값은 null(더미 금지). 전부 null이면 null 반환
//    → section-runner는 worldacdTable이 없으면 기존 스트립 유지(무회귀).
// ⚠️ worldacd.com은 샌드박스 네트워크 차단 → 로컬 테스트 필수. 파싱 깨지면 표 미표시(스트립 유지).
//
// 본문 패턴(실제 포스트, 2026):
//   "average worldwide spot rates rose by a further +3% in week 15 (6 to 12 April) to US$3.76 per kilo,
//    taking them +37% higher than this time last year"
//   "average global full-market air cargo rates ... to US$2.98"
//   "Worldwide air cargo tonnage in week 13 (23-29 March) was unchanged" / "volumes recorded a +4% WoW"

const path = require('path');
const fs   = require('fs');

const CACHE_PATH = path.resolve(__dirname, '../../../outputs/cache/worldacd.json');
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;
const RSS_URL    = 'https://www.worldacd.com/feed/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SOURCE = 'WorldACD Market Data';

// ── Cache I/O ─────────────────────────────────────────────────────────────────
function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (Date.now() - new Date(raw.fetched_at).getTime() > CACHE_TTL) return null;
    return raw;
  } catch (_) { return null; }
}
function loadCacheRaw() {
  try { return fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) : null; }
  catch (_) { return null; }
}
function saveCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ fetched_at: new Date().toISOString(), ...payload }, null, 2), 'utf-8');
  } catch (e) { console.warn('  worldacd: 캐시 저장 실패:', e.message); }
}

async function fetchText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/rss+xml,*/*' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.warn('  worldacd: HTTP ' + r.status + ' ← ' + url); return null; }
    return await r.text();
  } catch (e) { console.warn('  worldacd: fetch 오류 — ' + e.message); return null; }
}
function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#8217;|&#039;|&rsquo;/g, "'").replace(/\s+/g, ' ');
}

// RSS에서 최신 "Weekly Air Cargo Trends" 포스트 링크 추출.
function latestWeeklyLink(rssXml) {
  if (!rssXml) return null;
  const items = rssXml.split(/<item>/i).slice(1);
  for (const it of items) {
    const title = (it.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    if (/weekly air cargo trends/i.test(title)) {
      const link = (it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
      const url = link.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      if (url) return url;
    }
  }
  return null;
}

// 본문 텍스트에서 글로벌 지표만 보수적으로 추출(못 잡으면 null).
function parseWeeklyPost(text) {
  const out = { week_no: null, period: null, spot_usd_kg: null, spot_wow_pct: null, spot_yoy_pct: null, fullmarket_usd_kg: null, tonnage_note: null };

  const wk = text.match(/week\s+(\d+)\s*\(([^)]+)\)/i);
  if (wk) { out.week_no = parseInt(wk[1], 10); out.period = wk[2].trim(); }

  // spot rate: "average worldwide spot rates ... to US$X per kilo"
  const spot = text.match(/average\s+worldwide\s+spot\s+rates([\s\S]{0,160}?)US\$([\d.]+)\s*per\s*kil/i);
  if (spot) {
    out.spot_usd_kg = parseFloat(spot[2]);
    const seg = spot[1];
    const wow = seg.match(/(?:rose|increased|up|climbed)\s+by\s+(?:a\s+further\s+)?\+?([\d.]+)\s*%/i)
             || seg.match(/(?:slipped|fell|dropped|down)\s+(?:by\s+)?(?:a\s+further\s+)?-?([\d.]+)\s*%/i);
    if (wow) out.spot_wow_pct = /slip|fell|drop|down/i.test(seg) ? -parseFloat(wow[1]) : parseFloat(wow[1]);
    const yoy = text.match(/spot\s+rates[\s\S]{0,120}?([+-]?\d+)\s*%\s+higher\s+than\s+(?:this\s+time\s+)?last\s+year/i)
             || text.match(/taking\s+them\s+([+-]?\d+)\s*%\s+higher\s+than\s+(?:this\s+time\s+)?last\s+year/i);
    if (yoy) out.spot_yoy_pct = parseFloat(yoy[1]);
  }

  // full-market rate
  const fm = text.match(/full-market\s+(?:air\s+cargo\s+)?rates[\s\S]{0,120}?US\$([\d.]+)/i);
  if (fm) out.fullmarket_usd_kg = parseFloat(fm[1]);

  // 2026 포맷 폴백: "airfreight rate in week 22 climbed +2% WoW to US$3.29" (구 'spot rates per kilo' 표현 폐지)
  if (out.spot_usd_kg == null) {
    const ar = text.match(/airfreight\s+rate\s+in\s+week\s+(\d+)\s+(climbed|rose|increased|jumped|gained|fell|dropped|declined|slipped|decreased|eased)\s+([+-]?[\d.]+)\s*%\s+WoW\s+to\s+US\$([\d.]+)/i);
    if (ar) {
      if (out.week_no == null) out.week_no = parseInt(ar[1], 10);
      out.spot_usd_kg = parseFloat(ar[4]);
      const down = /fell|dropped|declined|slipped|decreased|eased/i.test(ar[2]);
      out.spot_wow_pct = (down ? -1 : 1) * Math.abs(parseFloat(ar[3]));
    }
  }

  // tonnage WoW 방향(서사용)
  const tonUnchanged = /[Ww]orldwide\s+air\s+cargo\s+tonnage[\s\S]{0,80}?unchanged/i.test(text);
  const tonMove = text.match(/[Ww]orldwide\s+(?:air\s+cargo\s+)?(?:tonnage|volumes)[\s\S]{0,80}?([+-]\d+)\s*%\s*(?:WoW|week-on-week)/i);
  if (tonUnchanged) out.tonnage_note = '물동량 WoW 보합';
  else if (tonMove) out.tonnage_note = `물동량 WoW ${tonMove[1]}%`;

  // 유효성: 적어도 spot 또는 full-market 가격 하나는 있어야 함
  if (out.spot_usd_kg == null && out.fullmarket_usd_kg == null) return null;
  return out;
}

// ── Trend (spot rate 주간 누적, 최근 8주) ────────────────────────────────────────
function mergeTrend(cur, oldCache) {
  const old = Array.isArray(oldCache && oldCache.trend) ? oldCache.trend : [];
  const key = cur.week_no != null ? `W${cur.week_no}` : (cur.period || new Date().toISOString().slice(0, 10));
  const pt = { week: key, spot_usd_kg: cur.spot_usd_kg };
  const byWk = {};
  for (const p of [...old, pt]) if (p.spot_usd_kg != null) byWk[p.week] = p;
  return Object.values(byWk).slice(-8);
}

function buildTable(d) {
  const f = (x, suf) => (x == null ? '—' : (suf === '%' ? (x >= 0 ? '▲' : '▼') + Math.abs(x).toFixed(0) + '%' : '$' + x.toFixed(2)));
  const rows = [];
  if (d.spot_usd_kg != null)       rows.push(`| 글로벌 스팟 운임 | ${f(d.spot_usd_kg)}/kg | ${f(d.spot_wow_pct, '%')} | ${f(d.spot_yoy_pct, '%')} YoY |`);
  if (d.fullmarket_usd_kg != null) rows.push(`| 글로벌 종합(full-market) 운임 | ${f(d.fullmarket_usd_kg)}/kg | — | — |`);
  if (!rows.length) return null;
  const wk = d.week_no != null ? `week ${d.week_no}${d.period ? ` (${d.period})` : ''}` : (d.period || '');
  return [
    '| 지표 | 값 | WoW | YoY |',
    '|------|----|-----|-----|',
    ...rows,
    '',
    `※ ${wk} 기준. 출처: [${SOURCE}](https://www.worldacd.com/).${d.tonnage_note ? ' ' + d.tonnage_note + '.' : ''}`,
  ].join('\n');
}

function buildChartData(trend) {
  if (!trend || trend.length < 2) return null;
  return {
    labels: trend.map(p => p.week),
    datasets: [{
      label: 'WorldACD 글로벌 스팟 운임 (USD/kg)',
      data: trend.map(p => p.spot_usd_kg),
      borderColor: '#1E3A5F', backgroundColor: 'rgba(30,58,95,0.1)',
      borderWidth: 2, pointRadius: 3, tension: 0.25, spanGaps: true, fill: true,
    }],
  };
}

function buildFactText(d) {
  const lines = ['WorldACD 주간 항공화물(글로벌):'];
  if (d.spot_usd_kg != null)       lines.push(`스팟 운임 $${d.spot_usd_kg.toFixed(2)}/kg (WoW ${d.spot_wow_pct ?? '—'}%, YoY ${d.spot_yoy_pct ?? '—'}%)`);
  if (d.fullmarket_usd_kg != null) lines.push(`종합 운임 $${d.fullmarket_usd_kg.toFixed(2)}/kg`);
  if (d.tonnage_note)              lines.push(d.tonnage_note);
  if (d.week_no != null)           lines.push(`(week ${d.week_no}, 출처 ${SOURCE})`);
  return lines.length > 1 ? lines.join('\n') : null;
}

// ISO 8601 year-week
function isoYearWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;            // Mon=0
  t.setUTCDate(t.getUTCDate() - day + 3);          // 목요일로
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { year: t.getUTCFullYear(), week };
}

// 최신 주간 트렌드 포스트 URL: 1) RSS, 2) 실패 시 발행지연 고려해 최근 4주 슬러그 직접 시도.
async function findLatestWeeklyUrl() {
  const rss = await fetchText(RSS_URL);
  const fromRss = latestWeeklyLink(rss);
  if (fromRss) return fromRss;

  const { year, week } = isoYearWeek(new Date());
  for (let i = 0; i < 4; i++) {
    let y = year, w = week - i;
    if (w < 1) { y -= 1; w += 52; }
    const url = `https://www.worldacd.com/trend-reports/weekly/worldacd-weekly-air-cargo-trends-${y}-week-${w}/`;
    const html = await fetchText(url);
    if (html && /weekly air cargo trends/i.test(html)) { console.log(`  worldacd: 주차 URL 매치 week ${w}`); return url; }
  }
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function buildWorldACD({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) { console.log('  worldacd: 캐시 사용 (' + cached.as_of + ')'); return cached; }
  }

  const link = await findLatestWeeklyUrl();
  if (!link) { console.warn('  worldacd: 주간 트렌드 포스트 미발견(RSS·URL 모두) — null(스트립 유지)'); return null; }

  const html = await fetchText(link);
  if (!html) return null;
  const parsed = parseWeeklyPost(stripHtml(html));
  if (!parsed) { console.warn('  worldacd: 본문 파싱 실패 — null(스트립 유지)'); return null; }

  const trend = mergeTrend(parsed, loadCacheRaw());
  const data  = { as_of: new Date().toISOString().slice(0, 10), source: SOURCE, url: link, ...parsed, trend };
  const table     = buildTable(data);
  const chartData = buildChartData(trend);
  const factText  = buildFactText(data);

  if (!table) { console.warn('  worldacd: 표 생성 불가 — null'); return null; }
  const payload = { ...data, table, chartData, factText };
  saveCache(payload);
  console.log(`  worldacd: 완료 (week ${parsed.week_no}, spot $${parsed.spot_usd_kg}/kg)`);
  return payload;
}

module.exports = { buildWorldACD, parseWeeklyPost, latestWeeklyLink, CACHE_PATH };