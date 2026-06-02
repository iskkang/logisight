'use strict';
// KITA 참고운임 수집기 (해상 + 항공)
// 입력: generators/report/config/kita-fare.json
// 출력: outputs/cache/kita-fare-sea.json
//       outputs/cache/kita-fare-air.json
//
// 수집 흐름 (해상·항공 공통):
//   1. GET  {page.sea|air}         → JSESSIONID_KITA 세션 쿠키
//   2. POST {endpoints.*.codeView} → destCode 자동 매핑 (config 미기재 시)
//   3. POST {endpoints.*.chartData}→ 월별 운임·지수 시계열
//   4. 캐시 저장 (TTL 24h, --force 갱신)
//
// 항공 특이점:
//   - 호출 1회로 전 중량(ac100/ac300/ac500) 동시 취득
//   - indices 단위: KRW(지수) / rates 단위: USD

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const CONFIG_PATH   = path.resolve(__dirname, '../config/kita-fare.json');
const SEA_CACHE     = path.resolve(__dirname, '../../../outputs/cache/kita-fare-sea.json');
const AIR_CACHE     = path.resolve(__dirname, '../../../outputs/cache/kita-fare-air.json');
const CACHE_TTL     = 24 * 60 * 60 * 1000; // 24 h

const cfg  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const BASE = cfg.base;
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── 공통 유틸 ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function randomDelay() { return sleep(800 + Math.floor(Math.random() * 700)); }

function extractCookie(headers) {
  const raw = headers.get('set-cookie') || '';
  const re  = /([A-Z_]*SESSION[A-Z_]*)=([^;,\s]+)/gi;
  const pairs = [];
  var m;
  while ((m = re.exec(raw)) !== null) pairs.push(m[1] + '=' + m[2]);
  return pairs.find(function(p) { return /JSESSIONID_KITA/i.test(p); }) || pairs[0] || '';
}

function pad2(n) { return String(n).padStart(2, '0'); }

function getPeriodParams() {
  const now        = new Date();
  const monthsBack = cfg.period.monthsBack || 13;
  const endYear    = now.getFullYear();
  const endMonth   = now.getMonth() + 1;
  let startYear    = endYear;
  let startMonth   = endMonth - monthsBack;
  while (startMonth <= 0) { startMonth += 12; startYear--; }
  return {
    searchYear:   String(startYear),
    searchMonth:  pad2(startMonth),
    searchYear2:  String(endYear),
    searchMonth2: pad2(endMonth),
  };
}

function cleanYm(raw) {
  var s = String(raw || '').replace(/\D/g, '').slice(0, 6);
  return s.length === 6 ? s : '';
}

// ── 공통 HTTP ─────────────────────────────────────────────────────────────────

async function getSession(pagePath) {
  const r = await fetch(BASE + pagePath, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9' },
    redirect: 'follow',
    signal:   AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('세션 GET 실패: HTTP ' + r.status);
  var cookie = extractCookie(r.headers);
  if (!cookie) console.warn('  kita: 세션 쿠키 없음 — 쿠키 없이 진행');
  return cookie;
}

async function postJson(urlPath, cookie, body) {
  const r = await fetch(BASE + urlPath, {
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
    var txt = await r.text().catch(function() { return ''; });
    throw new Error('HTTP ' + r.status + ': ' + txt.slice(0, 120));
  }
  // KITA는 미지원 노선/지역에 HTML 페이지를 반환함 (JSON 아님)
  var ct = r.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('HTML 페이지 반환 — 해당 노선/지역 미지원 또는 세션 만료 (Content-Type: ' + ct.split(';')[0] + ')');
  }
  return r.json();
}

// ── destCode 자동 매핑 ────────────────────────────────────────────────────────

async function resolveDestCode(cookie, codeViewPath, regionCode, destName, incheonYn) {
  var body = { code: regionCode };
  if (incheonYn) body.incheonYn = 'Y';
  var data = await postJson(codeViewPath, cookie, body);

  if (process.env.KITA_DEBUG) {
    console.log('  [codeView dump]', JSON.stringify(data).slice(0, 400));
  }

  var list = Array.isArray(data) ? data : (data.detailView || data.data || data.list || []);
  var map  = {};
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var name = item.codeNm || item.codeEn || item.name || item.detailName || '';
    var code = item.code   || item.codeId  || item.detailCode || '';
    if (name && code) map[name] = code;
  }

  var found = map[destName];
  if (!found) {
    // 부분 매칭
    var keys = Object.keys(map);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (k.toLowerCase().indexOf(destName.toLowerCase()) !== -1 ||
          destName.toLowerCase().indexOf(k.toLowerCase()) !== -1) {
        found = map[k];
        console.log('    destCode 부분 매핑: ' + k + ' = ' + found);
        break;
      }
    }
  }
  if (!found) {
    throw new Error('destCode 찾기 실패 — 가능한 이름: ' + Object.keys(map).slice(0, 8).join(', '));
  }
  return found;
}

