'use strict';
// generators/report/monthly-report-pdf.js
// 월간 리포트 마크다운 → PDF 변환 (Chart.js 차트 주입 포함)
// 사용법:
//   node monthly-report-pdf.js
//   node monthly-report-pdf.js --month=2026-04

const fs        = require('fs');
const path      = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');
const { buildChart } = require('./lib/chart-data');

const TODAY    = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find(a => a.startsWith('--month='));
const MONTH    = monthArg ? monthArg.split('=')[1] : TODAY.slice(0, 7);

const MD_PATH  = path.resolve(__dirname, `../../content/drafts/monthly-analysis-${MONTH}.md`);
const OUT_DIR  = path.resolve(__dirname, '../../content/published');
const OUT_PATH = path.join(OUT_DIR, `monthly-analysis-${MONTH}.pdf`);

function loadMarkdown() {
  if (!fs.existsSync(MD_PATH)) {
    console.error(`ERROR: ${MD_PATH} 없음`);
    console.error('먼저 실행하세요: node generators/report/assemble-monthly-report.js');
    process.exit(1);
  }
  return fs.readFileSync(MD_PATH, 'utf-8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

function buildHtml(bodyHtml, chartConfigs = []) {
  // 표지가 제목을 대신하므로, 조립 머리말(리포트 제목 h1 + 발행일 인용구 + hr) 제거
  bodyHtml = bodyHtml.replace(
    /^\s*<h1>[\s\S]*?<\/h1>\s*(?:<blockquote>[\s\S]*?<\/blockquote>\s*)?(?:<hr\s*\/?>\s*)?/i, ''
  );

  const [yy, mm] = (MONTH || '').split('-');
  const koMonth  = yy && mm ? `${yy}년 ${parseInt(mm, 10)}월호` : MONTH;
  const vol      = mm ? `VOL.${mm}` : '';

  const COMPASS = `<svg class="compass" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="46" stroke="#c7a85d" stroke-width="2.5"/><circle cx="50" cy="50" r="34" stroke="#c7a85d" stroke-width="1" opacity=".5"/><path d="M50 12 L58 50 L50 88 L42 50 Z" fill="#c7a85d"/><path d="M12 50 L50 42 L88 50 L50 58 Z" fill="#fff" opacity=".85"/><circle cx="50" cy="50" r="4" fill="#0d2741" stroke="#c7a85d" stroke-width="1.5"/></svg>`;

  const chartScript = chartConfigs.length ? `
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
const PAL = ['#0d2741','#a07d36','#1f5b96','#7a8a99','#c7a85d'];
const CFG = ${JSON.stringify(chartConfigs)};
CFG.forEach(c => {
  const el = document.getElementById('chart_' + c.id);
  if (!el) return;
  (c.data.datasets || []).forEach((d, i) => {
    d.borderColor = PAL[i % PAL.length];
    d.backgroundColor = 'transparent';
    d.borderWidth = 2; d.pointRadius = 0; d.tension = 0.32;
  });
  new Chart(el, {
    type: 'line', data: c.data,
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      font: { family: 'Pretendard' },
      plugins: {
        title: { display: false },
        legend: { position: 'bottom', labels: { font: { size: 9, family: 'Pretendard' }, color: '#717b86', boxWidth: 14, boxHeight: 2, usePointStyle: false } }
      },
      scales: {
        x: { ticks: { font: { size: 7, family: 'Pretendard' }, color: '#9aa3ad', maxRotation: 0, autoSkip: true, maxTicksLimit: 9 }, grid: { display: false }, border: { color: '#d4c8ac' } },
        y: { ticks: { font: { size: 7, family: 'Pretendard' }, color: '#9aa3ad' }, grid: { color: '#eee5d2' }, border: { display: false } }
      }
    }
  });
});
window.__chartsReady = true;
</script>` : '';

  const cover = `
<section class="cover">
  <div class="cv-top">${COMPASS}<div class="cv-brand">LOGISIGHT<small>MARITIME INTELLIGENCE</small></div></div>
  <div class="cv-eyebrow">Global Logistics &amp; Market Intelligence</div>
  <h1 class="cv-title">월간 시장<br>인텔리전스 <b>리포트</b></h1>
  <div class="cv-sub">글로벌 해운·항공·철도 운임과 공급망·지정학 동향 종합 분석</div>
  <div class="cv-edition">${koMonth}${vol ? ' · ' + vol : ''}</div>
  <div class="cv-foot"><span>Strategic Intelligence for Global Shipping</span><span>발행 ${TODAY}</span></div>
</section>`;

  const toc = [
    ['01','이번 달 핵심 &amp; 시황 총론','호르무즈 봉쇄와 운임 전 항로 반등'],
    ['02','해운 시황','KCCI · SCFI · CCFI · WCI · BDI 지수별 분석'],
    ['03','항공 화물','운임·물동량 동향'],
    ['04','철도 시황 — TCR · TSR · 유라시아','중간회랑 인프라와 회랑별 방향성'],
    ['05','지역별 이슈','북미 · 유럽 · 중동 · CIS'],
    ['06','거시경제 · 지정학','호르무즈 · 관세 · 에너지'],
    ['07','규제 · 정책','관세 법리·통상 정책'],
    ['—','주요 해운 기사','이달의 핵심 뉴스 큐레이션'],
  ].map(([n,t,s]) => `<div class="toc-row"><span class="toc-num">${n}</span><div class="toc-tx"><b>${t}</b><small>${s}</small></div></div>`).join('');

  const contents = `
<section class="sheet contents-page">
  <div class="toc-eyebrow">Contents</div>
  <div class="toc-title">목차</div>
  <div class="toc">${toc}</div>
</section>`;

  const pub = `
<section class="sheet pub">
  <div class="pub-mark">${COMPASS}<span>LOGISIGHT</span></div>
  <div class="pub-grid">
    <div><h4>발행 정보</h4><p>발행 · 주식회사 엠티엘 (MTL Shipping Agency)<br>플랫폼 · Logisight — logisight.mtlship.com<br>발행일 · ${TODAY} &nbsp;|&nbsp; ${koMonth}<br>발행 주기 · 월간 (Monthly)</p></div>
    <div><h4>면책 조항</h4><p>본 리포트는 공개 출처 데이터 자동 수집과 AI 분석을 기반으로 작성됨. 실제 거래 운임·시황과 차이가 있을 수 있으며, 투자·계약 판단의 근거로 사용 시 별도 검증이 필요함. 무단 전재·재배포 금지.</p></div>
  </div>
  <div class="pub-foot">© 2026 주식회사 엠티엘 (MTL Co., Ltd.) · Logisight. All rights reserved.</div>
</section>`;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&display=swap" rel="stylesheet">
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
<style>
:root{
  --ink:#16202b;--navy:#0d2741;--navy2:#12324f;--gold:#a07d36;--gold-soft:#c7a85d;
  --paper:#fbfaf6;--rule:#e4ddcd;--rule-strong:#d4c8ac;--muted:#717b86;--muted2:#9aa3ad;
  --up:#b23b2e;--down:#1f5b96;
  --serif:'Fraunces',Georgia,serif;--sans:'Pretendard Variable','Pretendard',-apple-system,'Apple SD Gothic Neo',sans-serif;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:17mm 15mm 16mm}
body{font-family:var(--sans);color:var(--ink);font-size:10pt;line-height:1.7;-webkit-font-smoothing:antialiased;background:#fff}

/* ── COVER (full-bleed) ── */
.cover{margin:-17mm -15mm -16mm;min-height:297mm;padding:64px 56px;color:#fff;display:flex;flex-direction:column;
  page-break-after:always;position:relative;overflow:hidden;
  background:radial-gradient(1100px 680px at 78% 22%,rgba(199,168,93,.10),transparent 60%),radial-gradient(880px 600px at 12% 88%,rgba(45,107,168,.18),transparent 55%),linear-gradient(155deg,#0a2138 0%,#0d2741 46%,#081b2f 100%)}
.cover::before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 1px,transparent 1.4px);background-size:26px 26px;-webkit-mask:radial-gradient(680px 520px at 70% 30%,#000 30%,transparent 72%);opacity:.5}
.cover>*{position:relative;z-index:1}
.compass{width:34px;height:34px;flex:0 0 auto}
.cv-top{display:flex;align-items:center;gap:13px;margin-bottom:auto}
.cv-brand{font-family:var(--serif);font-weight:500;font-size:16px;letter-spacing:.18em}
.cv-brand small{display:block;font-family:var(--sans);font-weight:500;font-size:8.5px;letter-spacing:.42em;color:var(--gold-soft);margin-top:3px}
.cv-eyebrow{font-size:10px;font-weight:600;letter-spacing:.46em;color:var(--gold-soft);text-transform:uppercase;margin-bottom:20px}
.cv-title{font-family:var(--serif);font-weight:300;font-size:60px;line-height:1.03;letter-spacing:-.015em}
.cv-title b{font-weight:600;color:var(--gold-soft)}
.cv-sub{font-size:13px;color:#c5d1de;margin-top:22px;padding-top:18px;border-top:1px solid rgba(199,168,93,.4);max-width:430px}
.cv-edition{display:inline-block;font-family:var(--serif);font-size:13px;font-weight:500;letter-spacing:.14em;color:#0d2741;background:var(--gold-soft);padding:5px 15px;border-radius:2px;margin-top:26px}
.cv-foot{margin-top:auto;padding-top:30px;display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid rgba(255,255,255,.12);font-size:9px;letter-spacing:.18em;color:#8ea0b3;text-transform:uppercase}

/* ── SHEETS (contents/pub) ── */
.sheet{page-break-after:always}
.toc-eyebrow{font-size:10px;font-weight:600;letter-spacing:.4em;color:var(--gold);text-transform:uppercase}
.toc-title{font-family:var(--serif);font-size:30px;font-weight:400;color:var(--navy);margin-bottom:4px}
.toc{margin-top:30px}
.toc-row{display:flex;align-items:baseline;padding:14px 0;border-bottom:1px solid var(--rule)}
.toc-num{font-family:var(--serif);font-size:22px;font-weight:300;color:var(--gold);width:54px;flex:0 0 auto}
.toc-tx{flex:1}.toc-tx b{font-size:13.5px;font-weight:700;color:var(--navy);display:block}
.toc-tx small{font-size:10px;color:var(--muted)}

/* ── HEADINGS: h1·h2=섹션, h3=지수, h4=기사 부제 ── */
h1,h2{font-family:var(--serif);font-weight:500;font-size:25pt;line-height:1.12;color:var(--navy);
  letter-spacing:-.01em;margin:0 0 6mm;padding-bottom:4mm;border-bottom:2px solid var(--navy);
  page-break-before:always;page-break-after:avoid}
h3{font-family:var(--serif);font-weight:500;font-size:15pt;color:var(--navy);letter-spacing:-.005em;
  margin:9mm 0 1mm;padding-bottom:2.5mm;border-bottom:1px solid var(--rule-strong);page-break-after:avoid}
h4{font-size:12pt;font-weight:500;color:var(--muted);margin:0 0 4mm;line-height:1.4}

/* ── PROSE ── */
p{font-size:10pt;line-height:1.92;color:#2b3640;margin:0 0 4mm;letter-spacing:-.1px}
strong{color:var(--navy);font-weight:700}
ul,ol{margin:0 0 4mm;padding-left:5.5mm}
li{font-size:9.5pt;line-height:1.8;color:#2b3640;margin-bottom:1.5mm}
hr{border:none;border-top:1px solid var(--rule);margin:7mm 0;page-break-after:avoid}
.up{color:var(--up);font-weight:600}.down{color:var(--down);font-weight:600}
.page-break{page-break-before:always}

/* ── TABLE (header-underline 식) ── */
table{width:100%;border-collapse:collapse;margin:5mm 0 3mm;font-size:9.5pt;page-break-inside:avoid}
thead th{font-size:8pt;font-weight:600;letter-spacing:.06em;color:var(--navy);text-transform:uppercase;
  text-align:right;padding:0 3mm 2.5mm;border-bottom:1.6px solid var(--navy)}
thead th:first-child{text-align:left}
tbody td{padding:2.6mm 3mm;border-bottom:1px solid var(--rule);text-align:right;font-variant-numeric:tabular-nums;color:var(--ink)}
tbody td:first-child{text-align:left;font-weight:500;color:var(--navy)}
tbody tr:last-child td{border-bottom:1.6px solid var(--rule-strong)}

/* ── CHART CARD ── */
.chart-box{height:60mm;margin:5mm 0 4mm;padding:5mm 5mm 2mm;background:#fbfaf6;border:1px solid var(--rule);border-radius:3px;page-break-inside:avoid}
.chart-box canvas{max-width:100%}

/* ── CALLOUT (blockquote → gold) ── */
blockquote{margin:5mm 0;padding:4mm 5mm 4mm 5.5mm;background:#fbfaf6;border-left:2.5px solid var(--gold);page-break-inside:avoid}
blockquote p{font-size:9.5pt;line-height:1.8;color:var(--navy2);margin:0}

/* ── FEATURE IMAGE ── */
.feature-img{width:100%;max-height:92mm;object-fit:cover;border-radius:3px;margin:4mm 0 5mm;page-break-inside:avoid}

/* ── PUBLICATION PAGE ── */
.pub{padding-top:30mm}
.pub-mark{display:flex;align-items:center;gap:10px;margin-bottom:14mm}
.pub-mark .compass{width:22px;height:22px}
.pub-mark span{font-family:var(--serif);font-size:14px;letter-spacing:.16em;color:var(--navy)}
.pub-grid{display:grid;grid-template-columns:1fr 1fr;gap:12mm;margin-bottom:14mm}
.pub h4{font-size:9pt;font-weight:700;letter-spacing:.18em;color:var(--gold);text-transform:uppercase;margin-bottom:3mm;border:none;padding:0}
.pub p{font-size:9.5pt;line-height:1.85;color:#2b3640}
.pub-foot{padding-top:5mm;border-top:1px solid var(--rule);font-size:8.5pt;color:var(--muted2);letter-spacing:.04em}
</style></head>
<body>
${cover}
${contents}
${bodyHtml}
${pub}
${chartScript}
</body></html>`;
}

async function main() {
  console.log(`⏳ ${MONTH} 월간 리포트 PDF 생성 중...`);
  const md = loadMarkdown();
  let bodyHtml = marked.parse(md);
  // ▲(상승)=적색, ▼(하락)=청색 — 한국 운임지수 관례
  bodyHtml = bodyHtml
    .replace(/▲/g, '<span class="up">▲</span>')
    .replace(/▼/g, '<span class="down">▼</span>');

  // ── 차트 토큰 치환: [[CHART:id]] → <div class="chart-box"><canvas id="chart_id"></canvas></div>
  const ids = [];
  const tokenRe = /<p>\s*\[\[CHART:([a-z0-9_]+)\]\]\s*<\/p>|\[\[CHART:([a-z0-9_]+)\]\]/g;
  bodyHtml = bodyHtml.replace(tokenRe, (_m, a, b) => {
    const id = a || b; ids.push(id);
    return `<div class="chart-box"><canvas id="chart_${id}"></canvas></div>`;
  });

  const chartConfigs = [];
  for (const id of [...new Set(ids)]) {
    const c = await buildChart(id);
    if (c) { chartConfigs.push(c); console.log(`  ✓ 차트 ${id}: ${c.data.datasets.length}계열`); }
    else   { console.warn(`  ⚠️ 차트 ${id} 데이터 없음 — 빈 자리 처리`); }
  }

  const html = buildHtml(bodyHtml, chartConfigs);

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
    console.log('⏳ 페이지 로드 중 (Pretendard CDN, Chart.js)...');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // 차트 렌더 대기
    if (chartConfigs.length) {
      await page.evaluate(() => new Promise(res => {
        let n = 0;
        const t = setInterval(() => { if (window.__chartsReady || n++ > 25) { clearInterval(t); res(); } }, 100);
      }));
      await new Promise(r => setTimeout(r, 400));  // 캔버스 페인트 여유
    }

    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.pdf({
      path:            OUT_PATH,
      format:          'A4',
      printBackground: true,
      margin: { top: '18mm', right: '20mm', bottom: '14mm', left: '20mm' },
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
