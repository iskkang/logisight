'use strict';
// generators/lib/publish-report.js
// 리포트(주간/월간) 발행 헬퍼 — PDF/표지를 reports 버킷에 업로드(필요 시)하고
// public.reports 카탈로그에 upsert(덮어쓰기 = 재발행 안전).
// 호출 측에서 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)를 미리 로드해야 한다.
const fs = require('fs');
const ws = require('ws'); globalThis.WebSocket = ws;
const { createClient } = require('@supabase/supabase-js');
const { SITE_URL } = require('./site');

const BUCKET = 'reports';
// 공개 링크는 자체 도메인 경유 — Vercel rewrite(/reports/:type/:file)가 Supabase 스토리지로 프록시

/** 언어별 정본 도메인. PDF 공개 URL이 이 호스트를 탄다. */
const SITE_BY_LANG = { ko: SITE_URL, ja: 'https://jpn.logisight.net' };

/**
 * id·스토리지 키의 언어 접두사.
 *
 * 처음엔 `${type}-${periodStart}`만 썼다. reports 테이블과 스토리지 버킷을 한국판·일본판이
 * 공유하는데 언어 차원이 없어, 일본 6월호를 발행하자 같은 id·같은 경로로 한국 6월호를
 * DB 행과 PDF 양쪽에서 덮어썼다. 언어는 키에 반드시 들어가야 한다.
 * 한국판은 기존 id를 유지해야 하므로(발행 이력·링크) 접두사를 붙이지 않는다.
 */
const langPrefix = (lang) => (lang === 'ko' ? '' : `${lang}-`);
const langDir = (lang) => (lang === 'ko' ? '' : `${lang}/`);

/** 카탈로그 id. 언어가 빠지면 다른 언어의 같은 기간 리포트를 덮어쓴다. */
const reportId = (type, periodStart, lang = 'ko') => `${langPrefix(lang)}${type}-${periodStart}`;
/** 스토리지 키. 마찬가지로 언어가 빠지면 PDF를 덮어쓴다. */
const reportPdfKey = (type, periodStart, lang = 'ko') => `${langDir(lang)}${type}/${periodStart}.pdf`;
/** 공개 URL의 호스트. */
const reportSite = (lang = 'ko') => SITE_BY_LANG[lang] ?? SITE_URL;

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
/**
 * ISO 8601 주차 문자열. "2026-08-03" → "2026-W32".
 *
 * 주간 리포트의 영구링크 파라미터가 이 값이다(/reports/weekly/2026-W32).
 * 지금까지 reports.iso_week 를 아무도 채우지 않아 전부 null 이었고, 그래서 sitemap 이
 * 주간 리포트 개별 호를 실을 수 없었다 —— 카탈로그(/reports)만 색인되고 각 호는 안 됐다.
 *
 * 소비하는 쪽(sitemap)에서 period_start 로 계산할 수도 있지만, 그러면 같은 규칙이 두
 * 군데로 갈린다. 값은 발행 시점에 한 번 기록한다.
 *
 * ISO 규칙: 그 주의 목요일이 속한 해가 그 주의 연도다(연말연시에 해가 넘어간다).
 */
function isoWeekOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;            // 월=1 … 일=7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);    // 그 주의 목요일로 이동
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function publishReport(inp) {
  const sb = client();
  const lang = inp.lang ?? 'ko';
  const site = reportSite(lang);
  const id = reportId(inp.type, inp.periodStart, lang);

  // ① PDF: 이미 업로드돼 있으면 재사용, 아니면 reports 버킷에 업로드
  let pdfKey = inp.pdfKey || null;
  let pdfUrl = inp.pdfUrl || null;
  if (!pdfUrl) {
    if (!inp.pdfPath) throw new Error('pdfPath 또는 (pdfUrl + pdfKey) 필요');
    pdfKey = reportPdfKey(inp.type, inp.periodStart, lang);
    const pdfBuf = fs.readFileSync(inp.pdfPath);
    const { error } = await sb.storage.from(BUCKET)
      .upload(pdfKey, pdfBuf, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`PDF 업로드 실패: ${error.message}`);
    // 재발행 시 URL이 동일해 브라우저/CDN이 옛 파일을 보여주는 문제 방지 —
    // 콘텐츠 해시 버전 쿼리를 붙여 파일이 바뀌면 URL도 바뀌게 한다(스토리지 경로는 동일).
    const ver = require('crypto').createHash('md5').update(pdfBuf).digest('hex').slice(0, 8);
    pdfUrl = `${site}/reports/${pdfKey}?v=${ver}`;
    console.log(`  PDF 업로드: ${pdfKey} (v=${ver})`);
  }
  if (!pdfKey) throw new Error('pdfKey 누락 (pdf_path NOT NULL)');

  // ①b 표지(선택)
  let coverUrl = null;
  if (inp.coverPath) {
    const coverKey = `${langDir(lang)}${inp.type}/${inp.periodStart}.png`;
    const { error } = await sb.storage.from(BUCKET)
      .upload(coverKey, fs.readFileSync(inp.coverPath), { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`표지 업로드 실패: ${error.message}`);
    coverUrl = `${site}/reports/${coverKey}`;
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
    // reports 테이블은 한국판·일본판이 공유한다. 언어를 안 박으면 기본값 'ko'가 되어
    // 일본 리포트가 한국 사이트 목록에 뜬다(migration 20260804000002).
    lang,
    // 주간만 주차를 기록한다. 월간·권역은 이 파라미터를 쓰지 않는다.
    // 이 값이 비면 sitemap 이 그 호의 영구링크를 만들지 못한다.
    ...(inp.type === 'weekly' ? { iso_week: isoWeekOf(inp.periodStart) } : {}),
  };
  const { error } = await sb.from('reports').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`reports upsert 실패: ${error.message}`);

  console.log(`✅ reports 카탈로그: ${id} → ${pdfUrl}`);
  return { id, pdfUrl };
}

module.exports = { publishReport, reportId, reportPdfKey, reportSite, isoWeekOf };
