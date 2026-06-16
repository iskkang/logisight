// generators/weekly-report/generate-weekly-report.js
'use strict';
// 주간 리포트 초안 생성: 데이터 조립 -> DeepSeek -> 마크다운 -> content/weekly-report/YYYY-Www.md
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../lib/deepseek');
const { assembleWeeklyData } = require('./lib/weekly-data');
const { buildMessages } = require('./lib/prompt');
const { assembleMarkdown } = require('./lib/assemble');

const OUT_DIR = path.resolve(__dirname, '../../content/weekly-report');

async function main() {
  const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

  const wd = await assembleWeeklyData(supabase, new Date());
  const { system, messages } = buildMessages(wd);
  const llm = await callDeepSeekJson({ system, messages, max_tokens: 4096 });
  const md = assembleMarkdown(wd, llm);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${wd.weekId}.md`);
  fs.writeFileSync(out, md, 'utf-8');
  console.log(`✅ 주간 리포트 초안: ${out} (${wd.weekId}, ${wd.period.start}~${wd.period.end})`);
}

main().catch(e => { console.error('주간 리포트 생성 실패:', e.message); process.exit(1); });
