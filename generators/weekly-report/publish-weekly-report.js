// generators/weekly-report/publish-weekly-report.js
'use strict';
// 승인된 주간 리포트 -> weekly_reports upsert. PDF가 있으면 reports 버킷에 업로드 후 pdf_url 자동 설정.
// 사용법: node generators/weekly-report/publish-weekly-report.js --week=2026-W24 [--pdf-url=https://... (수동 override)]
const REPORTS_BUCKET = 'reports';
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { publishReport } = require('../lib/publish-report');

const ROOT = path.resolve(__dirname, '../..');

function arg(name) { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; }

function parseFrontmatter(md) {
  md = md.replace(/\r\n/g, '\n');                 // CRLF(Windows 체크아웃) 정규화
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

  // PDF가 있으면 Storage(reports)에 업로드하고 공개 URL을 pdf_url로 사용. --pdf-url가 있으면 그것을 우선.
  const objectPath = `weekly/${week}.pdf`;
  let pdfUrl = arg('pdf-url') || null;
  if (!pdfUrl) {
    const pdfPath = path.join(ROOT, 'content/published', `weekly-report-${week}.pdf`);
    if (fs.existsSync(pdfPath)) {
      const { error: upErr } = await supabase.storage.from(REPORTS_BUCKET)
        .upload(objectPath, fs.readFileSync(pdfPath), { contentType: 'application/pdf', upsert: true });
      if (upErr) throw new Error(`PDF 업로드 실패: ${upErr.message}`);
      // 공개 링크는 자체 도메인 경유 — Vercel rewrite(/reports/:type/:file)가 Supabase 스토리지로 프록시
      pdfUrl = `https://logisight.mtlship.com/reports/${objectPath}`;
      console.log(`  PDF 업로드: ${objectPath}`);
    }
  }

  const row = {
    week_id: week,
    period_start: meta.period_start_iso,
    period_end: meta.period_end_iso,
    title: `${wn}주차 글로벌 물류 시황`,
    body_md: md.replace(/^---[\s\S]*?---\s*/, ''),
    pdf_url: pdfUrl,
    published_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('weekly_reports').upsert(row, { onConflict: 'week_id' });
  if (error) throw new Error(error.message);
  console.log(`✅ 웹 발행: weekly_reports/${week}`);

  // 마켓 리포트 카탈로그(reports)에도 등록 — PDF가 있을 때만(pdf_url NOT NULL). 이미 업로드한 PDF 재사용.
  if (pdfUrl) {
    const fmtMD = (d) => d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : '';
    await publishReport({
      type: 'weekly',
      periodStart: meta.period_start_iso,
      periodEnd: meta.period_end_iso,
      periodLabel: `${wn}주차 · ${fmtMD(meta.period_start_iso)}–${fmtMD(meta.period_end_iso)}`,
      title: `${wn}주차 글로벌 물류 시황`,
      pdfUrl,
      pdfKey: objectPath,
      webUrl: null,
    });
  }
}

main().catch(e => { console.error('발행 실패:', e.message); process.exit(1); });