// ── 캐시 ─────────────────────────────────────────────────────────────────────

function loadCache(cachePath) {
  try {
    if (!fs.existsSync(cachePath)) return null;
    var raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (Date.now() - new Date(raw.fetchedAt).getTime() > CACHE_TTL) return null;
    return raw;
  } catch (_) { return null; }
}

function saveCache(cachePath, payload) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) { console.warn('  kita: 캐시 저장 실패:', e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 해상 (SEA)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchSeaChartData(cookie, route, container) {
  var period     = getPeriodParams();
  var regionCode = cfg.regions.sea[route.regionName];
  var originCode = cfg.origins.sea[route.originName];
  var body = {
    searchStart:       originCode,        // 출발지 코드 (NOT 기간)
    searchEndMainLand: regionCode,
    searchEnd:         route.destCode,
    dayChange:         'B',
    searchYear:        period.searchYear,
    searchMonth:       period.searchMonth,
    searchYear2:       period.searchYear2,
    searchMonth2:      period.searchMonth2,
    seaCharge:         'SEA_' + container + '_CHARGE',
  };
  if (route.originName === '인천') body.incheonYn = 'Y';
  return postJson(cfg.endpoints.sea.chartData, cookie, body);
}

function parseSeaChart(raw, container, isDump) {
  if (isDump) {
    console.log('  [sea dump] keys:', JSON.stringify(Object.keys(raw || {})));
    console.log('  [sea dump] sample:', JSON.stringify(raw).slice(0, 600));
  }

  var indices = [];
  var rates   = [];

  var graphList = raw.seaChargeGraph || [];
  for (var i = 0; i < graphList.length; i++) {
    var row = graphList[i];
    var ym  = cleanYm(row.yearMon);
    if (!ym) continue;
    indices.push({
      yearMon:   ym,
      radis:     row.result1 != null ? Number(row.result1) : null,
      naIndex:   row.result2 != null ? Number(row.result2) : null,
      euIndex:   row.result3 != null ? Number(row.result3) : null,
      asiaIndex: row.result4 != null ? Number(row.result4) : null,
    });
  }

  var cateList = raw.selectSeaChargeListCate || [];
  for (var c = 0; c < cateList.length; c++) {
    var rateArr = cateList[c].resultList || [];
    for (var r = 0; r < rateArr.length; r++) {
      var rr  = rateArr[r];
      var ym2 = cleanYm(rr.yearMon);
      if (!ym2) continue;
      var val = rr.teu != null ? Number(rr.teu)
              : rr.feu != null ? Number(rr.feu)
              : rr.result1 != null ? Number(rr.result1) : null;
      var entry = { yearMon: ym2 };
      entry[container === 'TEU' ? 'teu' : 'feu'] = val;
      rates.push(entry);
    }
  }

  // 평탄화 폴백
  if (!rates.length) {
    var flat = raw.seaChargeList || raw.resultList || [];
    for (var f = 0; f < flat.length; f++) {
      var fr  = flat[f];
      var ym3 = cleanYm(fr.yearMon);
      if (!ym3) continue;
      var fval = fr.teu != null ? Number(fr.teu) : fr.feu != null ? Number(fr.feu) : fr.charge != null ? Number(fr.charge) : null;
      var fentry = { yearMon: ym3 };
      fentry[container === 'TEU' ? 'teu' : 'feu'] = fval;
      rates.push(fentry);
    }
  }

  return { indices: indices, rates: rates };
}

function mergeSeaRates(teuArr, feuArr) {
  var map = {};
  for (var i = 0; i < teuArr.length; i++) {
    var r = teuArr[i];
    if (!map[r.yearMon]) map[r.yearMon] = { yearMon: r.yearMon };
    if (r.teu != null) map[r.yearMon].teu = r.teu;
  }
  for (var j = 0; j < feuArr.length; j++) {
    var s = feuArr[j];
    if (!map[s.yearMon]) map[s.yearMon] = { yearMon: s.yearMon };
    if (s.feu != null) map[s.yearMon].feu = s.feu;
  }
  return Object.values(map).sort(function(a, b) { return a.yearMon.localeCompare(b.yearMon); });
}

function addSeaChanges(rates) {
  return rates.map(function(row, i) {
    var prev = i > 0 ? rates[i - 1] : null;
    return Object.assign({}, row, {
      teuChg: prev && prev.teu != null && row.teu != null ? row.teu - prev.teu : null,
      feuChg: prev && prev.feu != null && row.feu != null ? row.feu - prev.feu : null,
    });
  });
}

function filterSeaIncomplete(indices, rates) {
  var cleanIdx = indices.filter(function(r) {
    return r.radis > 5 || r.naIndex > 5 || r.euIndex > 5 || r.asiaIndex > 5;
  });
  var cleanRates = rates.filter(function(r) {
    return !((r.teu == null || r.teu === 0) && (r.feu == null || r.feu === 0));
  });
  return { indices: cleanIdx, rates: cleanRates };
}

async function buildKitaFareSea(opts) {
  var force       = (opts && opts.force) || false;
  var singleRoute = (opts && opts.route) || null;

  if (!force) {
    var cached = loadCache(SEA_CACHE);
    if (cached) {
      console.log('  kita-sea: 캐시 사용 (' + cached.fetchedAt.slice(0, 10) + ', ' + cached.routes.length + '개 노선)');
      return cached;
    }
  }

  console.log('  kita-sea: 세션 확보...');
  var cookie = '';
  try {
    cookie = await getSession(cfg.page.sea);
    console.log('  kita-sea: 세션 OK' + (cookie ? ' (' + cookie.slice(0, 40) + '...)' : ''));
  } catch (e) {
    console.warn('  kita-sea: 세션 실패 —', e.message);
  }

  var seaRoutes = singleRoute
    ? cfg.routes.sea.filter(function(r) { return (r.originName + '→' + r.destName) === singleRoute; })
    : cfg.routes.sea;

  var results = [];
  var isDump  = true;

  for (var ri = 0; ri < seaRoutes.length; ri++) {
    var route = Object.assign({}, seaRoutes[ri]);
    console.log('  kita-sea: [' + (ri + 1) + '/' + seaRoutes.length + '] ' + route.originName + ' → ' + route.destName);

    try {
      if (!cfg.regions.sea[route.regionName]) throw new Error('regionName 불명: ' + route.regionName);

      if (!route.destCode) {
        console.log('    codeView destCode 조회...');
        route.destCode = await resolveDestCode(
          cookie,
          cfg.endpoints.sea.codeView,
          cfg.regions.sea[route.regionName],
          route.destName,
          route.originName === '인천'
        );
        console.log('    destCode: ' + route.destCode);
        await randomDelay();
      }

      var containers = cfg.containers || ['FEU', 'TEU'];
      var allIndices = [], teuRates = [], feuRates = [];

      for (var ci = 0; ci < containers.length; ci++) {
        var container = containers[ci];
        console.log('    chartData ' + container + '...');
        var raw;
        try {
          raw = await fetchSeaChartData(cookie, route, container);
        } catch (e2) {
          console.warn('    chartData ' + container + ' 실패 —', e2.message);
          if (ci < containers.length - 1) await randomDelay();
          continue;
        }

        var parsed = parseSeaChart(raw, container, isDump);
        isDump = false;

        if (!allIndices.length && parsed.indices.length) allIndices = parsed.indices;
        if (container === 'TEU') teuRates = parsed.rates;
        else                     feuRates = parsed.rates;

        if (ci < containers.length - 1) await randomDelay();
      }

      var cleaned = filterSeaIncomplete(allIndices, mergeSeaRates(teuRates, feuRates));
      var merged  = addSeaChanges(cleaned.rates);

      console.log('    완료 — indices:' + cleaned.indices.length + ', rates:' + merged.length);
      results.push({ originName: route.originName, destName: route.destName, regionName: route.regionName, indices: cleaned.indices, rates: merged });

    } catch (e3) {
      console.warn('  kita-sea: ' + route.originName + ' → ' + route.destName + ' 실패 —', e3.message);
      results.push({ originName: route.originName, destName: route.destName, regionName: route.regionName, error: e3.message });
    }

    if (ri < seaRoutes.length - 1) await randomDelay();
  }

  var ok      = results.filter(function(r) { return !r.error; }).length;
  var payload = { fetchedAt: new Date().toISOString(), routes: results };
  if (ok > 0) saveCache(SEA_CACHE, payload);
  else        console.warn('  kita-sea: ⚠️ 전체 실패 — 캐시 저장 생략');
  console.log('  kita-sea: 완료 ' + ok + '/' + results.length + ' 노선');
  return payload;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 항공 (AIR)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAirChartData(cookie, route) {
  var period     = getPeriodParams();
  var regionCode = cfg.regions.air[route.regionName];
  var originCode = cfg.origins.air[route.originName];

  // airCharge="AIR_CHARGE100" 하나로 ac100/ac300/ac500 동시 취득
  var body = {
    searchStart:       originCode,
    searchEndMainLand: regionCode,
    searchEnd:         route.destCode,
    dayChange:         'B',
    searchYear:        period.searchYear,
    searchMonth:       period.searchMonth,
    searchYear2:       period.searchYear2,
    searchMonth2:      period.searchMonth2,
    airCharge:         'AIR_CHARGE100',
  };
  return postJson(cfg.endpoints.air.chartData, cookie, body);
}

function parseAirChart(raw, isDump) {
  if (isDump) {
    console.log('  [air dump] keys:', JSON.stringify(Object.keys(raw || {})));
    console.log('  [air dump] sample:', JSON.stringify(raw).slice(0, 800));
  }

  var indices = [];
  var rates   = [];

  // airChargeGraph → indices (단위: KRW 지수)
  var graphList = raw.airChargeGraph || [];
  for (var i = 0; i < graphList.length; i++) {
    var row = graphList[i];
    var ym  = cleanYm(row.yearMon);
    if (!ym) continue;
    indices.push({
      yearMon:   ym,
      naIndex:   row.result1 != null ? Number(row.result1) : null,   // 북미
      euIndex:   row.result2 != null ? Number(row.result2) : null,   // 유럽
      asiaIndex: row.result3 != null ? Number(row.result3) : null,   // 아시아
      cnIndex:   row.result4 != null ? Number(row.result4) : null,   // 중국
    });
  }

  // selectAirChargeListCate → rates (단위: USD)
  var cateList = raw.selectAirChargeListCate || [];
  for (var c = 0; c < cateList.length; c++) {
    var rateArr = cateList[c].resultList || [];
    for (var r = 0; r < rateArr.length; r++) {
      var rr  = rateArr[r];
      var ym2 = cleanYm(rr.yearMon);
      if (!ym2) continue;
      rates.push({
        yearMon: ym2,
        kg100:   rr.ac100 != null ? Number(rr.ac100) : null,
        kg300:   rr.ac300 != null ? Number(rr.ac300) : null,
        kg500:   rr.ac500 != null ? Number(rr.ac500) : null,
      });
    }
  }

  // ac100/300/500가 비어 있으면 AIR_CHARGE300/500 추가 호출 필요 — caller가 처리
  return { indices: indices, rates: rates, needsMoreWeights: !rates.length };
}

function filterAirIncomplete(indices, rates) {
  var cleanIdx = indices.filter(function(r) {
    return r.naIndex > 5 || r.euIndex > 5 || r.asiaIndex > 5 || r.cnIndex > 5;
  });
  var cleanRates = rates.filter(function(r) {
    return r.kg100 || r.kg300 || r.kg500;
  });
  return { indices: cleanIdx, rates: cleanRates };
}

function addAirChanges(rates) {
  return rates.map(function(row, i) {
    var prev = i > 0 ? rates[i - 1] : null;
    return Object.assign({}, row, {
      chg100: prev && prev.kg100 != null && row.kg100 != null ? row.kg100 - prev.kg100 : null,
      chg300: prev && prev.kg300 != null && row.kg300 != null ? row.kg300 - prev.kg300 : null,
      chg500: prev && prev.kg500 != null && row.kg500 != null ? row.kg500 - prev.kg500 : null,
    });
  });
}

async function buildKitaFareAir(opts) {
  var force       = (opts && opts.force) || false;
  var singleRoute = (opts && opts.route) || null;

  if (!force) {
    var cached = loadCache(AIR_CACHE);
    if (cached) {
      console.log('  kita-air: 캐시 사용 (' + cached.fetchedAt.slice(0, 10) + ', ' + cached.routes.length + '개 노선)');
      return cached;
    }
  }

  console.log('  kita-air: 세션 확보...');
  var cookie = '';
  try {
    cookie = await getSession(cfg.page.air);
    console.log('  kita-air: 세션 OK' + (cookie ? ' (' + cookie.slice(0, 40) + '...)' : ''));
  } catch (e) {
    console.warn('  kita-air: 세션 실패 —', e.message);
  }

  var airRoutes = singleRoute
    ? cfg.routes.air.filter(function(r) { return (r.originName + '→' + r.destName) === singleRoute; })
    : cfg.routes.air;

  var results = [];
  var isDump  = true;

  for (var ri = 0; ri < airRoutes.length; ri++) {
    var route = Object.assign({}, airRoutes[ri]);
    console.log('  kita-air: [' + (ri + 1) + '/' + airRoutes.length + '] ' + route.originName + ' → ' + route.destName);

    try {
      if (!cfg.regions.air[route.regionName]) throw new Error('regionName 불명: ' + route.regionName);

      if (!route.destCode) {
        console.log('    codeView destCode 조회...');
        route.destCode = await resolveDestCode(
          cookie,
          cfg.endpoints.air.codeView,
          cfg.regions.air[route.regionName],
          route.destName,
          false
        );
        console.log('    destCode: ' + route.destCode);
        await randomDelay();
      }

      // 항공은 1회 호출로 전 중량 취득
      console.log('    chartData (AIR_CHARGE100 → ac100/300/500 동시)...');
      var raw = await fetchAirChartData(cookie, route);
      var parsed = parseAirChart(raw, isDump);
      isDump = false;

      // ac100/300/500가 비어 있으면 AIR_CHARGE300으로 재시도
      if (parsed.needsMoreWeights) {
        console.warn('    ac100/300/500 미수신 — AIR_CHARGE300으로 재시도');
        await randomDelay();
        var period2 = getPeriodParams();
        var body2 = {
          searchStart:       cfg.origins.air[route.originName],
          searchEndMainLand: cfg.regions.air[route.regionName],
          searchEnd:         route.destCode,
          dayChange:         'B',
          searchYear:        period2.searchYear,
          searchMonth:       period2.searchMonth,
          searchYear2:       period2.searchYear2,
          searchMonth2:      period2.searchMonth2,
          airCharge:         'AIR_CHARGE300',
        };
        var raw2 = await postJson(cfg.endpoints.air.chartData, cookie, body2);
        var parsed2 = parseAirChart(raw2, true);
        if (!parsed.indices.length) parsed.indices = parsed2.indices;
        parsed.rates = parsed2.rates;
      }

      var cleaned = filterAirIncomplete(parsed.indices, parsed.rates);
      var merged  = addAirChanges(cleaned.rates);

      console.log('    완료 — indices:' + cleaned.indices.length + ', rates:' + merged.length);
      results.push({ originName: route.originName, destName: route.destName, regionName: route.regionName, indices: cleaned.indices, rates: merged });

    } catch (e3) {
      console.warn('  kita-air: ' + route.originName + ' → ' + route.destName + ' 실패 —', e3.message);
      results.push({ originName: route.originName, destName: route.destName, regionName: route.regionName, error: e3.message });
    }

    if (ri < airRoutes.length - 1) await randomDelay();
  }

  var ok      = results.filter(function(r) { return !r.error; }).length;
  var payload = { fetchedAt: new Date().toISOString(), routes: results };
  if (ok > 0) saveCache(AIR_CACHE, payload);
  else        console.warn('  kita-air: ⚠️ 전체 실패 — 캐시 저장 생략');
  console.log('  kita-air: 완료 ' + ok + '/' + results.length + ' 노선');
  return payload;
}

// ═══════════════════════════════════════════════════════════════════════════════
// exports + CLI
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { buildKitaFareSea, buildKitaFareAir, SEA_CACHE_PATH: SEA_CACHE, AIR_CACHE_PATH: AIR_CACHE };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  var force  = process.argv.includes('--force');
  var mode   = process.argv.includes('--air') ? 'air' : 'sea';
  var single = process.argv.find(function(a) { return a.startsWith('--route='); });
  var route  = single ? single.split('=').slice(1).join('=') : null;

  var builder = mode === 'air' ? buildKitaFareAir : buildKitaFareSea;

  builder({ force: force || true, route: route })
    .then(function(r) {
      if (!r) { console.log('결과 없음'); process.exit(1); }
      var ok = r.routes.filter(function(x) { return !x.error; });
      if (ok.length) {
        var first = ok[0];
        console.log('\n=== 결과 미리보기 ===');
        console.log('노선:', first.originName, '->', first.destName);
        console.log('indices 최신 3개:', JSON.stringify(first.indices.slice(-3), null, 2));
        console.log('rates 최신 3개:',   JSON.stringify(first.rates.slice(-3),   null, 2));
      }
      var failed = r.routes.filter(function(x) { return x.error; });
      if (failed.length) console.warn('실패:', failed.map(function(x) { return x.originName + '->' + x.destName; }));
    })
    .catch(function(e) { console.error('오류:', e.message); process.exit(1); });
}
