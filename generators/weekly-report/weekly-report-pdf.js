'use strict';
// 승인된 주간 리포트 마크다운 -> A4 PDF (monthly 디자인 차용: 커버 + 섹션당 페이지 + 뉴스 카드).
// 사용법: node generators/weekly-report/weekly-report-pdf.js --week=2026-W24
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '../..');
const weekArg = process.argv.find(a => a.startsWith('--week='));

function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

function parseFrontmatter(md) {
  md = md.replace(/\r\n/g, '\n');                 // CRLF(Windows 체크아웃) 정규화
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return meta;
}

// 본문에서 첫 '## ' 이후만 사용(표지의 # 제목·정보표는 커버로 대체)
function contentFrom(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, '');
  const i = body.indexOf('## ');
  return i >= 0 ? body.slice(i) : body;
}

// ▲/▼ 셀에 색상 클래스
function colorDeltas(html) {
  return html.replace(/<td>([^<]*[▲▼][^<]*)<\/td>/g, (m, c) =>
    c.includes('▲') ? `<td class="up">${c}</td>` : `<td class="down">${c}</td>`);
}

function buildHtml(meta, contentMd) {
  const wn = Number((meta.week || '').split('-W')[1] || 0);
  let body = marked.parse(contentMd);
  body = colorDeltas(body);
  body = body.replace('<h2>', '<h2 class="first">');                 // 첫 섹션(요약)은 페이지 분할 안 함
  body = body.replace(/<p><strong>결론:/g, '<p class="conclusion"><strong>결론:');
  body = body.replace(/<p>➔/g, '<p class="sowhat">➔');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
:root{
  --c-primary:#0070C0; --c-primary-deep:#005599; --c-teal:#008C8C;
  --c-ink:#1A1A1A; --c-body:#333; --c-soft:#555; --c-cap:#888;
  --c-rule:#D9D9D9; --c-zebra:#F2F6FA; --c-thead:#0070C0; --c-up:#C00000; --c-down:#0070C0;
  --font-title:'Pretendard','Noto Sans KR',sans-serif; --font-sans:'Pretendard','Malgun Gothic',sans-serif;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
/* 모든 페이지(섹션 시작·연속 페이지 공통) 상단·하단 마진. 좌우는 .flow 패딩으로. */
@page{size:A4;margin:16mm 0 14mm}
/* 커버는 풀블리드 — named page로 마진 제거 */
@page cover{margin:0}
body{font-family:var(--font-sans);color:var(--c-body);font-size:10.5pt;line-height:1.62;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* COVER */
.cover{page:cover;width:210mm;height:297mm;position:relative;overflow:hidden;break-after:page;
  background:linear-gradient(160deg,#4D4D4D 0%,#414141 58%,#363636 100%);color:#fff;
  padding:26mm 22mm;display:flex;flex-direction:column;justify-content:space-between}
.cv-diagonal{position:absolute;right:0;bottom:0;width:120mm;height:84mm;z-index:0;
  background:linear-gradient(135deg,var(--c-primary) 0%,var(--c-primary-deep) 100%);
  clip-path:polygon(100% 0,100% 100%,0 100%)}
.cv-top,.cv-mid,.cv-foot{position:relative;z-index:1}
.cv-brand{font-family:var(--font-title);font-weight:800;font-size:16pt;letter-spacing:2px}
.cv-brand small{display:block;font-weight:500;font-size:7pt;letter-spacing:4px;color:#7FC0F0;margin-top:1.5mm}
.cv-mid{margin-top:auto}
.cv-kicker{font-size:9pt;letter-spacing:5px;color:#5EB0EE;font-weight:600;margin-bottom:7mm}
.cv-title{font-family:var(--font-title);font-weight:800;font-size:42pt;line-height:1.1;letter-spacing:-.02em;margin-bottom:7mm}
.cv-rule{width:28mm;height:3px;background:var(--c-primary);margin-bottom:8mm}
.cv-sub{font-size:11pt;color:rgba(255,255,255,.8)}
.cv-foot{display:flex;justify-content:space-between;align-items:flex-end;
  border-top:1px solid rgba(255,255,255,.2);padding-top:6mm;font-size:9pt;color:rgba(255,255,255,.65)}
.cv-vol{font-family:var(--font-title);font-size:13pt;color:#fff;font-weight:800}

/* FLOW (상하 마진은 @page가 담당, 좌우는 패딩) */
.flow{padding:0 17mm}
.flow hr{display:none}
.flow h2{font-family:var(--font-title);font-size:20pt;font-weight:800;color:var(--c-ink);letter-spacing:-.02em;
  padding-bottom:3mm;margin-bottom:6mm;border-bottom:2.5px solid var(--c-primary);break-before:page;break-after:avoid}
.flow h2.first{break-before:avoid}
.flow h3{font-family:var(--font-title);font-size:12.5pt;font-weight:700;color:var(--c-teal);margin:6mm 0 2.5mm;break-after:avoid}
.flow p{margin:0 0 2.6mm}
.flow ul,.flow ol{margin:0 0 3mm 5mm}
.flow li{margin-bottom:1.4mm}

/* 결론 박스 */
p.conclusion{background:var(--c-zebra);border-left:4px solid var(--c-primary);
  padding:3mm 4mm;font-size:11.5pt;color:var(--c-ink);margin:0 0 5mm;break-after:avoid}
/* So-what */
p.sowhat{background:#FFF7E6;border-left:4px solid #E0A030;padding:2.6mm 4mm;margin:4mm 0 0}

/* TABLE */
table{border-collapse:collapse;width:100%;margin:3mm 0 4mm;font-size:9.3pt;break-inside:avoid}
thead th{background:var(--c-thead);color:#fff;font-weight:700;padding:2.2mm 2.6mm;text-align:left;border:1px solid var(--c-primary-deep)}
tbody td{padding:1.9mm 2.6mm;border:1px solid var(--c-rule)}
tbody tr:nth-child(even){background:var(--c-zebra)}
td.up{color:var(--c-up);font-weight:700}
td.down{color:var(--c-down);font-weight:700}
blockquote{color:var(--c-cap);font-size:8.8pt;border-left:3px solid var(--c-rule);margin:1mm 0 4mm;padding-left:3mm}

/* NEWS ARTICLE (logisight-core 기사 형태: 배지·제목·소제목·히어로·본문·출처) */
.news-article{margin:0 0 6mm;padding:0 0 5mm;border-bottom:1px solid var(--c-rule);break-inside:avoid}
.news-article .news-cat{display:inline-block;background:var(--c-primary);color:#fff;font-size:7.5pt;font-weight:700;
  letter-spacing:.5px;padding:.8mm 2.6mm;border-radius:3px;margin-bottom:2.4mm}
.news-article .news-title{font-family:var(--font-title);font-size:14.5pt;font-weight:800;color:var(--c-ink);line-height:1.3;margin-bottom:2mm}
.news-article .news-sub{font-size:10pt;color:var(--c-soft);line-height:1.5;margin-bottom:3mm}
.news-article .news-hero{width:100%;height:62mm;object-fit:cover;border-radius:5px;margin-bottom:3.5mm}
.news-article .news-p{font-size:9.6pt;color:var(--c-body);line-height:1.62;margin-bottom:2.2mm}
.news-article .news-src{font-size:8.2pt;color:var(--c-cap);font-style:italic;margin-top:1.5mm}
</style></head><body>
<section class="cover">
  <div class="cv-diagonal"></div>
  <div class="cv-top"><div class="cv-brand">LOGISIGHT<small>WEEKLY INTELLIGENCE</small></div></div>
  <div class="cv-mid">
    <div class="cv-kicker">WEEKLY LOGISTICS REPORT</div>
    <div class="cv-title">${wn}주차<br>글로벌 물류 시황</div>
    <div class="cv-rule"></div>
    <div class="cv-sub">보고기간 ${meta.period || ''} · 작성 ${meta.generated_at || ''}</div>
  </div>
  <div class="cv-foot"><span>경영기획팀 · 임원회의 보고</span><span class="cv-vol">${meta.week || ''}</span></div>
</section>
<div class="flow">${body}</div>
</body></html>`;
}

async function main() {
  if (!weekArg) throw new Error('--week=YYYY-Www 필요');
  const week = weekArg.split('=')[1];
  const src = path.join(ROOT, 'content/weekly-report', `${week}.md`);
  const md = fs.readFileSync(src, 'utf-8');
  if (!/status:\s*approved/.test(md)) throw new Error(`승인되지 않음(status: approved 아님): ${src}`);

  const meta = parseFrontmatter(md);
  const html = buildHtml(meta, contentFrom(md));

  const outDir = path.join(ROOT, 'content/published');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `weekly-report-${week}.pdf`);

  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: out, format: 'A4', printBackground: true });
  await browser.close();
  console.log(`✅ PDF: ${out}`);
}

if (require.main === module) {
  main().catch(e => { console.error('PDF 생성 실패:', e.message); process.exit(1); });
}

module.exports = { buildHtml, parseFrontmatter, contentFrom };
