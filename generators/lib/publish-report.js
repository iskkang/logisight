'use strict';
// generators/lib/publish-report.js
// 리포트(주간/월간) 발행 헬퍼 — PDF/표지를 reports 버킷에 업로드(필요 시)하고
// public.reports 카탈로그에 upsert(덮어쓰기 = 재발행 안전).
// 호출 측에서 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)를 미리 로드해야 한다.
const fs = require('fs');
const ws = require('ws'); globalThis.WebSocket = ws;
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'reports';

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * 리포트 PDF를 reports 버킷에 발행하고 reports 카탈로그에 등록한다.
 * @param {object} inp
 * @param {'weekly'|'monthly'} inp.type
 * @param {string} inp.periodStart  'YYYY-MM-DD' (주간=월요일 / 월간=1일) — id·스토리지 키에 사용
 * @param {string} inp.periodEnd    'YYYY-MM-DD'
 * @param {string} inp.periodLabel  표시용 라벨
 * @param {string} inp.title
 * @param {string} [inp.summary]
 * @param {string|null} [inp.webUrl]
 * @param {string} [inp.pdfPath]    로컬 PDF — 주면 reports 버킷에 업로드
 * @param {string} [inp.pdfUrl]     이미 업로드된 PDF 공개 URL — 주면 업로드 생략(pdfKey와 함께)
 * @param {string} [inp.pdfKey]     이미 업로드된 스토리지 경로
 * @param {string} [inp.coverPath]  로컬 표지 이미지(선택)
 * @returns {Promise<{id: string, pdfUrl: string}>}
 */
async function publishReport(inp) {
  const sb = client();
  const id = `${inp.type}-${inp.periodStart}`;

  // ① PDF: 이미 업로드돼 있으면 재사용, 아니면 reports 버킷에 업로드
  let pdfKey = inp.pdfKey || null;
  let pdfUrl = inp.pdfUrl || null;
  if (!pdfUrl) {
    if (!inp.pdfPath) throw new Error('pdfPath 또는 (pdfUrl + pdfKey) 필요');
    pdfKey = `${inp.type}/${inp.periodStart}.pdf`;
    const pdfBuf = fs.readFileSync(inp.pdfPath);
    const { error } = await sb.storage.from(BUCKET)
      .upload(pdfKey, pdfBuf, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`PDF 업로드 실패: ${error.message}`);
    // 재발행 시 URL이 동일해 브라우저/CDN이 옛 파일을 보여주는 문제 방지 —
    // 콘텐츠 해시 버전 쿼리를 붙여 파일이 바뀌면 URL도 바뀌게 한다(스토리지 경로는 동일).
    const ver = require('crypto').createHash('md5').update(pdfBuf).digest('hex').slice(0, 8);
    pdfUrl = sb.storage.from(BUCKET).getPublicUrl(pdfKey).data.publicUrl + `?v=${ver}`;
    console.log(`  PDF 업로드: ${pdfKey} (v=${ver})`);
  }
  if (!pdfKey) throw new Error('pdfKey 누락 (pdf_path NOT NULL)');

  // ①b 표지(선택)
  let coverUrl = null;
  if (inp.coverPath) {
    const coverKey = `${inp.type}/${inp.periodStart}.png`;
    const { error } = await sb.storage.from(BUCKET)
      .upload(coverKey, fs.readFileSync(inp.coverPath), { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`표지 업로드 실패: ${error.message}`);
    coverUrl = sb.storage.from(BUCKET).getPublicUrl(coverKey).data.publicUrl;
  }

  // ② reports 카탈로그 upsert
  const row = {
    id,
    type: inp.type,
    period_start: inp.periodStart,
    period_end: inp.periodEnd,
    period_label: inp.periodLabel,
    title: inp.title,
    summary: inp.summary ?? null,
    pdf_path: pdfKey,
    pdf_url: pdfUrl,
    web_url: inp.webUrl ?? null,
    cover_url: coverUrl,
    published_at: new Date().toISOString(),
  };
  const { error } = await sb.from('reports').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`reports upsert 실패: ${error.message}`);

  console.log(`✅ reports 카탈로그: ${id} → ${pdfUrl}`);
  return { id, pdfUrl };
}

module.exports = { publishReport };
