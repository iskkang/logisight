'use strict';
// [프로토타입] 권역 "심층 분석형" 위클리 렌더러 — 미주 시제품.
// JSON(content/weekly-region-deep/<week>-<region>.json) → 표지 + 종합 + 운임 지표(표+Chart.js 차트) + 이슈별 심층 섹션 → PDF.
// 사용법: node weekly-region-deep-pdf.js [--week=2026-W26] [--region=americas]
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

function chromePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const comma = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const chgClass = (s) => /^\+/.test(s || '') ? 'up' : (/^-/.test(s || '') ? 'down' : '');

const CSS = `:root{
  --c-primary:#0070C0; --c-primary-deep:#005599; --c-ink:#1A1A1A; --c-body:#2B2B2B; --c-soft:#555; --c-cap:#888;
  --c-rule:#D9D9D9; --c-zebra:#F2F6FA; --c-up:#C00000; --c-down:#0070C0;
  --font-title:'Pretendard','Noto Sans KR',sans-serif; --font-sans:'Pretendard','Malgun Gothic',sans-serif;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:16mm 0 14mm}
@page cover{margin:0}
body{font-family:var(--font-sans);color:var(--c-body);font-size:10.5pt;line-height:1.66;-webkit-print-color-adjust:exact;print-color-adjust:exact}

.cover{page:cover;width:210mm;height:297mm;position:relative;overflow:hidden;break-after:page;
  background:linear-gradient(160deg,#4D4D4D 0%,#414141 58%,#363636 100%);color:#fff;padding:26mm 22mm;display:flex;flex-direction:column;justify-content:space-between}
.cv-diagonal{position:absolute;right:0;bottom:0;width:120mm;height:84mm;z-index:0;background:linear-gradient(135deg,var(--c-primary) 0%,var(--c-primary-deep) 100%);clip-path:polygon(100% 0,100% 100%,0 100%)}
.cv-top,.cv-mid,.cv-foot{position:relative;z-index:1}
.cv-brand{font-family:var(--font-title);font-weight:800;font-size:16pt;letter-spacing:2px}
.cv-brand small{display:block;font-weight:500;font-size:7pt;letter-spacing:4px;color:#7FC0F0;margin-top:1.5mm}
.cv-mid{margin-top:auto}
.cv-kicker{font-size:9pt;letter-spacing:5px;color:#5EB0EE;font-weight:600;margin-bottom:7mm}
.cv-title{font-family:var(--font-title);font-weight:800;font-size:40pt;line-height:1.1;letter-spacing:-.02em;margin-bottom:7mm}
.cv-rule{width:28mm;height:3px;background:var(--c-primary);margin-bottom:8mm}
.cv-sub{font-size:11pt;color:rgba(255,255,255,.8)}
.cv-toc{margin-top:6mm;font-size:9.5pt;color:rgba(255,255,255,.72);line-height:1.8}
.cv-toc b{color:#fff;font-weight:700}
.cv-foot{display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid rgba(255,255,255,.2);padding-top:6mm;font-size:9pt;color:rgba(255,255,255,.65)}
.cv-vol{font-family:var(--font-title);font-size:13pt;color:#fff;font-weight:800}

.flow{padding:0 17mm}
.flow h2{font-family:var(--font-title);font-size:19pt;font-weight:800;color:var(--c-ink);letter-spacing:-.02em;padding-bottom:3mm;margin-bottom:5mm;border-bottom:2.5px solid var(--c-primary);break-before:page;break-after:avoid}
.flow h2.first{break-before:avoid}
.flow p{margin:0 0 2.8mm}
.summary p{font-size:10.8pt;line-height:1.75}

/* 운임 지표 */
.idx-wrap{break-inside:avoid}
table.rate{width:100%;border-collapse:collapse;font-size:9.6pt;margin:0 0 5mm}
table.rate th{background:var(--c-primary);color:#fff;font-weight:700;padding:2mm 3mm;text-align:right;font-size:9pt}
table.rate th:first-child{text-align:left}
table.rate td{padding:1.9mm 3mm;text-align:right;border-bottom:1px solid var(--c-rule)}
table.rate td:first-child{text-align:left;font-weight:600;color:var(--c-ink)}
table.rate tbody tr:nth-child(even){background:var(--c-zebra)}
table.rate .up{color:var(--c-up);font-weight:700}
table.rate .down{color:var(--c-down);font-weight:700}
.chart-wrap{width:100%;height:74mm;margin:0 0 2mm}
.src-cap{font-size:8.2pt;color:var(--c-cap);font-style:italic;margin-bottom:4mm}

/* 이슈 심층 */
.issue-lead{font-size:11.5pt;font-weight:700;color:var(--c-ink);line-height:1.6;margin:0 0 4mm;padding-left:3.5mm;border-left:3px solid var(--c-primary)}
.issue-p{margin:0 0 3mm;line-height:1.72}
ul.bullets{margin:1mm 0 4mm;padding-left:0;list-style:none}
ul.bullets li{position:relative;padding-left:5mm;margin-bottom:1.8mm;font-size:9.9pt;line-height:1.6}
ul.bullets li::before{content:"▪";position:absolute;left:0;color:var(--c-primary);font-size:8pt;top:.3mm}
.box{background:#F6F9FC;border:1px solid #DCE6F0;border-radius:4px;padding:3mm 4mm;margin:0 0 4mm;break-inside:avoid}
.box .tag{display:inline-block;background:var(--c-primary);color:#fff;font-size:7.8pt;font-weight:700;letter-spacing:.5px;padding:.7mm 2.6mm;border-radius:3px;margin-bottom:2mm}
.box.outlook{background:#FFFBF2;border-color:#EAD9B0}
.box.outlook .tag{background:#C8902A}
.box p{margin:0;font-size:10pt;line-height:1.66}
ul.impl{margin:0;padding-left:0;list-style:none}
ul.impl li{padding-left:0;margin-bottom:1.6mm;font-size:9.8pt;line-height:1.6}
ul.impl li b{color:var(--c-ink)}
.issue-src{font-size:8.2pt;color:var(--c-cap);line-height:1.55;margin-top:1mm;padding-top:2mm;border-top:1px dotted var(--c-rule)}
.issue-src a{color:var(--c-soft);text-decoration:none}
.issue{break-before:page}`;

