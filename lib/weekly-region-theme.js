'use strict';
// weekly-report 테마 복제(standalone). weekly-report 파일을 import/수정하지 않기 위해 CSS·커버·카드·callout·Puppeteer를 복제.
// ⚠ 의도적 임시 중복 — 테마 단일화는 후속 과제. 원본: generators/weekly-report/weekly-report-pdf.js
const puppeteer = require('puppeteer-core');

function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paras(text) {
  let parts = String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  // 폴백: LLM이 단락 구분 없이 한 덩어리로 주면 문장 단위로 ~4단락 분할(가독성)
  if (parts.length === 1) {
    const sents = parts[0].split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean);
    if (sents.length >= 4) {
      const per = Math.ceil(sents.length / Math.min(4, Math.ceil(sents.length / 3)));
      parts = [];
      for (let i = 0; i < sents.length; i += per) parts.push(sents.slice(i, i + per).join(' '));
    }
  }
  return parts.map((p) => `<p>${esc(p)}</p>`).join('\n');
}

// 기사 카드(태그·헤드라인·리드·히어로 이미지·본문·출처). 이미지 없으면 영역 생략.
function cardHtml(it) {
  const L = ['<div class="news-article">'];
  if (it.tag) L.push(`<span class="news-cat">${esc(it.tag)}</span>`);
  L.push(`<div class="news-title">${esc(it.headline)}</div>`);
  if (it.lead) L.push(`<div class="news-sub">${esc(it.lead)}</div>`);
  if (it.image) L.push(`<img class="news-hero" src="${esc(it.image)}" alt="" />`);
  if (it.body) for (const p of String(it.body).split(/\n+/).filter(Boolean)) L.push(`<p class="news-p">${esc(p)}</p>`);
  if (it.source) L.push(`<div class="news-src">출처: ${esc(it.source)}</div>`);
  L.push('</div>');
  return L.join('\n');
}

const CSS = `:root{
  --c-primary:#0070C0; --c-primary-deep:#005599; --c-teal:#008C8C;
  --c-ink:#1A1A1A; --c-body:#333; --c-soft:#555; --c-cap:#888;
  --c-rule:#D9D9D9; --c-zebra:#F2F6FA; --c-thead:#0070C0; --c-up:#C00000; --c-down:#0070C0;
  --font-title:'Pretendard','Noto Sans KR',sans-serif; --font-sans:'Pretendard','Malgun Gothic',sans-serif;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:16mm 0 14mm}
@page cover{margin:0}
body{font-family:var(--font-sans);color:var(--c-body);font-size:10.5pt;line-height:1.62;-webkit-print-color-adjust:exact;print-color-adjust:exact}

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

.flow{padding:0 17mm}
.flow h2{font-family:var(--font-title);font-size:20pt;font-weight:800;color:var(--c-ink);letter-spacing:-.02em;
  padding-bottom:3mm;margin-bottom:6mm;border-bottom:2.5px solid var(--c-primary);break-before:page;break-after:avoid}
.flow h2.first{break-before:avoid}
.flow p{margin:0 0 2.6mm}

p.sowhat{background:#FFF7E6;border-left:4px solid #E0A030;padding:2.6mm 4mm;margin:0 0 5mm;break-after:avoid}

.news-article{margin:0 0 6mm;padding:0 0 5mm;border-bottom:1px solid var(--c-rule);break-inside:avoid}
.news-article .news-cat{display:inline-block;background:var(--c-primary);color:#fff;font-size:7.5pt;font-weight:700;
  letter-spacing:.5px;padding:.8mm 2.6mm;border-radius:3px;margin-bottom:2.4mm}
.news-article .news-title{font-family:var(--font-title);font-size:14.5pt;font-weight:800;color:var(--c-ink);line-height:1.3;margin-bottom:2mm}
.news-article .news-sub{font-size:10pt;color:var(--c-soft);line-height:1.5;margin-bottom:3mm}
.news-article .news-hero{width:100%;height:62mm;object-fit:cover;border-radius:5px;margin-bottom:3.5mm}
.news-article .news-p{font-size:9.6pt;color:var(--c-body);line-height:1.62;margin-bottom:2.2mm}
.news-article .news-src{font-size:8.2pt;color:var(--c-cap);font-style:italic;margin-top:1.5mm}`;

// 렌더 모델 → 전체 HTML. 표지(권역) + 권역 종합 + 블록(제목 + 한국 시사점 callout + 카드들).
function buildRegionHtml(model) {
  const blocksHtml = (model.blocks || []).map((b) => {
    const parts = [`<h2>${esc(b.title)}</h2>`];
    if (b.intro) parts.push(`<p class="sowhat">➔ <strong>한국 화주 시사점:</strong> ${esc(b.intro)}</p>`);
    for (const it of b.items) parts.push(cardHtml(it));
    return parts.join('\n');
  }).join('\n');

  const summaryHtml = model.summary
    ? `<h2 class="first">권역 종합</h2>\n${paras(model.summary)}`
    : '';

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>${CSS}</style></head><body>
<section class="cover">
  <div class="cv-diagonal"></div>
  <div class="cv-top"><div class="cv-brand">LOGISIGHT<small>WEEKLY INTELLIGENCE</small></div></div>
  <div class="cv-mid">
    <div class="cv-kicker">WEEKLY REGIONAL REPORT · ${esc(model.regionEn || '')}</div>
    <div class="cv-title">${esc(model.coverTitle || '')}</div>
    <div class="cv-rule"></div>
    <div class="cv-sub">보고기간 ${esc(model.period || '')}</div>
  </div>
  <div class="cv-foot"><span>LOGISIGHT 권역 인텔리전스</span><span class="cv-vol">${esc(model.week || '')}</span></div>
</section>
<div class="flow">${summaryHtml}
${blocksHtml}</div>
</body></html>`;
}

async function renderPdf(html, outPath) {
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: outPath, format: 'A4', printBackground: true });
  await browser.close();
}

module.exports = { buildRegionHtml, cardHtml, renderPdf, chromePath };
