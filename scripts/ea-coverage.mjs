// scripts/ea-coverage.mjs
// 동아시아 물동량 공백 매트릭스 — 국가 × 연월. PHASE 2 EA-0.5.
//
// 사용: node scripts/ea-coverage.mjs [--months=18] [--check]
//
// --check —— CI 용. 「최신월이 각 소스의 공표 시차보다 더 밀렸는가」만 보고 밀렸으면 exit 1.
//   PHASE 4 의 유일한 규칙이 "매월 거르지 않는 것"이라, 거른 것을 사람이 눈치채는 구조여야
//   한다. 수집이 조용히 멈추면 표는 그대로 있고 최신월만 안 올라간다 —— 화면상 아무 일도
//   일어나지 않아서 몇 달이 지나도 모른다.
//
// ■ 왜 만드나
// 수집 워크플로를 국가별로 나눠 두면(jp-collect / ea-collect) "지금 어디가 비었나"를
// 한눈에 볼 곳이 없다. 워크플로를 합치는 대신 조회를 하나 만든다 —— 합치면 공표 일정과
// 자격증명이 서로 다른 축이 한 잡에 묶여, 한쪽 키가 없을 때 멀쩡한 쪽까지 멈춘다.
//
// ■ 무엇을 "비었다"고 보는가
// 행이 없으면 공백(·)이다. 행이 있으면 ●, 잠정치면 ◐ 로 구분한다.
// 소스가 원래 그 기간을 제공하지 않는 경우(TW 월별은 18개월치뿐)도 공백으로 나오는데,
// 그건 수집 실패가 아니라 소스의 한계다 —— 표 아래 각주로 구분해 적는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env.local 을 직접 읽는다(dotenv 의존을 늘리지 않는다).
// CI 에는 이 파일이 없고 환경변수로 들어온다 —— 없으면 그냥 넘어간다.
// 예전에는 무조건 읽어서, 워크플로에 붙이는 순간 ENOENT 로 죽었을 것이다.
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요하다');
  process.exit(1);
}

/** 표에 세울 5개국. 아직 수집기가 없는 나라도 줄은 세운다 —— 없는 것이 보여야 한다. */
// maxLagMonths —— 이 소스가 정상일 때 허용되는 지연(개월). 이보다 더 밀리면 수집이
// 멈춘 것으로 본다. 2026-08-15 실측 시차에 여유를 한 달씩 얹은 값이다.
const COUNTRIES = [
  { code: 'KR', label: '한국', note: 'data.go.kr 해수부', maxLagMonths: 3 },
  { code: 'JP', label: '일본', note: 'e-Stat 港湾調査 (확보라 늦다)', maxLagMonths: 4 },
  { code: 'TW', label: '대만', note: '臺灣港務公司 (월별 18개월치)', maxLagMonths: 3 },
  { code: 'HK', label: '홍콩', note: 'HKMPB', maxLagMonths: 3 },
];

const months = Number(process.argv.find((a) => a.startsWith('--months='))?.split('=')[1] ?? 18);

function monthKeys(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return out;
}

async function fetchRows() {
  const res = await fetch(
    `${URL_}/rest/v1/port_throughput?select=country,year,month,teu,is_preliminary&limit=5000`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const rows = await fetchRows();

// 같은 국가·연월에 여러 항만 행이 있을 수 있다(JP 는 항만별로 들어온다).
// 하나라도 있으면 채워진 것으로 본다. 잠정치만 있으면 잠정으로 표시한다.
const seen = new Map();
for (const r of rows) {
  if (!r.country) continue;
  const k = `${r.country}_${r.year}_${r.month}`;
  const cur = seen.get(k) ?? { any: false, allPrelim: true };
  cur.any = true;
  if (!r.is_preliminary) cur.allPrelim = false;
  seen.set(k, cur);
}

const keys = monthKeys(months);
const head = keys.map((k) => String(k.month).padStart(2, '0')).join(' ');
const years = keys.map((k) => (k.month === 1 || k === keys[0] ? String(k.year).slice(2) : '  ')).join(' ');

console.log(`\n동아시아 물동량 공백 매트릭스 — 최근 ${months}개월 (port_throughput)\n`);
console.log(`        ${years}`);
console.log(`        ${head}`);
for (const c of COUNTRIES) {
  const cells = keys.map((k) => {
    const v = seen.get(`${c.code}_${k.year}_${k.month}`);
    if (!v) return ' ·';
    return v.allPrelim ? ' ◐' : ' ●';
  }).join('');
  console.log(`${c.label.padEnd(4, '　')} ${c.code} ${cells}`);
}
console.log('\n  ● 확정  ◐ 잠정  · 없음');
for (const c of COUNTRIES) console.log(`  ${c.code}: ${c.note}`);

// 최신월 요약 — 표에 실을 수 있는 가장 최근 달이 어디까지인지.
console.log('');
const now = new Date();
const nowIdx = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
const stale = [];
for (const c of COUNTRIES) {
  const mine = rows.filter((r) => r.country === c.code);
  if (mine.length === 0) {
    console.log(`  ${c.code} 최신: (없음)`);
    stale.push(`${c.code}(행 없음)`);
    continue;
  }
  const latest = mine.reduce((a, b) => (a.year * 12 + a.month >= b.year * 12 + b.month ? a : b));
  const lag = nowIdx - (latest.year * 12 + latest.month);
  const over = lag > c.maxLagMonths;
  console.log(
    `  ${c.code} 최신: ${latest.year}-${String(latest.month).padStart(2, '0')} · 행 ${mine.length}건 · 지연 ${lag}개월` +
      (over ? ` ← 허용 ${c.maxLagMonths}개월 초과` : ''),
  );
  if (over) stale.push(`${c.code}(${lag}개월, 허용 ${c.maxLagMonths})`);
}
console.log('');

if (process.argv.includes('--check')) {
  if (stale.length > 0) {
    console.error(`::error::수집이 밀렸다 — ${stale.join(' · ')}`);
    console.error('공표가 늦은 것인지 수집기가 죽은 것인지 확인할 것. 소스 사이트를 직접 열어보는 편이 빠르다.');
    process.exit(1);
  }
  console.log('✅ 모든 소스가 허용 지연 안에 있다');
}
