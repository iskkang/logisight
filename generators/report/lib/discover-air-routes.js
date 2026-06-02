'use strict';
// KITA 항공 노선 discovery — regions.air 별로 codeView를 호출해
// 모든 목적지(destName/destCode)를 덤프한다. routes.air 채우기용 일회성 도구.
//   node discover-air-routes.js          # 콘솔 덤프
//   node discover-air-routes.js --write   # config.routes.air 갱신

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../config/kita-fare.json');
const cfg  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const BASE = cfg.base;
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function extractCookie(headers) {
  const raw = headers.get('set-cookie') || '';
  const re  = /([A-Z_]*SESSION[A-Z_]*)=([^;,\s]+)/gi;
  const pairs = []; var m;
  while ((m = re.exec(raw)) !== null) pairs.push(m[1] + '=' + m[2]);
  return pairs.find(function(p) { return /JSESSIONID_KITA/i.test(p); }) || pairs[0] || '';
}

async function getSession(pagePath) {
  const r = await fetch(BASE + pagePath, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9' },
    redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('세션 GET 실패: HTTP ' + r.status);
  return extractCookie(r.headers);
}

async function postJson(urlPath, cookie, body) {
  const r = await fetch(BASE + urlPath, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json',
      'Referer': BASE + cfg.page.air, 'X-Requested-With': 'XMLHttpRequest', 'Cookie': cookie,
    },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  var ct = r.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new Error('HTML 반환 (미지원/세션만료)');
  return r.json();
}

function listFrom(data) {
  var list = Array.isArray(data) ? data : (data.detailView || data.data || data.list || []);
  return list.map(function(item) {
    return {
      name: item.codeNm || item.codeEn || item.name || item.detailName || '',
      code: item.code   || item.codeId  || item.detailCode || '',
    };
  }).filter(function(x) { return x.name && x.code; });
}

async function main() {
  const write   = process.argv.includes('--write');
  const cookie  = await getSession(cfg.page.air);
  console.log('세션:', cookie ? 'OK' : '없음');

  const origin = '인천';
  const routes = [];
  const regions = cfg.regions.air || {};

  for (const regionName of Object.keys(regions)) {
    const regionCode = regions[regionName];
    try {
      const data = await postJson(cfg.endpoints.air.codeView, cookie, { code: regionCode, incheonYn: 'Y' });
      const dests = listFrom(data);
      console.log('\n[' + regionName + ' ' + regionCode + '] ' + dests.length + '개');
      dests.forEach(function(d) {
        console.log('   ' + d.name + ' = ' + d.code);
        routes.push({ originName: origin, regionName: regionName, destName: d.name, destCode: d.code });
      });
    } catch (e) {
      console.log('\n[' + regionName + ' ' + regionCode + '] 실패: ' + e.message);
    }
    await sleep(cfg.delayMs || 1200);
  }

  console.log('\n총 ' + routes.length + '개 노선 발견');

  if (write) {
    cfg.routes.air = routes;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
    console.log('config.routes.air 갱신 완료 (' + routes.length + '개)');
  } else {
    console.log('\n--write 로 config 반영 가능');
  }
}

main().catch(function(e) { console.error('실패:', e.message); process.exit(1); });
