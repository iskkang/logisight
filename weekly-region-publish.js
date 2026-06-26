'use strict';
// 권역 리포트 발행 — publish-weekly-report.js / publish-report.js 미러.
// reports 버킷 업로드 + public.reports 카탈로그 upsert. 글로벌과 동일 버킷·인증·스키마 재사용.
// reports 테이블엔 region/meta 컬럼이 없으므로 id·title로 권역 구분(id = weekly-region-<week>-<region>).
// 기본 dry-run(계획만). 실제 발행은 --commit (업로드·insert는 사용자 실행).
// 사용법: node weekly-region-publish.js --week=2026-W26 [--region=americas] [--commit]
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const META = require('./config/region-meta');

// 프론트 권역 매트릭스 컬럼명과 1:1 일치하는 정식 권역명. region-meta.kr('미주 권역'/'극동·CIS 권역')과
// 다르며, 매트릭스 매칭을 위해 괄호 포함 형태로 통일한다(특히 극동 = '극동(러시아·CIS)').
const REGION_KR = {
  americas: '미주',
  europe: '유럽',
  russia: '극동(러시아·CIS)',
  latam: '남미',
};

const BUCKET = 'reports';
const PUB_DIR = path.join(__dirname, 'content/published');
const JSON_DIR = path.join(__dirname, 'content/weekly-region');
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };

// ISO 주차 → 보고기간(월~일) ISO 날짜
function isoWeekRange(weekId) {
  const [y, w] = weekId.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4); week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const mon = new Date(week1Mon); mon.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startISO: iso(mon), endISO: iso(sun) };
}

// week에 대해 발행 대상(PDF 존재) 권역 수집
function targets(week, only) {
  if (!fs.existsSync(PUB_DIR)) return [];
  const re = new RegExp('^weekly-report-' + week.replace(/[-]/g, '\\-') + '-([a-z]+)\\.pdf$');
  return fs.readdirSync(PUB_DIR)
    .map((f) => { const m = f.match(re); return m ? { region: m[1], file: f } : null; })
    .filter(Boolean)
    .filter((t) => !only || t.region === only)
    .filter((t) => META[t.region]);   // region-meta 있는 권역만
}

function plan(week, t) {
  const meta = META[t.region];
  const jsonPath = path.join(JSON_DIR, `${week}-${t.region}.json`);
  const j = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) : {};
  const label = j.label || meta.kr;                         // 예: '미주'
  const { startISO, endISO } = isoWeekRange(week);
  const period = j.period || '';                            // 'MM/DD~MM/DD'
  const summary = j.selection && j.selection.content ? String(j.selection.content).slice(0, 160) : null;
  return {
    region: t.region,
    localPdf: path.join(PUB_DIR, t.file),
    bucketPath: `weekly-region/${week}-${t.region}.pdf`,
    id: `weekly-region-${week}-${t.region}`,                // upsert 키(type+week+region)
    type: 'weekly-region',
    title: `주간 권역 리포트 · ${label} (${week})`,
    period_start: startISO,
    period_end: endISO,
    period_label: period ? `${label} · ${period}` : label,
    summary,
    // 분류(048): 주간 권역. region은 프론트 매트릭스 컬럼명과 일치(meta.kr 아님), iso_week는 주차.
    report_class: 'weekly_regional',
    region: REGION_KR[t.region] || (META[t.region] && META[t.region].kr) || t.region,
    iso_week: week,
  };
}

async function main() {
  const week = arg('week'); if (!week) throw new Error('--week=YYYY-Www 필요');
  const only = arg('region');
  const commit = process.argv.includes('--commit');

  const ts = targets(week, only);
  if (!ts.length) { console.log(`발행 대상 PDF 없음: ${week}${only ? ' / ' + only : ''} (content/published/weekly-report-${week}-*.pdf)`); return; }

  const plans = ts.map((t) => plan(week, t));
  console.log(`발행 대상 ${plans.length}건 (${commit ? 'COMMIT' : 'DRY-RUN'}):`);
  for (const p of plans) {
    console.log(`  - [${p.region}] ${path.basename(p.localPdf)}`);
    console.log(`      bucket : ${BUCKET}/${p.bucketPath}`);
    console.log(`      id     : ${p.id}`);
    console.log(`      title  : ${p.title}`);
    console.log(`      period : ${p.period_start}~${p.period_end} (${p.period_label})`);
  }

  if (!commit) {
    console.log('\n[dry-run] 업로드/insert 없음. 실제 발행: --commit 추가.');
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  for (const p of plans) {
    const { error: upErr } = await sb.storage.from(BUCKET)
      .upload(p.bucketPath, fs.readFileSync(p.localPdf), { contentType: 'application/pdf', upsert: true });
    if (upErr) throw new Error(`[${p.region}] PDF 업로드 실패: ${upErr.message}`);
    const pdfUrl = sb.storage.from(BUCKET).getPublicUrl(p.bucketPath).data.publicUrl;

    const row = {
      id: p.id,
      type: p.type,
      period_start: p.period_start,
      period_end: p.period_end,
      period_label: p.period_label,
      title: p.title,
      summary: p.summary,
      pdf_path: p.bucketPath,
      pdf_url: pdfUrl,
      web_url: null,
      cover_url: null,
      report_class: p.report_class, // 'weekly_regional'
      region: p.region, // 미주/유럽/극동(러시아·CIS)
      iso_week: p.iso_week, // 'YYYY-Www'
      published_at: new Date().toISOString(),
    };
    const { error } = await sb.from('reports').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`[${p.region}] reports upsert 실패: ${error.message}`);
    console.log(`✅ [${p.region}] 발행: ${pdfUrl}`);
  }
}

main().catch((e) => { console.error('발행 실패:', e.message); process.exit(1); });
