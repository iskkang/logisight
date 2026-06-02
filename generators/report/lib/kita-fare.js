'use strict';
// KITA 참고운임 수집기 (해상)
// 입력: generators/report/config/kita-fare.json
// 출력: outputs/cache/kita-fare-sea.json
//
// 수집 흐름:
//   1. GET  {page.sea}                   → JSESSIONID_KITA 세션 쿠키
//   2. POST {endpoints.codeView}         → destCode 자동 매핑 (config에 없을 때)
//   3. POST {endpoints.chartData}        → 월별 운임·지수 시계열 (TEU·FEU 각각)
//   4. 캐시 저장 (TTL 24h, --force 갱신)

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const CONFIG_PATH = path.resolve(__dirname, '../config/kita-fare.json');
const CACHE_PATH  = path.resolve(__dirname, '../../../outputs/cache/kita-fare-sea.json');
const CACHE_TTL   = 24 * 60 * 60 * 1000; // 24 h

const cfg  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const BASE = cfg.base;
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomDelay() {
  return sleep(800 + Math.floor(Math.random() * 700)); // 0.8~1.5 s
}

function extractCookie(headers) {
  const raw = headers.get('set-cookie') || '';
  // Capture all cookie pairs from a (potentially multi-value) Set-Cookie header
  const pairs = [];
  const re = /([A-Z_]+SESSION[A-Z_]*)=([^;,\s]+)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) pairs.push(m[1] + '=' + m[2]);
  // Prefer JSESSIONID_KITA; fall back to first JSESSIONID
  return pairs.find(p => /JSESSIONID_KITA/i.test(p)) || pairs[0] || '';
}

// ── Period calculation ────────────────────────────────────────────────────────

function getPeriodParams() {
  const now        = new Date();
  const monthsBack = cfg.period.monthsBack || 13;
  const endYear    = now.getFullYear();
  const endMonth   = now.getMonth() + 1;   // 1-based

  let startYear  = endYear;
  let startMonth = endMonth - monthsBack;
  while (startMonth <= 0) { startMonth += 12; startYear--; }

  const pad = function(n) { return String(n).padStart(2, '0'); };
  return {
    searchYear:   String(startYear),
    searchMonth:  pad(startMonth),
    searchYear2:  String(endYear),
    searchMonth2: pad(endMonth),
  };
}

// ── Step 1: session ───────────────────────────────────────────────────────────

