// scripts/next-unpublished-month.mjs
// 「초안은 있는데 아직 발행되지 않은 달」 중 가장 오래된 달을 고른다.
//
// 사용: node scripts/next-unpublished-month.mjs [--window=3]
// 출력: 'YYYY-MM' 한 줄. 대상이 없으면 아무것도 출력하지 않고 exit 0.
//
// ■ 왜 만드나
// 발행 워크플로는 매월 5일에만 돌고, 인자가 없으면 현재 월을 잡았다. 그래서 어느
// 달의 발행이 한 번 실패하면 그 달을 다시 집어줄 일정이 영영 없었다.
// 2026-09호가 정확히 그랬다 —— 9/5 실행이 QA critical 로 막혔고, 9/7 에 그 critical 을
// 전부 잡아 발행 가능 상태로 만들어 두었는데도 한 달을 그대로 묵혔다. 10/5 실행은
// 9월이 아니라 10월을 보러 갔기 때문이다. 결국 사람이 손으로 올려야 했다.
// 실제로 이 워크플로가 스스로 성공한 것은 2026-07 한 번뿐이고, 8·9·10월은 전부
// 수동이었다.
//
// ■ 고르는 규칙
// 최근 window 개월(기본 3)을 오래된 순으로 보며, 아래 둘을 만족하는 첫 달을 고른다.
//   1. content/drafts/monthly-analysis-<월>.md 가 있다 (생성이 끝난 달)
//   2. reports 에 그 달의 발행 행이 없다 (type=monthly, lang=ko, period_start=<월>-01)
// 오래된 쪽을 먼저 집는 이유는 밀린 달을 따라잡기 위해서다. 한 번에 한 달만 발행하고,
// 나머지는 다음 실행이 가져간다 —— 그래서 재시도 cron 을 며칠 간격으로 둔다.
//
// 대상이 없으면 조용히 끝난다. 이미 다 발행된 달에 또 올려 PDF 버전만 바꾸는 일이
// 없도록, "발행됨"은 건너뛰기의 근거이지 실패가 아니다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// .env.local 은 로컬에서만 있다. CI 는 환경변수로 들어오므로 없으면 그냥 넘어간다
// (ea-coverage.mjs 와 같은 방식 —— 무조건 읽으면 워크플로에서 ENOENT 로 죽는다).
const envPath = path.resolve(ROOT, '.env.local');
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

const windowArg = process.argv.find((a) => a.startsWith('--window='));
const WINDOW = Number(windowArg?.split('=')[1] ?? 3);

/** 오래된 순으로 최근 n개월 'YYYY-MM' */
function recentMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

async function isPublished(month) {
  const res = await fetch(
    `${URL_}/rest/v1/reports?select=period_start&type=eq.monthly&lang=eq.ko`
      + `&period_start=eq.${month}-01&limit=1`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!res.ok) throw new Error(`reports 조회 실패: HTTP ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

const months = recentMonths(WINDOW);
const notes = [];

for (const month of months) {
  const draft = path.join(ROOT, 'content', 'drafts', `monthly-analysis-${month}.md`);
  if (!fs.existsSync(draft)) {
    notes.push(`${month}: 초안 없음 — 건너뜀`);
    continue;
  }
  if (await isPublished(month)) {
    notes.push(`${month}: 이미 발행됨 — 건너뜀`);
    continue;
  }
  // 진단은 stderr 로 —— stdout 은 월 하나만 담는다(워크플로가 그대로 읽는다).
  console.error(notes.concat(`${month}: 초안 있음 · 미발행 → 대상`).map((l) => `  ${l}`).join('\n'));
  console.log(month);
  process.exit(0);
}

console.error(notes.map((l) => `  ${l}`).join('\n'));
console.error(`최근 ${WINDOW}개월에 발행할 달이 없다.`);
