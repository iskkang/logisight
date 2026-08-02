const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.resolve(__dirname, '../content/published');
const OUTPUT_FILE = path.join(OUTPUT_DIR, '2026-05-11-scfi-weekly-w19-2026.pdf');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:0}
body{font-family:'Noto Sans KR',sans-serif;background:#fff;color:#1a1a2e;font-size:10pt;line-height:1.6}

/* ── Page shells ── */
.page{width:210mm;min-height:297mm;position:relative;page-break-after:always;overflow:hidden}

/* ── Cover ── */
.cover{
  background:linear-gradient(150deg,#1E3A5F 0%,#2E86AB 60%,#1E3A5F 100%);
  display:flex;flex-direction:column;justify-content:space-between;
  padding:18mm 20mm 14mm;color:#fff;min-height:297mm
}
.cover-header{display:flex;justify-content:space-between;align-items:center}
.logo-box{
  background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.35);
  border-radius:7px;padding:6px 16px;font-size:11pt;font-weight:900;
  letter-spacing:2px;color:rgba(255,255,255,0.95)
}
.report-badge{
  background:rgba(255,255,255,0.12);border-radius:4px;
  padding:4px 10px;font-size:7.5pt;color:rgba(255,255,255,0.75);letter-spacing:1px
}
.cover-body{flex:1;display:flex;flex-direction:column;justify-content:center;padding:14mm 0}
.cover-cat{font-size:8.5pt;color:#7EC8E3;letter-spacing:3px;text-transform:uppercase;font-weight:500;margin-bottom:7mm}
.cover-title{font-size:21pt;font-weight:900;line-height:1.35;color:#fff;margin-bottom:7mm}
.cover-rule{width:18mm;height:2.5px;background:#7EC8E3;margin-bottom:7mm}
.cover-sub{font-size:10.5pt;color:rgba(255,255,255,0.72);font-weight:300;line-height:1.75;max-width:140mm}
.cover-footer{
  display:flex;justify-content:space-between;align-items:flex-end;
  border-top:1px solid rgba(255,255,255,0.18);padding-top:5mm
}
.cover-meta{font-size:8pt;color:rgba(255,255,255,0.65)}
.cover-meta strong{color:#fff;display:block;font-size:9.5pt;margin-bottom:1.5mm}

/* ── Content pages ── */
.cp{padding:14mm 20mm 10mm}
.ph{
  display:flex;justify-content:space-between;align-items:center;
  border-bottom:0.5px solid #d0d7e0;padding-bottom:2.5mm;margin-bottom:7mm
}
.ph-brand{font-size:7.5pt;color:#2E86AB;font-weight:700;letter-spacing:0.5px}
.ph-info{font-size:7.5pt;color:#8899aa}

/* ── Typography ── */
.intro{font-size:9.5pt;line-height:1.8;color:#2c3e50;margin-bottom:5mm}
.h2{
  font-size:12.5pt;font-weight:700;color:#1E3A5F;
  margin:6mm 0 3.5mm;padding-bottom:1.5mm;
  border-bottom:2px solid #2E86AB;display:inline-block
}
.body{font-size:9pt;line-height:1.85;color:#2c3e50;margin-bottom:3.5mm}

/* ── Callout ── */
.callout{
  background:#EBF4FA;border-left:3.5px solid #2E86AB;
  border-radius:0 6px 6px 0;padding:3.5mm 5mm;
  margin:4.5mm 0;font-size:9.5pt;color:#1E3A5F;font-weight:600
}

/* ── Data list ── */
ul.dl{list-style:none;padding:0;margin:2.5mm 0 3.5mm}
ul.dl li{
  font-size:9pt;line-height:1.7;color:#2c3e50;
  padding:1.5mm 0 1.5mm 4mm;border-bottom:0.5px solid #edf2f7;
  display:flex;align-items:baseline
}
ul.dl li::before{content:'▸';color:#2E86AB;margin-right:2.5mm;font-size:8pt;flex-shrink:0}
ul.dl li strong{color:#1E3A5F;min-width:48mm;flex-shrink:0}
.hl{background:#FFF9C4;padding:0.3mm 1.5mm;border-radius:2px;font-weight:700}
.src{font-size:7pt;color:#aab5c1;font-style:italic}

/* ── Charts ── */
.chart-box{
  background:#f8fafc;border:0.5px solid #d0dce8;
  border-radius:7px;padding:3.5mm 4mm;margin:3.5mm 0
}
.ct{font-size:7.5pt;color:#2E86AB;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2.5mm}
.cn{font-size:6.5pt;color:#8899aa;margin-top:1.5mm;text-align:right}
.chart-row{display:flex;gap:3.5mm;margin:3.5mm 0}
.chart-half{flex:1}

/* ── Checklist ── */
ol.cl{list-style:none;padding:0;margin:2.5mm 0}
ol.cl li{
  background:#f8fafc;border-left:3px solid #2E86AB;
  border-radius:0 6px 6px 0;padding:3mm 4mm;
  margin-bottom:2.5mm;font-size:8.5pt;color:#2c3e50;line-height:1.65
}
ol.cl li .n{font-weight:900;color:#2E86AB;margin-right:2mm}
ol.cl li strong{color:#1E3A5F;display:block;font-size:9pt;margin-bottom:0.8mm}

/* ── Sources page ── */
.sp{background:#f0f4f8;padding:14mm 20mm;min-height:297mm}
.st{font-size:14pt;font-weight:700;color:#1E3A5F;margin-bottom:5mm}
.si{
  display:flex;gap:3mm;padding:2.5mm 0;
  border-bottom:0.5px solid #d0dce8;font-size:9pt;color:#4a5568
}
.sn{color:#2E86AB;font-weight:700;min-width:5mm}
.sf{margin-top:10mm;text-align:center;font-size:7.5pt;color:#8899aa}
</style>
</head>
<body>

<!-- PAGE 1: COVER -->
<div class="page cover">
  <div class="cover-header">
    <div class="logo-box">LOGISIGHT</div>
    <div class="report-badge">MARKET INTELLIGENCE REPORT</div>
  </div>
  <div class="cover-body">
    <div class="cover-cat">컨테이너 운임 시황 &middot; W19 2026</div>
    <div class="cover-title">SCFI 5월 2주차<br>미주 운임 반등·유럽 약세 속<br>한국 화주가 챙겨야 할 3가지</div>
    <div class="cover-rule"></div>
    <div class="cover-sub">
      5월 글로벌 컨테이너 운임 시장의 엇갈린 흐름.<br>
      WCI $2,286/FEU &middot; SCFI 1,954pt &middot; 전년 대비 +45.3%.<br>
      미주 동안 +7% &nbsp;|&nbsp; 아시아-북유럽 &minus;3% &nbsp;|&nbsp; 블랭크 세일링 34항차(5%).
    </div>
  </div>
  <div class="cover-footer">
    <div class="cover-meta">
      <strong>2026년 5월 11일</strong>
      발행: Logisight Team
    </div>
    <div class="cover-meta" style="text-align:right">
      <strong>logisight.mtlship.com</strong>
      Market Intelligence Hub
    </div>
  </div>
</div>

<!-- PAGE 2: INTRO + SECTION 1 -->
<div class="page cp">
  <div class="ph">
    <span class="ph-brand">LOGISIGHT Market Intelligence</span>
    <span class="ph-info">SCFI W19 2026 &nbsp;&middot;&nbsp; 2026.05.11</span>
  </div>

  <p class="intro">
    5월 글로벌 컨테이너 운임 시장의 엇갈린 흐름. 미주 항로는 선사들의 유류 및 성수기 할증료 도입으로 반등,
    유럽 항로는 수요 부진 속 하락 또는 보합세 지속. Drewry World Container Index(WCI)는 5월 7일 기준
    $2,286/FEU로 전주 대비 3% 상승 <span class="src">(출처: Drewry, 2026.05.07)</span>,
    SCFI 종합 지수는 5월 8일 1,954.21포인트로 전일 대비 2.24% 상승
    <span class="src">(출처: Trading Economics, 2026.05.08)</span>. 전년 동기 대비 45.3% 높은 수준.
  </p>

  <div class="callout">💡 SCFI 1,954pt / WCI $2,286/FEU &mdash; 전년 동기 대비 +45.3%, 3주 만에 첫 반등</div>

  <div class="h2">1. 이번 주 지수 수치: WCI 기준 미주 항로가 주도</div>

  <div class="chart-box">
    <div class="ct">WCI 주요 항로 운임 비교 (상하이 발, $/FEU) &mdash; 2026.05.07</div>
    <canvas id="chartBar" height="120"></canvas>
    <div class="cn">출처: Drewry World Container Index, 2026.05.07 &nbsp;&middot;&nbsp; Logisight Market Intelligence</div>
  </div>

  <ul class="dl">
    <li><strong>상하이 &rarr; 뉴욕</strong>$3,721/FEU &nbsp; 전주 대비 <span class="hl">+7%</span></li>
    <li><strong>상하이 &rarr; 로스앤젤레스</strong>$3,062/FEU &nbsp; 전주 대비 <span class="hl">+5%</span></li>
    <li><strong>상하이 &rarr; 로테르담</strong>$2,170/FEU &nbsp; 전주 대비 +2%</li>
    <li><strong>상하이 &rarr; 제노바</strong>$3,075/FEU &nbsp; 전주 대비 +1%</li>
  </ul>

  <p class="body">
    미주 동안(East Coast) 항로의 상승 폭이 특히 두드러짐. 반면 Freightos FBX 기준 아시아-북유럽 노선은 같은 기간
    3% 하락, 아시아-지중해는 7% 상승해 지중해 노선이 북유럽 대비 상대적 강세 유지
    <span class="src">(출처: Freightos, 2026.05.05)</span>.
    WCI 전체 평균은 3주 연속 하락 이후 이번 주 첫 반등. 이 반등이 구조적 수요 회복인지,
    선사발(發) 할증료 요인인지를 구분하는 것이 한국 화주에게 핵심 판단 포인트.
  </p>

  <div class="callout">💡 상하이&rarr;뉴욕 $3,721/FEU &mdash; 전주 대비 +7%, 미주 동안 상승 주도</div>
</div>

<!-- PAGE 3: SECTION 2 -->
<div class="page cp">
  <div class="ph">
    <span class="ph-brand">LOGISIGHT Market Intelligence</span>
    <span class="ph-info">SCFI W19 2026 &nbsp;&middot;&nbsp; 2026.05.11</span>
  </div>

  <div class="h2">2. 등락 원인: 할증료·블랭크 세일링이 운임 하단을 지지</div>

  <p class="body">
    이번 주 미주 운임 상승의 직접적 원인은 선사들의 할증료 일제 인상
    <span class="src">(출처: Drewry, 2026.05.07)</span>.
    수요 회복이 아닌 공급 측 비용 전가 성격이 강한 점 주의 필요.
  </p>

  <ul class="dl">
    <li><strong>MSC</strong>아시아-미주 동안 EFS $430&rarr;$644/FEU &nbsp; 서안 $272&rarr;$467/FEU</li>
    <li><strong>CMA CGM</strong>PSS(성수기할증료) $2,000/FEU &nbsp; 5월 1일 시행</li>
  </ul>

  <div class="chart-row">
    <div class="chart-half chart-box">
      <div class="ct">블랭크 세일링 결항 비율 (W20&ndash;W24)</div>
      <canvas id="chartPie" height="155"></canvas>
      <div class="cn">출처: Drewry Cancelled Sailings Tracker, 2026.05.08</div>
    </div>
    <div class="chart-half chart-box">
      <div class="ct">SCFI 4주 추이 <span style="font-weight:400;color:#aab5c1">(플레이스홀더)</span></div>
      <canvas id="chartLine" height="155"></canvas>
      <div class="cn">* 실제 수집 전 대표값 &nbsp;&middot;&nbsp; 출처: Trading Economics, 2026.05.08</div>
    </div>
  </div>

  <p class="body">
    블랭크 세일링(결항)이 5월~6월 초까지 지속 예정. Drewry에 따르면 W20~W24 중 702개 예정 항차 가운데
    약 34개(5%)가 결항 처리 <span class="src">(출처: Drewry Cancelled Sailings Tracker, 2026.05.08)</span>.
    트랜스퍼시픽(미주) 방향 결항 47%, 아시아-유럽/지중해 방향 32%로 두 노선에 집중.
    아시아-북유럽 항로 유효 공급 5월 중 전월 대비 3% 감소, 지중해 항로 10% 감소 예상
    <span class="src">(출처: Drewry, 2026.05.07)</span>. 공급 축소가 운임 하단을 받치는 구조.
  </p>
  <p class="body">
    말레이시아 포트 클랑(Port Klang)에서 선박 대기 시간 48시간 이상, 피더 선사들은 5월 초부터 혼잡 할증료
    부과 시작 <span class="src">(출처: GoComet Port Congestion Tracker, 2026.05.07)</span>.
    동남아 허브 혼잡은 한국 발 화물의 환적 일정에도 영향 가능 변수.
  </p>

  <div class="callout">💡 W20&ndash;W24 블랭크 세일링 34항차(5%) &mdash; 아시아-지중해 유효 공급 10% 감소 예상</div>
</div>

<!-- PAGE 4: SECTION 3 + 4 -->
<div class="page cp">
  <div class="ph">
    <span class="ph-brand">LOGISIGHT Market Intelligence</span>
    <span class="ph-info">SCFI W19 2026 &nbsp;&middot;&nbsp; 2026.05.11</span>
  </div>

  <div class="h2">3. 지정학 변수: 호르무즈 긴장이 유가·보험료 압박 요인</div>

  <p class="body">
    중동 정세도 운임 시장의 배경 변수로 잔존. 3월 한국 수입물가지수가 전월 대비 16.1% 급등했는데,
    주요 원인 중 하나로 호르무즈 해협 긴장에 따른 국제유가 상승이 지목
    <span class="src">(출처: 파이낸셜뉴스 / 한국은행, 2026.05.08)</span>.
    국제유가가 다시 오를 경우, 선사들의 EFS 추가 인상 명분 강화 구조.
    현재 시점에서는 중동 항로 직접 영향보다 유가 연동 할증료 경로를 통한 간접 영향이 더 현실적.
  </p>

  <div class="callout">💡 한국 수입물가 전월 대비 +16.1% &mdash; 호르무즈 긴장·유가 연동 EFS 추가 인상 리스크</div>

  <div class="h2">4. 향후 전망 및 한국 화주 시사점</div>

  <p class="body">
    Drewry는 단기적으로 운임 추가 상승 가능성 전망
    <span class="src">(출처: Drewry, 2026.05.07)</span>.
    Trading Economics의 모델 기반 전망치는 분기 말까지 약 2,001포인트, 12개월 내 약 2,300포인트 수준
    <span class="src">(출처: Trading Economics, 2026.05.08)</span>.
    다만 이는 모델 예측이며 확정 전망이 아닌 점 감안 필요. 구조적으로는 하방 압력도 뚜렷.
    신조 선복 공급이 계속되고 있고, 미·중 무역 불확실성으로 인해 미주 항로 물동량 회복세 제한적.
    성수기 할증료 효과가 소진되는 6월 중순 이후 스팟 운임 재조정 가능성 배제 불가.
  </p>

  <div class="callout">💡 Drewry 분기 말 전망 2,001pt / 12개월 내 2,300pt &mdash; 6월 중순 이후 재조정 주시</div>

  <p class="body" style="font-weight:700;color:#1E3A5F;margin-top:4mm">한국 화주·포워더를 위한 체크리스트</p>

  <ol class="cl">
    <li>
      <span class="n">①</span>
      <strong>미주 동안 화물: 지금이 계약 시점 검토 구간</strong>
      현재 스팟이 $3,700 선을 넘어선 상태로, FAK(화물 운임) 인상이 추가로 예고되어 있다면 기간 계약 비중 확대 전략 검토 가능.
    </li>
    <li>
      <span class="n">②</span>
      <strong>유럽 항로: 노선별 편차 확인 필요</strong>
      북유럽 스팟이 약세인 반면 지중해 항로는 상대적 강세. 목적지 항구 선택에 따라 비용 차이 상당.
    </li>
    <li>
      <span class="n">③</span>
      <strong>동남아 환적 일정: 여유 확보 필요</strong>
      포트 클랑 등 동남아 주요 허브의 혼잡이 심화되고 있어, 한국 발 중동·남아시아 환적 화물의 리드타임 재검토 필요 시점.
    </li>
  </ol>
</div>

<!-- PAGE 5: SOURCES -->
<div class="page sp">
  <div class="ph" style="border-bottom-color:#b0bec5">
    <span class="ph-brand" style="color:#1E3A5F">LOGISIGHT Market Intelligence</span>
    <span class="ph-info">SCFI W19 2026 &nbsp;&middot;&nbsp; 2026.05.11</span>
  </div>

  <div class="st">출처 목록</div>

  <div class="si"><span class="sn">1</span><span>상하이 항운거래소 SCFI (Trading Economics 집계), 2026.05.08</span></div>
  <div class="si"><span class="sn">2</span><span>Drewry World Container Index (WCI), 2026.05.07</span></div>
  <div class="si"><span class="sn">3</span><span>Drewry Cancelled Sailings Tracker, 2026.05.08</span></div>
  <div class="si"><span class="sn">4</span><span>Freightos Baltic Exchange (FBX) Weekly Update, 2026.05.05</span></div>
  <div class="si"><span class="sn">5</span><span>파이낸셜뉴스 / 한국은행 수입물가 보도, 2026.05.08</span></div>
  <div class="si"><span class="sn">6</span><span>GoComet Port Congestion Tracker (말레이시아 포트 클랑 혼잡 현황), 2026.05.07</span></div>

  <div class="sf">
    <p>본 보고서는 Logisight Market Intelligence Hub가 공개 데이터를 바탕으로 작성한 정보 제공용 자료입니다.</p>
    <p style="margin-top:2mm">투자·매매 결정의 근거로 활용 시 원본 출처를 반드시 확인하십시오.</p>
    <p style="margin-top:5mm;color:#2E86AB;font-weight:700">logisight.mtlship.com</p>
  </div>
</div>

<script>
// ── Chart 1: WCI 항로 비교 Bar ──
new Chart(document.getElementById('chartBar'), {
  type: 'bar',
  data: {
    labels: ['상하이→뉴욕', '상하이→LA', '상하이→로테르담', '상하이→제노바'],
    datasets: [{
      data: [3721, 3062, 2170, 3075],
      backgroundColor: ['#1E3A5F', '#2E86AB', '#7EC8E3', '#2E86AB'],
      borderRadius: 5,
      borderSkipped: false
    }]
  },
  options: {
    responsive: true,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        min: 1800,
        ticks: {
          font: { family: 'Noto Sans KR', size: 9 },
          callback: v => '$' + v.toLocaleString()
        },
        grid: { color: '#e8edf2' }
      },
      x: {
        ticks: { font: { family: 'Noto Sans KR', size: 8.5 } },
        grid: { display: false }
      }
    }
  }
});

// ── Chart 2: 블랭크 세일링 Doughnut ──
new Chart(document.getElementById('chartPie'), {
  type: 'doughnut',
  data: {
    labels: ['트랜스퍼시픽(미주)', '아시아-유럽/지중해', '기타'],
    datasets: [{
      data: [47, 32, 21],
      backgroundColor: ['#1E3A5F', '#2E86AB', '#7EC8E3'],
      borderWidth: 2,
      borderColor: '#f8fafc'
    }]
  },
  options: {
    responsive: true,
    animation: false,
    cutout: '52%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          font: { family: 'Noto Sans KR', size: 8 },
          padding: 7,
          boxWidth: 10
        }
      }
    }
  }
});

// ── Chart 3: SCFI 4주 추이 Line ──
new Chart(document.getElementById('chartLine'), {
  type: 'line',
  data: {
    labels: ['W16 (4/13)', 'W17 (4/20)', 'W18 (4/27)', 'W19 (5/4)'],
    datasets: [{
      label: 'SCFI',
      data: [2053, 2021, 1911, 1954],
      borderColor: '#1E3A5F',
      backgroundColor: 'rgba(30,58,95,0.08)',
      borderWidth: 2.5,
      pointBackgroundColor: '#1E3A5F',
      pointRadius: 4,
      fill: true,
      tension: 0.35
    }]
  },
  options: {
    responsive: true,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        min: 1800,
        ticks: { font: { family: 'Noto Sans KR', size: 9 } },
        grid: { color: '#e8edf2' }
      },
      x: {
        ticks: { font: { family: 'Noto Sans KR', size: 8 } },
        grid: { display: false }
      }
    }
  }
});

// Signal Puppeteer that all charts are rendered
setTimeout(function() { window.allChartsReady = true; }, 1500);
<\/script>
</body>
</html>`;

async function main() {
  console.log('⏳ Puppeteer 시작...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });

    console.log('⏳ 페이지 로드 중 (폰트·Chart.js CDN)...');
    await page.setContent(HTML, { waitUntil: 'networkidle0', timeout: 30000 });

    console.log('⏳ 차트 렌더링 대기...');
    await page.waitForFunction('window.allChartsReady === true', { timeout: 15000 });

    console.log('⏳ PDF 생성 중...');
    await page.pdf({
      path: OUTPUT_FILE,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    console.log('✅ PDF 생성 완료:', OUTPUT_FILE);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
