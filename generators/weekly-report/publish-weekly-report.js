// generators/weekly-report/publish-weekly-report.js
'use strict';
// 승인된 주간 리포트 -> weekly_reports upsert (+ pdf_url 있으면 기록).
// 사용법: node generators/weekly-report/publish-weekly-report.js --week=2026-W24 [--pdf-url=https://...]
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '../..');

function arg(name) { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; }

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return meta;
}

async function main() {
  const week = arg('week'); if (!week) throw new Error('--week=YYYY-Www 필요');
  const src = path.join(ROOT, 'content/weekly-report', `${week}.md`);
  const md = fs.readFileSync(src, 'utf-8');
  const meta = parseFrontmatter(md);
  if (meta.status !== 'approved') throw new Error(`승인되지 않음: ${src}`);

  const wn = Number(week.split('-W')[1]);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const row = {
    week_id: week,
    period_start: meta.period_start_iso,
    period_end: meta.period_end_iso,
    title: `${wn}주차 글로벌 물류 시황`,
    body_md: md.replace(/^---[\s\S]*?---\s*/, ''),
    pdf_url: arg('pdf-url') || null,
    published_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('weekly_reports').upsert(row, { onConflict: 'week_id' });
  if (error) throw new Error(error.message);
  console.log(`✅ 웹 발행: weekly_reports/${week}`);
}

main().catch(e => { console.error('발행 실패:', e.message); process.exit(1); });
