'use strict';
// generators/report/monthly-report-pdf.js
// 월간 리포트 마크다운 → PDF (프리미엄 네이비/골드: 표지·목차·섹션 디바이더)
// 사용법: node generators/report/monthly-report-pdf.js [--month=2026-05]

const fs         = require('fs');
const path       = require('path');
const { marked } = require('marked');
const puppeteer  = require('puppeteer-core');
const { buildChart } = require('./lib/chart-data');

const TODAY    = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find(a => a.startsWith('--month='));
const MONTH    = monthArg ? monthArg.split('=')[1] : TODAY.slice(0, 7);
const [YY, MM] = MONTH.split('-');
const VOL      = MM;                       // 5월 → "05"
let   PUB      = TODAY;                     // 발행일(아래 main에서 md의 발행일로 보정)

const MD_PATH  = path.resolve(__dirname, `../../content/drafts/monthly-analysis-${MONTH}.md`);
const OUT_DIR  = path.resolve(__dirname, '../../content/published');
const OUT_PATH = path.join(OUT_DIR, `monthly-analysis-${MONTH}.pdf`);

function loadMarkdown() {
  if (!fs.existsSync(MD_PATH)) {
    console.error(`ERROR: ${MD_PATH} 없음`);
    console.error('먼저 실행: node generators/report/assemble-monthly-report.js --force');
    process.exit(1);
  }
  return fs.readFileSync(MD_PATH, 'utf-8').replace(/<!--[\s\S]*?-->/g, '').trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 헤딩 분류:
//  "NN. ..."  → 풀블리드 섹션 디바이더 (예: "02. 해운 시황")
//  "주요 해운 기사" → 디바이더
//  "NN-N. ..." 및 기타 헤딩 → 서브섹션 제목(자기 페이지, 골드 밑줄)
//  디바이더 직후 첫 제목은 lead → 페이지 강제개행 없이 디바이더 다음 페이지에 자연 배치
function transformBody(bodyHtml) {
  // 선두 메타 제거: 첫 H1(리포트 제목) + 첫 blockquote(발행일) + 첫 hr
  bodyHtml = bodyHtml.replace(/^\s*<h1>[^<]*<\/h1>\s*/i, '');
  bodyHtml = bodyHtml.replace(/^\s*<blockquote>[\s\S]*?<\/blockquote>\s*/i, '');
  bodyHtml = bodyHtml.replace(/^\s*<hr\s*\/?>\s*/i, '');

  const toc = [];
  let leadNext = false;

  const html = bodyHtml.replace(/<(h[123])>([\s\S]*?)<\/\1>/g, (m, tag, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const mSec = text.match(/^(\d{1,2})\.\s+(.+)$/);     // "02. 해운 시황"
    const isArticles = /^주요\s*해운\s*기사$/.test(text);
    const mSub = text.match(/^(\d{1,2}-\d)\.\s+(.+)$/);  // "02-1. KCCI ..."

    if (mSec || isArticles) {
      const num = mSec ? mSec[1] : '·';
      const title = mSec ? mSec[2] : '주요 해운 기사';
      toc.push({ num, title });
      leadNext = true;
      return `<section class="divider"><div class="dv-tag">SECTION ${num}</div>`
        + `<div class="dv-num">${num}</div><div class="dv-rule"></div>`
        + `<h2 class="dv-title">${escapeHtml(title)}</h2></section>`;
    }
    const cls = leadNext ? 'sub lead' : 'sub';
    leadNext = false;
    const t2 = mSub
      ? `<span class="sub-no">${mSub[1]}</span>${escapeHtml(mSub[2])}`
      : escapeHtml(text);
    return `<h2 class="${cls}">${t2}</h2>`;
  });

  return { html, toc };
}

// 표 셀 등락: ▲ 적색 / ▼ 청색
function colorDeltas(html) {
  return html.replace(/<td>([^<]*?[▲▼][^<]*?)<\/td>/g, (m, c) => {
    if (c.includes('▲')) return `<td class="up">${c}</td>`;
    if (c.includes('▼')) return `<td class="down">${c}</td>`;
    return m;
  });
}

function buildHtml(transformed, chartConfigs = []) {
  const chartScript = chartConfigs.length ? `
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
const CFG = ${JSON.stringify(chartConfigs)};
CFG.forEach(c => {
  const el = document.getElementById('chart_' + c.id);
  if (!el) return;
  new Chart(el, { type:'line', data:c.data, options:{
    responsive:true, maintainAspectRatio:false, animation:false,
    plugins:{ title:{display:false},
      legend:{position:'bottom',labels:{font:{size:9},boxWidth:14,color:'#3a4654'}} },
    scales:{
      x:{ticks:{font:{size:7},maxRotation:45,autoSkip:true,maxTicksLimit:10,color:'#6b7682'},grid:{display:false}},
      y:{ticks:{font:{size:7},color:'#6b7682'},grid:{color:'#efeadd'}}
    }
  }});
});
window.__chartsReady = true;
</script>` : '';

  const tocRows = transformed.toc.map(t =>
    `<li><span class="toc-no">${t.num}</span><span class="toc-tt">${escapeHtml(t.title)}</span></li>`
  ).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
:root{--serif:'Fraunces','Noto Serif KR',serif;--sans:'Pretendard','Noto Sans KR',sans-serif;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── PAGE GEOMETRY ──────────────────────────────────────────────
   본문 18/17/16mm, 풀블리드 페이지는 margin:0.
   풀블리드 박스 높이는 296mm (페이지=297mm) — 정확히 297mm로 두면 Chrome이
   1px 단편을 다음 페이지로 흘려 '네이비 띠 + 빈 페이지'가 생기므로 296mm로 고정.
   ── 이 두 줄 + 296mm 가 빈 페이지/제목 누락의 핵심 수정점 ── */
@page{size:A4;margin:18mm 17mm 16mm}
@page bleed{size:A4;margin:0}
.cover,.divider,.toc{page:bleed}

body{font-family:var(--sans);color:#1f2a37;font-size:10pt;line-height:1.72;
  background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* ── COVER ── */
.cover{width:210mm;height:296mm;background:
  radial-gradient(120% 80% at 78% 12%,#143a5a 0%,#0d2741 55%,#0a1f34 100%);
  color:#fff;padding:24mm 22mm;display:flex;flex-direction:column;
  justify-content:space-between;overflow:hidden;break-after:page}
.cv-top{display:flex;align-items:center;gap:5mm}
.cv-mark{width:11mm;height:11mm;flex:0 0 auto}
.cv-brand{font-family:var(--serif);font-weight:900;font-size:15pt;letter-spacing:3px}
.cv-brand small{display:block;font-family:var(--sans);font-weight:400;font-size:7pt;
  letter-spacing:4px;color:#c9a14a;margin-top:1mm}
.cv-mid{margin-top:auto}
.cv-kicker{font-size:9pt;letter-spacing:5px;color:#c9a14a;font-weight:500;margin-bottom:7mm}
.cv-title{font-family:var(--serif);font-weight:900;font-size:33pt;line-height:1.18;margin-bottom:7mm}
.cv-rule{width:26mm;height:2px;background:#a07d36;margin:0 0 8mm}
.cv-issue{font-family:var(--serif);font-size:13pt;color:#c9a14a;font-weight:700;margin-bottom:7mm}
.cv-sub{font-size:11pt;color:rgba(255,255,255,.75);font-weight:300;max-width:150mm;line-height:1.7}
.cv-foot{display:flex;justify-content:space-between;align-items:flex-end;
  border-top:1px solid rgba(255,255,255,.16);padding-top:6mm;font-size:8.5pt;color:rgba(255,255,255,.6)}
.cv-foot strong{color:#fff;font-weight:600}
.cv-vol{font-family:var(--serif);font-size:13pt;color:#c9a14a;font-weight:700}

/* ── TABLE OF CONTENTS ── */
.toc{width:210mm;height:296mm;background:#fbfaf6;padding:26mm 24mm;overflow:hidden;break-after:page}
.toc-h{font-family:var(--serif);font-size:9pt;letter-spacing:6px;color:#a07d36;font-weight:600;margin-bottom:3mm}
.toc-h2{font-family:var(--serif);font-size:24pt;color:#0d2741;font-weight:900;
  border-bottom:2px solid #a07d36;padding-bottom:5mm;margin-bottom:9mm}
.toc ol{list-style:none}
.toc li{display:flex;align-items:baseline;gap:6mm;padding:4mm 0;border-bottom:1px solid #e7e1d2}
.toc-no{font-family:var(--serif);font-size:14pt;font-weight:700;color:#a07d36;min-width:14mm}
.toc-tt{font-size:11.5pt;color:#1f2a37;font-weight:500}

/* ── SECTION DIVIDER (풀블리드) ── */
.divider{width:210mm;height:296mm;
  background:radial-gradient(120% 80% at 22% 80%,#143a5a 0%,#0d2741 60%,#0a1f34 100%);
  color:#fff;padding:30mm 24mm;display:flex;flex-direction:column;justify-content:center;
  overflow:hidden}
.dv-tag{font-size:9pt;letter-spacing:6px;color:#c9a14a;font-weight:500;margin-bottom:6mm}
.dv-num{font-family:var(--serif);font-size:96pt;font-weight:900;line-height:.9;color:rgba(160,125,54,.92)}
.dv-rule{width:30mm;height:2px;background:#a07d36;margin:8mm 0}
.dv-title{font-family:var(--serif);font-size:27pt;font-weight:900;color:#fff;border:none;padding:0;margin:0}

/* ── FLOW CONTENT ── */
.flow{padding-top:1mm}
.flow>:first-child{margin-top:0}
hr{display:none}

/* 서브섹션 제목 = 자기 페이지에서 시작(골드 밑줄). 디바이더 직후 첫 제목만 lead */
h2.sub{font-family:var(--serif);font-size:18pt;font-weight:900;color:#0d2741;
  margin:0 0 7mm;padding-bottom:3mm;border-bottom:2.5px solid #a07d36;
  break-before:page;break-after:avoid}
h2.sub.lead{break-before:auto}
h2.sub .sub-no{font-family:var(--serif);color:#a07d36;font-weight:700;margin-right:3mm}
h3{font-family:var(--serif);font-size:12pt;font-weight:700;color:#143a5a;margin:6mm 0 2.5mm;break-after:avoid}

p{font-size:10pt;line-height:1.85;color:#33404e;margin:0 0 3.4mm}
strong{color:#0d2741;font-weight:700}
ul,ol{padding-left:6mm;margin:0 0 3.4mm}
li{font-size:9.7pt;line-height:1.75;color:#33404e;margin-bottom:1mm}

/* 콜아웃(blockquote) — 골드 좌측바 */
blockquote{background:#f7f3e8;border-left:3px solid #a07d36;border-radius:0 6px 6px 0;
  padding:4mm 6mm;margin:5mm 0;break-inside:avoid}
blockquote p{font-size:9.6pt;color:#143a5a;font-weight:500;margin:0;line-height:1.7}

/* 데이터 표 */
table{width:100%;border-collapse:collapse;margin:4mm 0 5mm;font-size:9pt;break-inside:avoid}
thead th{font-family:var(--sans);font-weight:700;color:#0d2741;text-align:right;
  padding:2.6mm 3mm;border-bottom:2px solid #a07d36;background:#faf7ef;white-space:nowrap}
thead th:first-child{text-align:left}
tbody td{padding:2.3mm 3mm;border-bottom:1px solid #ece6d8;text-align:right;color:#33404e;
  font-variant-numeric:tabular-nums}
tbody td:first-child{text-align:left;color:#0d2741;font-weight:600}
tbody tr:nth-child(even) td{background:#fcfbf6}
td.up{color:#c0392b;font-weight:600}
td.down{color:#1d63c4;font-weight:600}

/* 차트 카드 */
.chart-box{height:64mm;background:#fbfaf6;border:1px solid #ece6d8;border-radius:8px;
  padding:4mm 4mm 3mm;margin:4mm 0 5mm;break-inside:avoid}
.chart-box canvas{max-width:100%}

/* 기사 이미지 */
.flow img{display:block;width:100%;height:auto;max-height:95mm;object-fit:cover;
  border-radius:8px;margin:4mm 0 5mm;break-inside:avoid}
.flow p em{color:#8a93a0;font-style:italic;font-size:8.5pt}
.flow p:last-child em{color:#9aa3af}
</style>
</head>
<body>

<section class="cover">
  <div class="cv-top">
    <svg class="cv-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" stroke="#c9a14a" stroke-width="1.4"/>
      <path d="M20 5 L23 18 L35 20 L23 22 L20 35 L17 22 L5 20 L17 18 Z" fill="#c9a14a"/>
    </svg>
    <div class="cv-brand">LOGISIGHT<small>MARITIME INTELLIGENCE</small></div>
  </div>
  <div class="cv-mid">
    <div class="cv-kicker">GLOBAL LOGISTICS &amp; MARKET INTELLIGENCE</div>
    <div class="cv-title">월간 시장<br>인텔리전스 리포트</div>
    <div class="cv-rule"></div>
    <div class="cv-issue">${Number(YY)}년 ${Number(MM)}월호 · VOL.${VOL}</div>
    <div class="cv-sub">글로벌 해운·항공·철도 운임과 공급망·지정학 동향 종합 분석</div>
  </div>
  <div class="cv-foot">
    <div>STRATEGIC INTELLIGENCE FOR GLOBAL SHIPPING<br><strong>발행 ${PUB}</strong></div>
    <div class="cv-vol">VOL.${VOL}</div>
  </div>
</section>

<section class="toc">
  <div class="toc-h">CONTENTS</div>
  <div class="toc-h2">목차</div>
  <ol>${tocRows}</ol>
</section>

<main class="flow">
${transformed.html}
</main>
${chartScript}
</body></html>`;
}

async function main() {
  console.log(`⏳ ${MONTH} 월간 리포트 PDF 생성 중...`);
  const md = loadMarkdown();

  // md 선두 blockquote의 발행일을 표지에 반영 (없으면 오늘 날짜)
  const pubMatch = md.match(/발행일[^\d]{0,8}(\d{4}-\d{2}-\d{2})/);
  if (pubMatch) PUB = pubMatch[1];

  let bodyHtml = marked.parse(md);

  // 차트 토큰 치환: [[CHART:id]] → 차트 카드
  const ids = [];
  const tokenRe = /<p>\s*\[\[CHART:([a-z0-9_]+)\]\]\s*<\/p>|\[\[CHART:([a-z0-9_]+)\]\]/g;
  bodyHtml = bodyHtml.replace(tokenRe, (_m, a, b) => {
    const id = a || b; ids.push(id);
    return `<figure class="chart-box"><canvas id="chart_${id}"></canvas></figure>`;
  });

  const chartConfigs = [];
  for (const id of [...new Set(ids)]) {
    const c = await buildChart(id);
    if (c) { chartConfigs.push(c); console.log(`  ✓ 차트 ${id}: ${c.data.datasets.length}계열`); }
    else   { console.warn(`  ⚠️ 차트 ${id} 데이터 없음 — 빈 자리 처리`); }
  }

  // 헤딩 분류(디바이더/서브섹션) + 목차 수집, 표 등락 색상
  const transformed = transformBody(bodyHtml);
  transformed.html = colorDeltas(transformed.html);

  const html = buildHtml(transformed, chartConfigs);

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    console.log('⏳ 페이지 로드 중 (Fraunces·Pretendard CDN, Chart.js)...');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    if (chartConfigs.length) {
      await page.evaluate(() => new Promise(res => {
        let n = 0;
        const t = setInterval(() => { if (window.__chartsReady || n++ > 25) { clearInterval(t); res(); } }, 100);
      }));
      await new Promise(r => setTimeout(r, 450));  // 캔버스 페인트 여유
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    // ── margin/format 제거, preferCSSPageSize:true 로 CSS @page(풀블리드 포함) 사용 ──
    await page.pdf({
      path:            OUT_PATH,
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log(`✅ PDF 완료: ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('❌ monthly-report-pdf.js 실패:', err.message);
  process.exit(1);
});