function rateTable(idx) {
  if (!idx || !idx.table || !idx.table.length) return '';
  const rows = idx.table.map((r) => `<tr><td>${esc(r.label)}</td><td>${comma(r.value)} <span style="color:#999;font-size:8pt">${esc(r.unit)}</span></td><td>${esc(r.date)}</td><td class="${chgClass(r.wow)}">${esc(r.wow)}</td><td class="${chgClass(r.mom)}">${esc(r.mom)}</td></tr>`).join('\n');
  return `<table class="rate"><thead><tr><th>지수 · 항로</th><th>최신값</th><th>기준(월/일)</th><th>WoW</th><th>MoM</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function issueHtml(it, searchDate) {
  const L = [`<section class="issue"><h2>${esc(it.title)}</h2>`];
  if (it.lead) L.push(`<p class="issue-lead">${esc(it.lead)}</p>`);
  for (const p of (it.paragraphs || [])) L.push(`<p class="issue-p">${esc(p)}</p>`);
  if (it.bullets && it.bullets.length) L.push(`<ul class="bullets">${it.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  if (it.outlook) L.push(`<div class="box outlook"><span class="tag">전망</span><p>${esc(it.outlook)}</p></div>`);
  if (it.implications && it.implications.length) {
    L.push(`<div class="box"><span class="tag">시사점</span><ul class="impl">${it.implications.map((m) => `<li><b>${esc(m.actor)}</b> — ${esc(m.point)}</li>`).join('')}</ul></div>`);
  }
  if (it.sources && it.sources.length) {
    const s = it.sources.map((x) => `${esc(x.source || '')}, <a href="${esc(x.url || '')}">${esc(x.title || x.url || '')}</a>`).join(' · ');
    L.push(`<div class="issue-src">참고자료: ${s} (검색일: ${esc(searchDate)})</div>`);
  }
  L.push('</section>');
  return L.join('\n');
}

function buildHtml(j) {
  const toc = (j.issues || []).map((it, i) => `<div><b>${i + 1}.</b> ${esc(it.title)}</div>`).join('\n');
  const paras = (t) => String(t || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).map((s) => `<p>${esc(s)}</p>`).join('\n');
  const summaryHtml = j.summary ? `<div class="summary"><h2 class="first">종합</h2>${paras(j.summary)}</div>` : '';
  const idx = j.indices;
  const idxHtml = idx ? `<div class="idx-wrap"><h2>운임 지표</h2>
${rateTable(idx)}
<div class="chart-wrap"><canvas id="rateChart"></canvas></div>
<div class="src-cap">자료: ${esc(idx.source || '')} · 기준 ${esc(idx.asOf || '')}</div></div>` : '';
  const issuesHtml = (j.issues || []).map((it) => issueHtml(it, j.generated_at)).join('\n');

  const chartCfg = idx ? {
    labels: idx.labels,
    datasets: idx.datasets.map((d, i) => ({
      label: d.label, data: d.data,
      borderColor: i === 0 ? '#0070C0' : '#C00000',
      backgroundColor: 'transparent', borderWidth: 2.2, pointRadius: 0, tension: 0.25, spanGaps: true,
    })),
  } : null;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>${CSS}</style></head><body>
<section class="cover">
  <div class="cv-diagonal"></div>
  <div class="cv-top"><div class="cv-brand">LOGISIGHT<small>WEEKLY INTELLIGENCE</small></div></div>
  <div class="cv-mid">
    <div class="cv-kicker">WEEKLY REGIONAL ANALYSIS · ${esc(j.regionEn || '')}</div>
    <div class="cv-title">${esc(j.coverTitle || '')}</div>
    <div class="cv-rule"></div>
    <div class="cv-sub">보고기간 ${esc(j.period || '')}</div>
    <div class="cv-toc">${toc}</div>
  </div>
  <div class="cv-foot"><span>LOGISIGHT 인텔리전스팀</span><span class="cv-vol">${esc(j.week || '')}</span></div>
</section>
<div class="flow">
${summaryHtml}
${idxHtml}
${issuesHtml}
</div>
<script>
(function(){
  var cfg = ${JSON.stringify(chartCfg)};
  if(!cfg){ window.__chartReady = true; return; }
  function draw(){
    var el = document.getElementById('rateChart');
    if(!el || typeof Chart === 'undefined'){ return setTimeout(draw, 50); }
    new Chart(el.getContext('2d'), {
      type:'line', data:cfg,
      options:{ animation:false, responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'top', labels:{ font:{ size:11 }, boxWidth:18 } } },
        scales:{ y:{ ticks:{ font:{ size:10 } }, grid:{ color:'#ECECEC' } },
                 x:{ ticks:{ font:{ size:9 }, maxRotation:0, autoSkip:true, maxTicksLimit:9 }, grid:{ display:false } } } }
    });
    window.__chartReady = true;
  }
  draw();
})();
</script>
</body></html>`;
}

async function main() {
  const week = arg('week') || '2026-W26';
  const region = arg('region') || 'americas';
  const jsonPath = path.join(__dirname, 'content/weekly-region-deep', `${week}-${region}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error('JSON 없음: ' + jsonPath);
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const html = buildHtml(j);

  const outDir = path.join(__dirname, 'content/published');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `weekly-report-${week}-${region}.pdf`);

  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__chartReady === true', { timeout: 15000 }).catch(() => console.warn('  ⚠ 차트 렌더 대기 타임아웃'));
  await page.pdf({ path: out, format: 'A4', printBackground: true });
  await browser.close();
  console.log(`✅ [${region}] deep-PDF: ${out} (이슈 ${(j.issues || []).length}, 지표 ${j.indices ? j.indices.table.length + '행' : '없음'})`);
}

if (require.main === module) {
  main().catch((e) => { console.error('deep-PDF 실패:', e.message); process.exit(1); });
}
module.exports = { buildHtml, chromePath };