async function getSession() {
  const r = await fetch(BASE + cfg.page.sea, {
    headers: {
      'User-Agent':      UA,
      'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    redirect: 'follow',
    signal:   AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('KITA 세션 GET 실패: HTTP ' + r.status);
  const cookie = extractCookie(r.headers);
  if (!cookie) console.warn('  kita-fare: 세션 쿠키 없음 — 쿠키 없이 진행');
  return cookie;
}

// ── Step 2: codeView (destCode 자동 매핑) ─────────────────────────────────────

async function getDestCodes(cookie, regionCode, isIncheon) {
  const body = { code: regionCode };
  if (isIncheon) body.incheonYn = 'Y';

  const r = await fetch(BASE + cfg.endpoints.codeView, {
    method:  'POST',
    headers: {
      'User-Agent':       UA,
      'Content-Type':     'application/json',
      'Accept':           'application/json',
      'Referer':          BASE + cfg.page.sea,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie':           cookie,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('codeView HTTP ' + r.status);

  const data = await r.json();

  if (process.env.KITA_DEBUG) {
    console.log('  [codeView dump]', JSON.stringify(data).slice(0, 400));
  }

  // Normalise — KITA may return {detailView:[...]}, [{codeNm,code}], etc.
  const list = Array.isArray(data)
    ? data
    : (data.detailView || data.data || data.list || []);

  const map = {};
  for (const item of list) {
    const name = item.codeNm || item.codeEn || item.name || item.detailName || '';
    const code = item.code   || item.codeId  || item.detailCode || '';
    if (name && code) map[name] = code;
  }
  return map;
}

// ── Step 3: chart data ────────────────────────────────────────────────────────

async function fetchChartData(cookie, route, container) {
  const period     = getPeriodParams();
  const regionCode = cfg.regions[route.regionName];
  const originCode = cfg.origins[route.originName];

  // searchStart = 출발지 코드 (NOT 기간 시작)
  // 기간은 searchYear/Month ~ searchYear2/Month2 로 전달
  const body = {
    searchStart:       originCode,
    searchEndMainLand: regionCode,
    searchEnd:         route.destCode,
    dayChange:         'B',
    searchYear:        period.searchYear,
    searchMonth:       period.searchMonth,
    searchYear2:       period.searchYear2,
    searchMonth2:      period.searchMonth2,
    seaCharge:         'SEA_' + container + '_CHARGE',
  };

  // 인천 출발 구분
  if (route.originName === '인천') body.incheonYn = 'Y';

  const r = await fetch(BASE + cfg.endpoints.chartData, {
    method:  'POST',
    headers: {
      'User-Agent':       UA,
      'Content-Type':     'application/json',
      'Accept':           'application/json',
      'Referer':          BASE + cfg.page.sea,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie':           cookie,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    const txt = await r.text().catch(function() { return ''; });
    throw new Error('chartData HTTP ' + r.status + ': ' + txt.slice(0, 120));
  }
  return r.json();
}

// ── Parse chart response ──────────────────────────────────────────────────────

function parseChartResponse(raw, container, isDump) {
  if (isDump) {
    console.log('  [chartData dump] keys:', JSON.stringify(Object.keys(raw || {})));
    console.log('  [chartData dump] sample:', JSON.stringify(raw).slice(0, 800));
  }

  const indices = [];
  const rates   = [];

  // ── Index time series ────────────────────────────────────────────────
  const graphList = raw.seaChargeGraph || raw.chartData || raw.graphList || [];
  for (const row of graphList) {
    const ym = String(row.yearMon || row.yearMonth || row.period || '').replace(/\D/g, '').slice(0, 6);
    if (ym.length !== 6) continue;
    indices.push({
      yearMon:   ym,
      radis:     row.result1 != null ? Number(row.result1) : null,
      naIndex:   row.result2 != null ? Number(row.result2) : null,
      euIndex:   row.result3 != null ? Number(row.result3) : null,
      asiaIndex: row.result4 != null ? Number(row.result4) : null,
    });
  }

  // ── Route monthly rates ───────────────────────────────────────────────
  const cateList = raw.selectSeaChargeListCate || raw.rateList || raw.chargeList || [];
  for (const cate of cateList) {
    const rateArr = cate.resultList || cate.rates || cate.list || [];
    for (const row of rateArr) {
      const ym  = String(row.yearMon || row.yearMonth || row.period || '').replace(/\D/g, '').slice(0, 6);
      if (ym.length !== 6) continue;
      const val = row.teu != null ? Number(row.teu)
                : row.feu != null ? Number(row.feu)
                : row.result1  != null ? Number(row.result1) : null;
      rates.push({
        yearMon: ym,
        dest:    cate.seaEnd || cate.dest || '',
        [container === 'TEU' ? 'teu' : 'feu']: val,
      });
    }
  }

  // Fallback: top-level list (some KITA responses flatten everything)
  if (!rates.length) {
    const flat = raw.seaChargeList || raw.resultList || raw.list || [];
    for (const row of flat) {
      const ym  = String(row.yearMon || row.yearMonth || '').replace(/\D/g, '').slice(0, 6);
      if (ym.length !== 6) continue;
      const val = row.teu != null ? Number(row.teu)
                : row.feu != null ? Number(row.feu)
                : row.charge != null ? Number(row.charge) : null;
      rates.push({ yearMon: ym, dest: '', [container === 'TEU' ? 'teu' : 'feu']: val });
    }
  }

  return { indices, rates };
}

// ── Merge TEU + FEU rate arrays by yearMon ────────────────────────────────────

function mergeRates(teuArr, feuArr) {
  const map = {};
  for (const r of teuArr) {
    if (!map[r.yearMon]) map[r.yearMon] = { yearMon: r.yearMon };
    if (r.teu != null) map[r.yearMon].teu = r.teu;
  }
  for (const r of feuArr) {
    if (!map[r.yearMon]) map[r.yearMon] = { yearMon: r.yearMon };
    if (r.feu != null) map[r.yearMon].feu = r.feu;
  }
  return Object.values(map).sort(function(a, b) { return a.yearMon.localeCompare(b.yearMon); });
}

// ── Filter incomplete months (current month placeholder: rate=0 or index<=5) ─

function filterIncomplete(indices, rates) {
  // Exclude index rows where all values are suspiciously small (<=5) — KITA placeholder
  const cleanIdx = indices.filter(function(r) {
    return r.radis > 5 || r.naIndex > 5 || r.euIndex > 5 || r.asiaIndex > 5;
  });
  // Exclude rate rows where both TEU and FEU are 0 or null (month not finalised)
  const cleanRates = rates.filter(function(r) {
    return !((r.teu == null || r.teu === 0) && (r.feu == null || r.feu === 0));
  });
  return { indices: cleanIdx, rates: cleanRates };
}

// ── Add MoM change columns ────────────────────────────────────────────────────

function addChanges(rates) {
  return rates.map(function(row, i) {
    const prev = i > 0 ? rates[i - 1] : null;
    return Object.assign({}, row, {
      teuChg: (prev && prev.teu != null && row.teu != null) ? row.teu - prev.teu : null,
      feuChg: (prev && prev.feu != null && row.feu != null) ? row.feu - prev.feu : null,
    });
  });
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (Date.now() - new Date(raw.fetchedAt).getTime() > CACHE_TTL) return null;
    return raw;
  } catch (_) { return null; }
}

function saveCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) { console.warn('  kita-fare: 캐시 저장 실패:', e.message); }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function buildKitaFare(opts) {
  const force    = (opts && opts.force) || false;
  const singleRoute = (opts && opts.route) || null; // e.g. "부산→Long Beach"

  if (!force) {
    const cached = loadCache();
    if (cached) {
      console.log('  kita-fare: 캐시 사용 (' + cached.fetchedAt.slice(0, 10) + ', ' + cached.routes.length + '개 노선)');
      return cached;
    }
  }

  // Step 1: session
  console.log('  kita-fare: 세션 확보...');
  let cookie = '';
  try {
    cookie = await getSession();
    console.log('  kita-fare: 세션 OK' + (cookie ? ' (' + cookie.slice(0, 40) + '...)' : ' (쿠키 없음)'));
  } catch (e) {
    console.warn('  kita-fare: 세션 실패 —', e.message, '— 쿠키 없이 진행');
  }

  const routes  = singleRoute
    ? cfg.routes.filter(function(r) { return (r.originName + '→' + r.destName) === singleRoute; })
    : cfg.routes;

  const results = [];
  let isDump    = true; // dump raw JSON on first successful fetch

  for (var ri = 0; ri < routes.length; ri++) {
    const route = Object.assign({}, routes[ri]); // copy — may mutate destCode
    console.log('  kita-fare: [' + (ri + 1) + '/' + routes.length + '] ' + route.originName + ' → ' + route.destName + ' (' + route.regionName + ')');

    try {
      const regionCode = cfg.regions[route.regionName];
      if (!regionCode) throw new Error('regionName 불명: ' + route.regionName);

      // Step 2: destCode 자동 매핑
      if (!route.destCode) {
        console.log('    codeView destCode 조회...');
        const isIncheon = route.originName === '인천';
        let codeMap = {};
        try {
          codeMap = await getDestCodes(cookie, regionCode, isIncheon);
          console.log('    사용 가능 도착지:', Object.keys(codeMap).join(', '));
        } catch (e) {
          console.warn('    codeView 실패 —', e.message);
        }
        const found = codeMap[route.destName];
        if (found) {
          route.destCode = found;
          console.log('    destCode 자동 매핑: ' + route.destName + ' = ' + found);
        } else {
          // Try partial match
          const partial = Object.keys(codeMap).find(function(k) { return k.toLowerCase().includes(route.destName.toLowerCase()) || route.destName.toLowerCase().includes(k.toLowerCase()); });
          if (partial) {
            route.destCode = codeMap[partial];
            console.log('    destCode 부분 매핑: ' + partial + ' = ' + route.destCode);
          } else {
            const err = 'destCode 찾기 실패 — 가능한 이름: ' + Object.keys(codeMap).slice(0, 8).join(', ');
            console.warn('    ' + err);
            results.push({ originName: route.originName, destName: route.destName, regionName: route.regionName, error: err });
            if (ri < routes.length - 1) await randomDelay();
            continue;
          }
        }
        await randomDelay();
      }

      // Step 3: chartData (FEU + TEU)
      const containers = cfg.containers || ['FEU', 'TEU'];
      let allIndices = [];
      let teuRates   = [];
      let feuRates   = [];

      for (var ci = 0; ci < containers.length; ci++) {
        const container = containers[ci];
        console.log('    chartData ' + container + '...');
        let raw;
        try {
          raw = await fetchChartData(cookie, route, container);
        } catch (e) {
          console.warn('    chartData ' + container + ' 실패 —', e.message);
          if (ci < containers.length - 1) await randomDelay();
          continue;
        }

        const parsed = parseChartResponse(raw, container, isDump);
        isDump = false; // only dump once

        if (!allIndices.length && parsed.indices.length) allIndices = parsed.indices;
        if (container === 'TEU') teuRates = parsed.rates;
        else                     feuRates = parsed.rates;

        if (ci < containers.length - 1) await randomDelay();
      }

      const cleaned = filterIncomplete(allIndices, mergeRates(teuRates, feuRates));
      allIndices    = cleaned.indices;
      const merged  = addChanges(cleaned.rates);
      console.log('    완료 — indices:' + allIndices.length + ', rates:' + merged.length);

      results.push({
        originName: route.originName,
        destName:   route.destName,
        regionName: route.regionName,
        indices:    allIndices,
        rates:      merged,
      });

    } catch (e) {
      console.warn('  kita-fare: ' + route.originName + ' → ' + route.destName + ' 전체 실패 —', e.message);
      results.push({ originName: route.originName, destName: route.destName, regionName: route.regionName, error: e.message });
    }

    if (ri < routes.length - 1) await randomDelay();
  }

  const ok      = results.filter(function(r) { return !r.error; }).length;
  const total   = results.length;
  const payload = { fetchedAt: new Date().toISOString(), routes: results };

  if (ok > 0) saveCache(payload);
  else         console.warn('  kita-fare: ⚠️ 전체 실패 — 캐시 저장 생략');

  console.log('  kita-fare: 완료 ' + ok + '/' + total + ' 노선');
  return payload;
}

module.exports = { buildKitaFare, CACHE_PATH };

// ── CLI 단독 실행 ─────────────────────────────────────────────────────────────
if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  const force  = process.argv.includes('--force');
  const single = process.argv.find(function(a) { return a.startsWith('--route='); });
  const route  = single ? single.split('=').slice(1).join('=') : null;

  buildKitaFare({ force: force || true, route: route })
    .then(function(r) {
      if (!r) { console.log('결과 없음'); process.exit(1); }
      const ok = r.routes.filter(function(x) { return !x.error; });
      if (ok.length) {
        const first = ok[0];
        console.log('\n=== 결과 미리보기 ===');
        console.log('노선:', first.originName, '->', first.destName);
        console.log('indices 최신 3개:', JSON.stringify(first.indices.slice(-3), null, 2));
        console.log('rates 최신 3개:',   JSON.stringify(first.rates.slice(-3),   null, 2));
      }
      const failed = r.routes.filter(function(x) { return x.error; });
      if (failed.length) console.warn('실패 노선:', failed.map(function(x) { return x.originName + '->' + x.destName + '(' + x.error + ')'; }));
    })
    .catch(function(e) { console.error('오류:', e.message); process.exit(1); });
}
