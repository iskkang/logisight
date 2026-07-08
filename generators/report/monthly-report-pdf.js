"use strict";
// generators/report/monthly-report-pdf.js
// 월간 리포트 마크다운 → PDF
// ── 디자인 계약: generators/report/DESIGN.md (2026-07 확정 — 표지 아트·스파인·푸터 2-pass 규칙) ──
// ── 파이프라인·페이지 구성(표지/목차/섹션디바이더/서브섹션/해운1p)·해운 압축 로직은 원본 유지 ──
// 사용법: node generators/report/monthly-report-pdf.js [--month=2026-05]

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const puppeteer = require("puppeteer-core");
const { buildChart } = require("./lib/chart-data");
const { fetchOgImage } = require("./lib/og-image");
const { buildExecPage } = require("./lib/exec-page");
const { resolveMonth, monthEndISO, prevMonthOf } = require("./lib/report-month");

const TODAY = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find((a) => a.startsWith("--month="));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const MONTH = monthArg ? monthArg.split("=")[1] : TODAY.slice(0, 7);
const [YY, MM] = MONTH.split("-");
const ENG_MONTH = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY",
  "AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"][Number(MM) - 1] || "";
const VOL = MM; // 5월 → "05"
let PUB = TODAY; // 발행일(아래 main에서 md의 발행일로 보정)

const LOGO_SVG = fs.readFileSync(path.join(__dirname, 'assets/logisight_logo.svg'), 'utf-8');
// 표지 아트 (content/templates/report2.png 원본 → q85 JPEG) — 상단 원본 로고 텍스트는 .ld-shade가 가림
const COVER_IMG = 'data:image/jpeg;base64,' +
  fs.readFileSync(path.join(__dirname, 'assets/cover-art.jpg')).toString('base64');

const MD_PATH = path.resolve(
  __dirname,
  `../../content/drafts/monthly-analysis-${MONTH}.md`,
);
const OUT_DIR = path.resolve(__dirname, "../../content/published");
const OUT_PATH = outArg
  ? path.resolve(process.cwd(), outArg.split("=").slice(1).join("="))
  : path.join(OUT_DIR, `monthly-analysis-${MONTH}.pdf`);

// Drewry 프런트 페이지 재료 — 지수 표 KPI 4종·이달의 프레임 헤드라인·다음 달 체크포인트
function parseFrontMatterials(md) {
  // 운임 지수 동향 표의 전 행(최대 8종)을 KPI 카드로 — 4×2 그리드로 프런트 충전
  const kpis = [];
  const rowRe = /^\|\s*([A-Z][A-Za-z ]*[^|]*?)\s*\|\s*([^|]+?)\s*\|\s*[^|]+\|\s*[^|]+\|\s*([^|]+?)\s*\|\s*$/gm;
  let rm;
  while ((rm = rowRe.exec(md)) !== null && kpis.length < 8) {
    const label = rm[1].trim();
    if (/^지수|^[-:\s]+$/.test(label)) continue;
    const mom = rm[3].trim();
    if (!/[▲▼]/.test(mom)) continue;
    kpis.push({ label, val: rm[2].trim(), mom, dir: mom.includes('▼') ? 'down' : 'up' });
  }
  const hm = md.match(/\*\*이번 달 핵심\*\*\s*\n+([^\n]+)/);
  const headline = hm ? hm[1].trim() : null;
  const cps = (md.match(/^(첫째|둘째|셋째)[,.][^\n]*/gm) || [])
    .slice(0, 3)
    .map((t) => t.split('. ')[0].replace(/^([첫둘셋]째)[,.]\s*/, '').trim());
  return { kpis, headline, checkpoints: cps };
}

function loadMarkdown() {
  if (!fs.existsSync(MD_PATH)) {
    console.error(`ERROR: ${MD_PATH} 없음`);
    console.error(
      "먼저 실행: node generators/report/assemble-monthly-report.js --force",
    );
    process.exit(1);
  }
  return fs
    .readFileSync(MD_PATH, "utf-8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 인라인 인용·각주·참고자료 블록을 본문에서 완전 제거 (렌더 전 md 단계에서 적용)
function stripCitations(md) {
  return (
    md
      // "참고자료" / "References" 블록 전체 제거 (헤딩 + 뒤따르는 내용 포함)
      .replace(
        /(^|\n)\s*(?:#{1,4}\s*)?(?:참고\s*자료|references)\s*[:：]?\s*\n[\s\S]*?(?=\n\s*\n|\n#{1,3}\s|$)/gi,
        "\n",
      )
      // (매체, YYYY[-MM[-DD]] [잡텍스트]) 형태 인용 제거
      .replace(/\s*\(([^()]*?),\s*20\d{2}(?:-\d{2}(?:-\d{2})?)?[^()]*?\)/g, "")
      // URL만 있는 단독 줄 제거
      .replace(/^(?!.*\[\[(?:OGIMG|NEWS):)[^\n]*https?:\/\/[^\s)]+[^\n]*$/gm, "")
      // 남은 각주 마크 [n] 제거
      .replace(/\[\d{1,3}\]/g, "")
      // 이중 공백·빈줄 정리
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
  );
}

// 헤딩 분류:
//  "NN. ..."  → 풀블리드 섹션 디바이더 (예: "02. 해운 시황")
//  "주요 해운 기사" → 디바이더
//  "NN-N. ..." 및 기타 헤딩 → 서브섹션 제목(자기 페이지, 블루 밑줄)
//  숫자 하위 페이지 안의 일반 H3 → 같은 페이지 기사 제목
//  디바이더 직후 첫 제목은 lead → 페이지 강제개행 없이 디바이더 다음 페이지에 자연 배치
function transformBody(bodyHtml) {
  // ── Pre-processing ───────────────────────────────────────────────────────

  // A2: strip 모든 비-섹션 H1 (리포트 제목, 섹션 파일 헤더 H1 등).
  // "NN. Title" 형식만 남기고 나머지는 제거.
  bodyHtml = bodyHtml.replace(/<h1>([\s\S]*?)<\/h1>/gi, (m, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    return /^\d{1,2}\.\s+/.test(text) ? m : "";
  });

  // A3: "### YYYY년 NM월호 — NN. Title" H3 → "<h2>NN. Title</h2>"
  // (index 섹션 파일이 이 형식의 부제를 포함하므로 섹션 디바이더로 승격)
  bodyHtml = bodyHtml.replace(/<h3>([\s\S]*?)<\/h3>/gi, (m, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    if (/\d{4}년.*—\s*\d{1,2}\./.test(text)) {
      const dashIdx = inner.lastIndexOf("—");
      if (dashIdx >= 0) return `<h2>${inner.slice(dashIdx + 1).trim()}</h2>`;
    }
    return m;
  });

  // 선두 blockquote(발행일) + 첫 hr 제거
  bodyHtml = bodyHtml.replace(/^\s*<blockquote>[\s\S]*?<\/blockquote>\s*/i, "");
  bodyHtml = bodyHtml.replace(/^\s*<hr\s*\/?>\s*/i, "");

  // D12: <del>(~~취소선~~) 태그 제거
  bodyHtml = bodyHtml.replace(/<del>([\s\S]*?)<\/del>/gi, "$1");

  // ── Heading classification ───────────────────────────────────────────────
  const toc = [];
  let leadNext = false;
  let insideNumberedSub = false;

  // D3: marked 출력의 inner는 이미 HTML 인코딩됨(&amp; 등).
  // escapeHtml(text) 로 재인코딩하면 &amp;amp; 로 이중 인코딩되므로,
  // text(= inner의 태그 제거본, 이미 HTML-safe) 를 출력에 직접 사용.
  const html = bodyHtml.replace(
    /<(h[123])>([\s\S]*?)<\/\1>/gi,
    (m, tag, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const mSec = text.match(/^(\d{1,2})\.\s+(.+)$/); // "02. 해운 시황"
      const isArticles = /^주요\s*해운\s*기사$/.test(text);
      const mSub = text.match(/^(\d{1,2}-\d)\.\s+(.+)$/); // "02-1. KCCI ..."

      if (mSec || isArticles) {
        const num = mSec ? mSec[1] : "·";
        const title = mSec ? mSec[2] : "주요 해운 기사"; // text는 이미 HTML-encoded
        toc.push({ num, title });
        leadNext = true;
        insideNumberedSub = false;
        return (
          `<section class="divider"><div class="dv-tag">SECTION ${num}</div>` +
          `<div class="dv-num">${num}</div><div class="dv-rule"></div>` +
          `<h2 class="dv-title">${title}</h2></section>`
        );
      }
      if (tag.toLowerCase() === "h3" && !mSub && insideNumberedSub) {
        return `<h3 class="article-title">${inner}</h3>`;
      }
      // 05(지역) 소제목은 페이지를 강제하지 않는 유기적 플로우 — 내용 길이만큼만 차지.
      // (짧은 이슈 블록마다 1페이지를 배정해 공백·폰트 이질이 생기던 문제의 근본 해소)
      const isFlowSub = mSub && /^05-/.test(mSub[1]);
      const cls = isFlowSub ? "sub sub-flow" : leadNext ? "sub lead" : "sub";
      leadNext = false;
      insideNumberedSub = Boolean(mSub);
      const t2 = mSub
        ? `<span class="sub-no">${mSub[1]}</span>${mSub[2]}` // 이미 HTML-encoded
        : text;
      return `<h2 class="${cls}">${t2}</h2>`;
    },
  );

  // D8: 첫째/둘째/셋째 열거는 문장 종결 뒤 줄바꿈 삽입 (종합전망 가독성)
  let result = html.replace(
    /\.\s+(첫째,|둘째,|셋째,|넷째,|다섯째,)/g,
    ".<br>&nbsp;&nbsp;$1",
  );

  // D9: leadNext 버그 수정 — 섹션 디바이더와 h2.sub.lead 사이에 단락/표/이미지가 끼어있으면
  // lead 클래스를 제거해 잘못된 break-before:auto 적용을 방지.
  result = result.replace(
    /(<\/section>)([\s\S]*?)(<h2 class="sub lead">)/g,
    (_, endSection, between, h2Lead) => {
      if (/<(?:p|table|figure|blockquote|ul|ol|div)[^>]*>/.test(between)) {
        return endSection + between + '<h2 class="sub">';
      }
      return endSection + between + h2Lead;
    },
  );

  return { html: result, toc };
}

// 표 셀 등락: ▲ 적색 / ▼ 청색
function colorDeltas(html) {
  return html.replace(/<td>([^<]*?[▲▼][^<]*?)<\/td>/g, (m, c) => {
    if (c.includes("▲")) return `<td class="up">${c}</td>`;
    if (c.includes("▼")) return `<td class="down">${c}</td>`;
    return m;
  });
}

function markLeadLabels(html) {
  return html.replace(
    /<p>\s*<strong>([^<]{1,80}\.?)<\/strong>\s*<\/p>/g,
    '<p class="lead-label"><strong>$1</strong></p>',
  );
}

function looksLikeStatValue(value) {
  return /^\s*(?:[▲▼+-]\s*)?(?:[$€₩¥]\s*)?\d/.test(String(value || ""));
}

function findNextSubsectionStart(html, afterIndex) {
  const nextSubRel = html
    .slice(afterIndex)
    .search(/<h2 class="sub(?: lead)?"><span class="sub-no">\d{2}-\d<\/span>[\s\S]*?<\/h2>/);
  return nextSubRel >= 0 ? afterIndex + nextSubRel : html.length;
}

function getTopicBlock(html, topicId) {
  const headingRe = new RegExp(
    `<h2 class="sub(?: lead)?"><span class="sub-no">(${topicId})<\\/span>[\\s\\S]*?<\\/h2>`,
  );
  const match = html.match(headingRe);
  if (!match || match.index == null) return null;

  const start = match.index;
  const afterHeading = start + match[0].length;
  const nextTopicStart = findNextSubsectionStart(html, afterHeading);
  const boundaries = [
    nextTopicStart,
    html.indexOf('<section class="divider">', start),
    html.indexOf('<section class="ocean-topic', afterHeading),
    html.indexOf('<section class="fit-topic', afterHeading),
    html.indexOf('<section class="paired-page', afterHeading),
    html.indexOf("<hr>", start),
  ].filter((x) => x >= 0);
  const end = Math.min(...boundaries);
  const block = html
    .slice(start, end)
    .replace(/\s*<div class="page-break"><\/div>\s*$/, "");

  return { id: topicId, start, end, block };
}

// 02-1~02-9 해운 주제는 각각 독립된 A4 본문 페이지로 고정한다.
// 표 행 수가 많은 블록은 초기 compact 레이아웃을 적용하고, 렌더 후 실제 높이로 추가 압축한다.
function wrapOceanTopics(html, skipIds = new Set()) {
  const headingRe =
    /<h2 class="sub(?: lead)?"><span class="sub-no">(02-[1-9])<\/span>[\s\S]*?<\/h2>/g;
  const topics = [...html.matchAll(headingRe)];
  if (!topics.length) return html;

  let result = "";
  let cursor = 0;
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const start = topic.index;
    const topicId = topic[1];
    if (skipIds.has(topicId)) continue;
    const afterHeading = start + topic[0].length;
    const nextTopicStart = findNextSubsectionStart(html, afterHeading);
    const boundaries = [
      nextTopicStart,
      html.indexOf('<section class="divider">', start),
      html.indexOf("<hr>", start),
    ].filter((x) => x >= 0);
    const end = Math.min(...boundaries);
    let block = html.slice(start, end);
    block = block.replace(/\s*<div class="page-break"><\/div>\s*$/, "");
    const tbody = block.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] || "";
    const rows = (tbody.match(/<tr>/g) || []).length;
    const compact = rows >= 7 ? " compact" : "";

    result += html.slice(cursor, start);
    result += `<section class="ocean-topic${compact}" data-topic="${topicId}" data-table-rows="${rows}">${block}</section>`;
    cursor = end;
  }
  return result + html.slice(cursor);
}

function wrapPairedTopics(html) {
  const groups = [
    { ids: ["02-5", "02-6"], layout: "columns" },
    { ids: ["02-7", "02-8"], layout: "columns" },
    // 03-2+03-3 병합 해제 — 6월 KITA 표 확대로 고정 행 초과(2026-07). 각자 페이지로.
    // 05 지역 3단(stack3) 병합 제거 — 기본 폰트 7.25pt로 타 페이지와 이질적이고,
    // 짧은 블록 3개를 고정 높이에 배치해 대형 공백 발생. 05는 일반 플로우(기본 폰트)로 렌더.
    { ids: ["06-1", "06-2"], layout: "columns" },
  ];

  const ranges = [];
  for (const group of groups) {
    const blocks = group.ids.map((id) => getTopicBlock(html, id));
    if (blocks.some((block) => !block)) continue;
    ranges.push({
      ids: group.ids,
      start: blocks[0].start,
      end: blocks[blocks.length - 1].end,
      html:
        `<section class="paired-page pair-layout-${group.layout}" data-pair="${group.ids.join("+")}">` +
        blocks
          .map(
            (block) =>
              `<div class="pair-item" data-topic="${block.id}">${block.block}</div>`,
          )
          .join("") +
        "</section>",
    });
  }

  if (!ranges.length) return html;
  ranges.sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    result += html.slice(cursor, range.start);
    result += range.html;
    cursor = range.end;
  }
  return result + html.slice(cursor);
}

// 표·차트가 길어 한 페이지를 넘기 쉬운 비해운 페이지도 고정 높이로 감시한다.
function wrapFitTopics(html, skipIds = new Set()) {
  const headingRe =
    /<h2 class="sub(?: lead)?"><span class="sub-no">(03-2)<\/span>[\s\S]*?<\/h2>/g;
  const topics = [...html.matchAll(headingRe)];
  if (!topics.length) return html;

  let result = "";
  let cursor = 0;
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const start = topic.index;
    const topicId = topic[1];
    if (skipIds.has(topicId)) continue;
    const afterHeading = start + topic[0].length;
    const nextSubRel = html
      .slice(afterHeading)
      .search(/<h2 class="sub(?: lead)?"><span class="sub-no">\d{2}-\d<\/span>[\s\S]*?<\/h2>/);
    const nextTopicStart = nextSubRel >= 0 ? afterHeading + nextSubRel : html.length;
    const boundaries = [
      nextTopicStart,
      html.indexOf('<section class="divider">', start),
      html.indexOf("<hr>", start),
    ].filter((x) => x >= 0);
    const end = Math.min(...boundaries);
    let block = html.slice(start, end);
    block = block.replace(/\s*<div class="page-break"><\/div>\s*$/, "");
    const tbody = block.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] || "";
    const rows = (tbody.match(/<tr>/g) || []).length;
    const compact = rows >= 6 ? " compact" : "";

    result += html.slice(cursor, start);
    result += `<section class="fit-topic${compact}" data-topic="${topicId}" data-table-rows="${rows}">${block}</section>`;
    cursor = end;
  }
  return result + html.slice(cursor);
}

function buildHtml(transformed, chartConfigs = [], front = {}) {
  // 스파인 세로 텍스트 — 회전을 SVG 내부에서 처리(인쇄 시 transform/writing-mode 파편화 회피)
  const spineLabel = `LOGISIGHT MONTHLY INTELLIGENCE · VOL.${VOL} · ${ENG_MONTH} ${Number(YY)}`;
  const spineSvg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='23' height='605' viewBox='0 0 23 605'>` +
    `<text x='0' y='0' transform='translate(15,600) rotate(-90)' font-family='Arial,Helvetica,sans-serif' ` +
    `font-size='8.8' font-weight='bold' letter-spacing='2.2' fill='rgba(255,255,255,0.92)'>${spineLabel}</text></svg>`;
  const SPINE_IMG = `data:image/svg+xml;utf8,${encodeURIComponent(spineSvg)}`;


  // 차트 라인 팔레트 = design.md §5-4 (primary → slate → gray → … → teal/red)
  const chartScript = chartConfigs.length
    ? `
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
const PALETTE = ['#0E3A66','#7FB3DC','#00818A','#9AA6B2','#C0392B','#5B6167'];
const CFG = ${JSON.stringify(chartConfigs)};
CFG.forEach(c => {
  const el = document.getElementById('chart_' + c.id);
  if (!el) return;
  (c.data.datasets || []).forEach((d, i) => {            // 팔레트 강제 — 차트 간 색 언어 통일
    d.borderColor = PALETTE[i % PALETTE.length];
    if (d.backgroundColor == null) d.backgroundColor = 'transparent';
    if (d.borderWidth == null) d.borderWidth = 1.6;
    if (d.pointRadius == null) d.pointRadius = 0;
    if (d.tension == null) d.tension = 0.25;
  });
  new Chart(el, { type:'line', data:c.data, options:{
    responsive:true, maintainAspectRatio:false, animation:false,
    plugins:{ title:{display:false},
      legend:{position:'bottom',labels:{font:{size:8.5},boxWidth:13,boxHeight:2.5,color:'#5E646B'}} },
    scales:{
      x:{ticks:{font:{size:7},maxRotation:45,autoSkip:true,maxTicksLimit:10,color:'#8B9198'},grid:{display:false},border:{color:'#B9C0C7'}},
      y:{ticks:{font:{size:7},color:'#8B9198'},grid:{color:'#E3E6E9'},border:{display:false}}
    }
  }});
});
window.__chartsReady = true;
</script>`
    : "";

  // t.title은 marked 출력에서 추출 → 이미 HTML-encoded. escapeHtml() 재호출 금지(이중 인코딩).
  const issueRows = transformed.toc
    .map((t) => `<li><b>${t.num}</b><span style="flex:1">${t.title}</span></li>`)
    .join("");

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
/* ── 경기천년제목(무료, 경기도) — 사내 self-host 권장. 미설치/CDN 미접속 시 Pretendard 800으로 자동 대체 ── */
@font-face{font-family:'GyeonggiTitle';font-weight:800;font-display:swap;
  src:url('https://cdn.jsdelivr.net/gh/webfontworld/gyeonggi/GyeonggiTitleB.woff2') format('woff2');}
@font-face{font-family:'GyeonggiTitle';font-weight:500;font-display:swap;
  src:url('https://cdn.jsdelivr.net/gh/webfontworld/gyeonggi/GyeonggiTitleM.woff2') format('woff2');}

/* ── DESIGN TOKENS (design.md §7) ── */
:root{
  --c-primary:#0E3A66; --c-primary-deep:#082A4C;   /* 구조색 = 네이비 (Drewry 문법) */
  --c-mint:#2dd4bf; --c-mint-deep:#0ea5a0;           /* 로고 브랜드 민트 */
  --c-teal:#00818A; --c-teal-cyan:#0090A8; --c-charcoal:#4D4D4D;
  --c-ink:#1A1A1A; --c-body:#333333; --c-body-soft:#555555; --c-caption:#888888;
  --c-rule:#D9D9D9; --c-rule-strong:#BFBFBF;
  --c-thead:#0E3A66; --c-thead-2:#A6A6A6; --c-zebra:#F2F4F6;
  --c-box-fill:#EDEDED; --c-band-gray:#E6E6E6;
  --c-up:#C00000; --c-down:#1F5FA8;   /* 하락색을 브랜드색과 분리 */
  --font-title:'GyeonggiTitle','Pretendard','Noto Sans KR',sans-serif;
  --font-sans:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;
  --font-serif:'Noto Serif KR',serif;  /* 인용·각주 한정(거의 미사용) */
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── PAGE GEOMETRY ──────────────────────────────────────────────
   상하 마진은 @page가 담당(모든 본문 페이지 — 오버플로 연속 페이지 포함).
   표지·목차·디바이더·뒷표지는 named page(bleed)로 풀블리드 유지.
   weekly-report-pdf.js(4f12150)와 동일 방식. 좌우 여백은 .flow 패딩. */
@page{size:A4;margin:16mm 0 14mm}
@page bleed{margin:0}

body{font-family:var(--font-sans);color:var(--c-body);font-size:10pt;line-height:1.6;
  margin:0;background:transparent;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* ── LANDING COVER (표지 아트 풀블리드 + 타이틀 오버레이 — 원본 상단 로고 텍스트는 .ld-shade가 가림) ── */
.landing{page:bleed;width:210mm;height:297mm;overflow:hidden;break-after:page;position:relative;
  background:#0A2036 url('${COVER_IMG}') center/cover no-repeat;color:#fff}
.ld-shade{position:absolute;left:0;top:0;right:0;height:33%;z-index:1;
  background:linear-gradient(90deg,#011126 0%,#0C2847 52%,#193B5E 100%);
  -webkit-mask-image:linear-gradient(180deg,#000 0,#000 72%,transparent 100%);
  mask-image:linear-gradient(180deg,#000 0,#000 72%,transparent 100%)}
.ld-head-zone{position:absolute;left:0;right:0;top:15mm;z-index:2;text-align:center;padding:0 20mm}
.ld-kicker{font-size:8.5pt;letter-spacing:4.5px;color:#9FBCDD;font-weight:700;margin-bottom:5.5mm}
.ld-title{font-family:var(--font-title);font-weight:800;font-size:32pt;line-height:1.15;
  letter-spacing:.02em;color:#fff;margin:0 0 5mm}
.ld-rule{width:22mm;height:.8mm;background:#C8B37E;margin:0 auto 5mm}
.ld-sub{font-size:9.5pt;color:rgba(255,255,255,.78);margin:0}
.ld-bottom{position:absolute;left:14mm;right:14mm;bottom:9mm;z-index:2}
.ld-issue{border-top:1px solid rgba(200,179,126,.45);padding-top:3.5mm;margin-bottom:4mm}
.ld-issue-h{font-size:7.5pt;letter-spacing:4px;color:#C8B37E;font-weight:800;margin-bottom:2.5mm;text-align:center}
.ld-issue ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:1mm 9mm}
.ld-issue li{display:flex;gap:3mm;align-items:baseline;font-size:8.5pt;color:rgba(255,255,255,.82);padding:.8mm 0}
.ld-issue li b{color:#C8B37E;font-weight:800;font-variant-numeric:tabular-nums}
.ld-foot{display:flex;justify-content:space-between;font-size:7.5pt;color:rgba(255,255,255,.5)}
/* 전 페이지 좌측 스파인 — 단일 fixed 밴드(마진 구간 포함 풀하이트, 매 페이지 반복 인쇄).
   캔버스 배경·헤더/푸터 템플릿 블록 3조각 방식은 폭·오프셋이 서로 어긋나 폐기.
   top:-20mm/340mm = 콘텐츠 페이지의 fixed 마진 오프셋(+16mm)까지 흡수해 0~297mm 전체 커버 */
.spine-band{position:fixed;left:0;top:-20mm;width:6mm;height:340mm;background:#0E3A66;z-index:58}
/* 스파인 텍스트(fixed, 하단 정렬) + 상단 유령 파편 마스크(Chromium 인쇄 quirk) */
.spine-mask{position:fixed;left:0;top:0;width:6mm;height:88mm;background:#0E3A66;z-index:60}
.spine-text{position:fixed;left:0;bottom:42mm;width:6mm;height:160mm;z-index:59}
.spine-text img{width:6mm;height:160mm;display:block}

/* ── SECTION DIVIDER (풀블리드, 블루 — 섹션을 브랜드 컬러로 구분) ── */
.divider{page:bleed;width:210mm;height:297mm;overflow:hidden;color:#fff;break-before:page;break-after:page;
  background:linear-gradient(135deg,var(--c-primary) 0%,var(--c-primary-deep) 100%);
  padding:30mm 24mm;display:flex;flex-direction:column;justify-content:center}
.dv-tag{font-size:9pt;letter-spacing:6px;color:rgba(255,255,255,.85);font-weight:600;margin-bottom:4mm}
.dv-num{font-family:var(--font-title);font-size:120pt;font-weight:800;line-height:.86;color:rgba(255,255,255,.16)}
.dv-rule{width:30mm;height:3px;background:var(--c-mint);margin:7mm 0}
.dv-title{font-family:var(--font-title);font-size:28pt;font-weight:800;color:#fff;
  letter-spacing:-.01em;border:none;padding:0;margin:0}

/* ── 섹션 대시보드 (02 해운: 디바이더 대신 4차트 오프너 — Drewry 스몰 멀티플 문법) ── */
.dash-page{height:265mm;overflow:hidden;break-before:page;break-after:page}
.sec-band{display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:1mm solid var(--c-primary);padding-bottom:2.5mm;margin-bottom:6mm}
.sec-band .st{font-family:var(--font-title);font-size:20pt;font-weight:800;color:var(--c-primary);letter-spacing:-.01em}
.sec-band .st .no{margin-right:4mm}
.sec-band .sp{font-size:8.5pt;color:var(--c-caption);font-weight:600}
.dash-grid{display:grid;grid-template-columns:1fr 1fr;gap:6mm}
.dash-fig{border:1px solid var(--c-rule)}
.dash-band{background:var(--c-primary);color:#fff;font-size:9pt;font-weight:700;
  padding:1.8mm 3mm;display:flex;justify-content:space-between;letter-spacing:.3px}
.dash-band small{font-size:8pt;font-weight:700;color:#fff;opacity:.92}
.dash-plot{height:56mm;padding:2mm 2.5mm;background:#fff}
.dash-src{font-size:7.5pt;color:var(--c-caption);font-style:italic;margin-top:4mm}

/* ── Executive Summary (DHL OFR p2 문법) ── */
.exec-page{height:265mm;overflow:hidden;break-before:page;break-after:page}
.exec-page .sec-band{margin-bottom:2.5mm}
.ex-row{display:flex;gap:5mm;align-items:flex-start;padding:1.9mm 0;border-bottom:1px solid var(--c-rule)}
.ex-tag{flex:0 0 30mm;background:var(--c-primary);color:#fff;font-size:8pt;font-weight:800;
  letter-spacing:1px;text-align:center;padding:2.2mm 0;margin-top:.5mm}
.ex-main{flex:1;min-width:0}
.ex-head{font-family:var(--font-title);font-size:12pt;font-weight:800;color:var(--c-ink);margin-bottom:1.1mm}
.ex-head.up{color:var(--c-up)}.ex-head.down{color:var(--c-down)}
.ex-main ul{list-style:none;padding:0;margin:0}
.ex-main li{font-size:9pt;color:var(--c-body);line-height:1.45;padding-left:4mm;position:relative;margin-bottom:.5mm}
.ex-main li::before{content:'';position:absolute;left:0;top:.55em;width:5px;height:5px;background:var(--c-primary)}

/* ── KCCI 히트맵 ── */
.hm-wrap{margin-top:2.2mm}
table.heatmap{width:100%;border-collapse:collapse;font-size:8pt;margin:0;
  border-top:0;border-bottom:1px solid var(--c-rule-strong);font-variant-numeric:tabular-nums}
table.heatmap thead th{background:#F1F4F7;color:var(--c-ink);font-weight:700;padding:1.1mm 2mm;
  text-align:center;border-bottom:1.5px solid var(--c-primary)}
table.heatmap thead th:first-child{text-align:left}
table.heatmap td{padding:.85mm 2mm;text-align:center;border-bottom:1px dotted var(--c-rule);font-weight:700}
table.heatmap td:first-child{text-align:left;color:var(--c-ink);font-weight:600;background:#fff}
td.hm-up{background:#FBEAEA;color:var(--c-up)}
td.hm-down{background:#E8F0F9;color:var(--c-down)}
td.hm-flat{background:#F4F5F6;color:var(--c-body-soft)}
td.hm-na{color:var(--c-caption)}
tr.hm-total td{background:#EDF2F8;border-bottom:1.5px solid var(--c-primary)}
tr.hm-total td.hm-up{background:#F6DFDF}

/* ── TAKEAWAY 밴드 (블록 마지막 전망 문장 승격) ── */
.takeaway{background:#F0F4F8;border-left:2.4mm solid var(--c-primary);
  padding:2.4mm 4mm;margin:3mm 0 4mm;break-inside:avoid}
.takeaway p{margin:0;font-size:9.2pt;color:var(--c-primary-deep);font-weight:600;line-height:1.5}
.takeaway p::before{content:'≫  ';color:var(--c-primary);font-weight:800}

/* ── FLOW CONTENT ── */
.flow{padding:0 18mm}
.flow>:first-child{margin-top:0}
.flow>.divider{margin-left:-18mm;margin-right:-18mm}
hr{display:none}

/* 서브섹션 제목 = 자기 페이지에서 시작(블루 밑줄). 디바이더 직후 첫 제목만 lead */
h2.sub{font-family:var(--font-title);font-size:19pt;font-weight:800;color:var(--c-ink);
  letter-spacing:-.02em;line-height:1.12;white-space:nowrap;margin:0 0 6mm;padding:2mm 0 2.5mm;border-bottom:2.5px solid var(--c-primary);
  break-before:page;break-after:avoid}
h2.sub.lead{break-before:auto}
/* 유기적 플로우 소제목(05 지역 등) — 페이지 강제 없음, 내용 길이만큼 흐름. 본문 폰트는 기본 10pt 유지 */
h2.sub.sub-flow{break-before:auto;break-after:avoid;white-space:normal;font-size:15pt;
  padding:6mm 0 2mm;margin:0 0 4mm}
h2.sub.sub-flow:first-of-type{padding-top:2mm}
h2.sub .sub-no{font-family:var(--font-title);color:var(--c-primary);font-weight:800;margin-right:3mm}
h3{font-family:var(--font-title);font-size:12pt;font-weight:700;color:var(--c-teal);margin:6mm 0 2.5mm;break-after:avoid}

/* 해운 02-1~02-9: 각 주제를 본문 1페이지에 고정.
   @page 상하 마진(16+14mm) 적용 후 콘텐츠 높이 267mm — 265mm로 2mm 슬랙을 둬
   서브픽셀 드리프트로 인한 오버플로 빈 페이지를 방지. */
.ocean-topic{height:265mm;overflow:hidden;break-before:page;padding:0}
.ocean-topic h2.sub{break-before:auto;padding-top:0}
.ocean-topic.compact h2.sub{font-size:16pt;margin-bottom:4mm;padding-bottom:2mm}
.ocean-topic.compact .chart-box{height:51mm;padding:2.5mm;margin:2.5mm 0 3mm}
.ocean-topic.compact table{font-size:8.2pt;margin:2.5mm 0 3mm}
.ocean-topic.compact thead th{padding:1.7mm 2mm}
.ocean-topic.compact tbody td{padding:1.45mm 2mm}
.ocean-topic.compact p{font-size:9.2pt;line-height:1.55;margin-bottom:2.4mm}
.ocean-topic.tight h2.sub{font-size:15pt;margin-bottom:3mm;padding-bottom:1.7mm}
.ocean-topic.tight .chart-box{height:43mm;padding:2mm;margin:2mm 0 2.5mm}
.ocean-topic.tight table{font-size:7.8pt;margin:2mm 0 2.5mm}
.ocean-topic.tight thead th{padding:1.25mm 1.6mm}
.ocean-topic.tight tbody td{padding:1mm 1.6mm}
.ocean-topic.tight p{font-size:8.7pt;line-height:1.48;margin-bottom:1.8mm}
.ocean-topic.ultra h2.sub{font-size:14pt;margin-bottom:2.4mm;padding-bottom:1.4mm}
.ocean-topic.ultra .chart-box{height:36mm;padding:1.6mm;margin:1.6mm 0 2mm}
.ocean-topic.ultra table{font-size:7.35pt;margin:1.6mm 0 2mm}
.ocean-topic.ultra thead th{padding:.9mm 1.3mm}
.ocean-topic.ultra tbody td{padding:.72mm 1.3mm}
.ocean-topic.ultra p{font-size:8.15pt;line-height:1.4;margin-bottom:1.35mm}

/* 표·차트가 긴 비해운 단일 페이지(예: 03-2)는 한 페이지 안에 고정 (265mm — ocean-topic과 동일 슬랙) */
.fit-topic{height:265mm;overflow:hidden;break-before:page;padding:0}
.fit-topic h2.sub{break-before:auto;padding-top:0}
.fit-topic.compact h2.sub{font-size:16pt;margin-bottom:3.5mm;padding-bottom:1.8mm}
.fit-topic.compact .chart-box{height:43mm;padding:2.2mm;margin:2mm 0 2.5mm}
.fit-topic.compact table{font-size:7.65pt;margin:2mm 0 2.4mm}
.fit-topic.compact thead th{padding:1.15mm 1.45mm}
.fit-topic.compact tbody td{padding:.85mm 1.45mm}
.fit-topic.compact p{font-size:8.8pt;line-height:1.45;margin-bottom:1.8mm}
.fit-topic.compact p.lead-label{font-size:8.8pt;margin:1.4mm 0 .35mm}
.fit-topic.tight h2.sub{font-size:15pt;margin-bottom:2.8mm;padding-bottom:1.5mm}
.fit-topic.tight .chart-box{height:39mm;padding:1.8mm;margin:1.7mm 0 2mm}
.fit-topic.tight table{font-size:7.35pt;margin:1.7mm 0 2mm}
.fit-topic.tight thead th{padding:.95mm 1.25mm}
.fit-topic.tight tbody td{padding:.7mm 1.25mm}
.fit-topic.tight p{font-size:8.35pt;line-height:1.38;margin-bottom:1.35mm}
.fit-topic.tight p.lead-label{font-size:8.3pt;margin:1.1mm 0 .25mm}
.fit-topic.ultra h2.sub{font-size:14pt;margin-bottom:2.2mm;padding-bottom:1.2mm}
.fit-topic.ultra .chart-box{height:35mm;padding:1.4mm;margin:1.4mm 0 1.7mm}
.fit-topic.ultra table{font-size:7.05pt;margin:1.4mm 0 1.7mm}
.fit-topic.ultra thead th{padding:.8mm 1mm}
.fit-topic.ultra tbody td{padding:.58mm 1mm}
.fit-topic.ultra p{font-size:8pt;line-height:1.33;margin-bottom:1mm}
.fit-topic.ultra p.lead-label{font-size:7.9pt;margin:.9mm 0 .2mm}

/* 짧은 인접 주제 자동 병합: 두 개의 sparse page를 한 A4 안에 2열로 배치 */
.paired-page{height:265mm;overflow:hidden;break-before:page;
  padding:0;display:grid;grid-template-columns:1fr 1fr;gap:7mm}
.pair-item{min-width:0;overflow:hidden}
.paired-page h2.sub{break-before:auto;padding-top:0;font-size:13pt;line-height:1.12;
  white-space:normal;margin-bottom:3mm;padding-bottom:1.3mm}
.paired-page h2.sub .sub-no{margin-right:1.7mm}
.paired-page .chart-box{height:38mm;padding:1.5mm;margin:1.5mm 0 2mm;border-radius:4px}
.paired-page table{font-size:6.6pt;margin:1.2mm 0 1.7mm}
.paired-page thead th{padding:.85mm 1mm}
.paired-page tbody td{padding:.55mm 1mm}
.paired-page p{font-size:7.85pt;line-height:1.42;margin-bottom:1.2mm}
.paired-page p.lead-label{font-size:7.6pt;line-height:1.15;margin:.9mm 0 .15mm}
.paired-page .stat-wrap{margin:1.5mm 0 1.8mm}
.paired-page .stat-strip{gap:1.4mm}
.paired-page .stat-card{min-height:18mm;padding:1.7mm 2mm;border-left:1.6mm solid var(--c-primary)}
.paired-page .stat-val{font-size:13pt;margin-bottom:1mm}
.paired-page .stat-lab{font-size:6.7pt;line-height:1.18}
.paired-page .stat-cap{font-size:6.2pt;margin-top:1mm}
.paired-page .stat-highlight{padding:2.2mm 2.8mm;margin:1.5mm 0 1.8mm;border-left-width:1.6mm}
.paired-page .stat-highlight-text{font-size:11pt;line-height:1.18}
.paired-page.pair-layout-stack{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) minmax(0,.82fr);gap:4mm}
.paired-page.pair-layout-stack .pair-item{min-height:0}
.paired-page.pair-layout-stack h2.sub{font-size:12pt;margin-bottom:2.2mm;padding-bottom:1mm}
.paired-page.pair-layout-stack .chart-box{height:27mm;margin:1mm 0 1.4mm}
.paired-page.pair-layout-stack table{font-size:6.8pt;margin:.8mm 0 1.2mm}
.paired-page.pair-layout-stack thead th{padding:.65mm .85mm}
.paired-page.pair-layout-stack tbody td{padding:.42mm .85mm}
.paired-page.pair-layout-stack p{font-size:7.35pt;line-height:1.32;margin-bottom:.8mm}
.paired-page.pair-layout-stack p.lead-label{font-size:7.2pt;margin:.55mm 0 .1mm}
.paired-page.pair-layout-stack3{grid-template-columns:1fr;grid-template-rows:auto auto auto;gap:3mm}
.paired-page.pair-layout-stack3 .pair-item{min-height:0}
.paired-page.pair-layout-stack3 h2.sub{font-size:11.5pt;line-height:1.08;margin-bottom:1.5mm;padding-bottom:.7mm}
.paired-page.pair-layout-stack3 p{font-size:7.25pt;line-height:1.28;margin-bottom:.65mm}
.paired-page.pair-layout-stack3 .stat-wrap{margin:.8mm 0 1mm}
.paired-page.pair-layout-stack3 .stat-strip{grid-template-columns:repeat(3,minmax(0,1fr));gap:1.2mm}
.paired-page.pair-layout-stack3 .stat-card{min-height:16mm;padding:1.1mm 1.5mm;border-left-width:1.3mm}
.paired-page.pair-layout-stack3 .stat-val{font-size:10.5pt;margin-bottom:.35mm}
.paired-page.pair-layout-stack3 .stat-lab{font-size:6.2pt;line-height:1.12}
.paired-page.pair-layout-stack3 .stat-cap{font-size:5.8pt;margin-top:.7mm}
.paired-page.tight{gap:5mm}
.paired-page.tight h2.sub{font-size:12pt;margin-bottom:2.4mm;padding-bottom:1mm}
.paired-page.tight .chart-box{height:32mm;margin:1.2mm 0 1.5mm}
.paired-page.tight table{font-size:6.1pt;margin:1mm 0 1.3mm}
.paired-page.tight p{font-size:7.35pt;line-height:1.34;margin-bottom:.9mm}
.paired-page.tight p.lead-label{font-size:7pt;margin:.65mm 0 .1mm}
.paired-page.tight .stat-val{font-size:12pt}
.paired-page.tight .stat-lab{font-size:6.25pt}
.paired-page.ultra{gap:4mm}
.paired-page.ultra h2.sub{font-size:11pt;margin-bottom:1.8mm;padding-bottom:.8mm}
.paired-page.ultra .chart-box{height:25mm;margin:.75mm 0 1mm}
.paired-page.ultra table{font-size:5.45pt;margin:.6mm 0 .8mm}
.paired-page.ultra thead th{padding:.5mm .65mm}
.paired-page.ultra tbody td{padding:.32mm .65mm}
.paired-page.ultra p{font-size:6.55pt;line-height:1.22;margin-bottom:.5mm}
.paired-page.ultra p.lead-label{font-size:6.35pt;margin:.32mm 0 .05mm}
.paired-page.ultra .stat-card{min-height:15mm;padding:1.3mm 1.5mm}
.paired-page.ultra .stat-val{font-size:11pt;margin-bottom:.6mm}
.paired-page.ultra .stat-lab{font-size:5.8pt}
.paired-page.pair-layout-stack.tight{grid-template-rows:minmax(0,1fr) minmax(0,.8fr);gap:3mm}
.paired-page.pair-layout-stack.tight .chart-box{height:24mm}
.paired-page.pair-layout-stack.tight p{font-size:6.9pt;line-height:1.25;margin-bottom:.55mm}
.paired-page.pair-layout-stack.ultra{grid-template-rows:minmax(0,1fr) minmax(0,.78fr);gap:2.3mm}
.paired-page.pair-layout-stack.ultra .chart-box{height:21mm}
.paired-page.pair-layout-stack.ultra p{font-size:6.3pt;line-height:1.18;margin-bottom:.35mm}
.paired-page.pair-layout-stack3.tight{gap:2.2mm}
.paired-page.pair-layout-stack3.tight h2.sub{font-size:10.5pt}
.paired-page.pair-layout-stack3.tight p{font-size:6.8pt;line-height:1.22;margin-bottom:.45mm}
.paired-page.pair-layout-stack3.ultra{gap:1.6mm}
.paired-page.pair-layout-stack3.ultra h2.sub{font-size:9.8pt}
.paired-page.pair-layout-stack3.ultra p{font-size:6.25pt;line-height:1.16;margin-bottom:.3mm}
.paired-page.pair-layout-stack3.ultra .stat-card{min-height:13mm}
.paired-page.pair-layout-stack3.ultra .stat-val{font-size:9pt}
.paired-page.pair-layout-stack3.ultra .stat-lab{font-size:5.5pt}

p{font-size:10pt;line-height:1.6;color:var(--c-body);margin:0 0 3.4mm}
strong{color:var(--c-ink);font-weight:800}
p.lead-label{font-family:var(--font-title);font-size:10.4pt;line-height:1.25;
  margin:3.2mm 0 .8mm;color:var(--c-primary-deep);break-after:avoid}
p.lead-label strong{color:var(--c-primary-deep);font-weight:800}
.ocean-topic p.lead-label{font-size:9.1pt;line-height:1.18;margin:2mm 0 .45mm}
.ocean-topic.compact p.lead-label{font-size:8.8pt;margin:1.65mm 0 .35mm}
.ocean-topic.tight p.lead-label{font-size:8.4pt;margin:1.25mm 0 .25mm}
.ocean-topic.ultra p.lead-label{font-size:8pt;margin:1mm 0 .2mm}

/* 불릿 = design.md §5-2 : ■ 네이비 사각(1차) / – 대시(하위) */
.flow ul{list-style:none;padding-left:0;margin:0 0 3.4mm}
.flow ol{padding-left:6mm;margin:0 0 3.4mm}
.flow li{font-size:9.7pt;line-height:1.62;color:var(--c-body);margin-bottom:1.4mm}
.flow ul>li{position:relative;padding-left:5.4mm}
.flow ul>li::before{content:'';position:absolute;left:0;top:.6em;width:6px;height:6px;background:var(--c-primary)}
.flow ul ul{margin:1.4mm 0 0}
.flow ul ul>li::before{content:'–';left:.4mm;top:0;width:auto;height:auto;background:none;
  color:var(--c-body-soft);font-weight:700}
.flow ol>li{padding-left:1mm}
.flow ol>li::marker{color:var(--c-primary);font-weight:700}

/* 콜아웃(blockquote) — 블루 좌측바 + 박스필 */
blockquote{background:#F0F4F8;border-left:3px solid var(--c-primary);border-radius:0;
  padding:4mm 6mm;margin:5mm 0;break-inside:avoid}
blockquote p{font-size:9.6pt;color:var(--c-primary-deep);font-weight:500;margin:0;line-height:1.6}

/* 데이터 표 = design.md §5-3 : 회색 헤더밴드(흰 글자) + 점선 행구분 + 제브라 + 상하단선만 */
table{width:100%;border-collapse:collapse;margin:4mm 0 5mm;font-size:9pt;break-inside:avoid;
  border-top:1px solid var(--c-rule-strong);border-bottom:1px solid var(--c-rule-strong)}
thead th{font-family:var(--font-sans);font-weight:700;color:#fff;background:var(--c-thead);
  text-align:right;padding:2.4mm 3mm;white-space:nowrap}
thead th:first-child{text-align:left}
tbody td{padding:2.1mm 3mm;border-bottom:1px dotted var(--c-rule);text-align:right;color:var(--c-body);
  font-variant-numeric:tabular-nums}
tbody td:first-child{text-align:left;color:var(--c-ink);font-weight:600}
tbody tr:nth-child(even) td{background:var(--c-zebra)}
td.up{color:var(--c-up);font-weight:700}
td.down{color:var(--c-down);font-weight:700}

/* 차트 카드 = design.md §5-4 : 라이트 박스 */
.chart-box{height:64mm;background:#fff;border:1px solid var(--c-rule);border-top:1mm solid var(--c-primary);
  border-radius:0;padding:3mm 3mm 2mm;margin:4mm 0 5mm;break-inside:avoid}
.chart-box canvas{max-width:100%}

/* 기사 이미지 */
.flow img{display:block;width:100%;height:auto;max-height:95mm;object-fit:cover;
  border-radius:0;margin:4mm 0 5mm;break-inside:avoid}
.flow p em{color:var(--c-caption);font-style:italic;font-size:8.5pt}
.flow p:last-child em{color:#9aa3af}

/* 카테고리 배지 (해운 기사 섹션) — 틸 보조강조 */
p.article-cat{font-family:var(--font-sans);font-size:7.5pt;letter-spacing:4px;
  color:var(--c-teal);font-weight:700;text-transform:uppercase;margin:0 0 2mm}

/* 차트 no-data 안내 */
.chart-box.no-data{display:flex;align-items:center;justify-content:center;background:#F5F5F5}
.no-data-msg{color:#9aa3af;font-style:italic;font-size:9pt}

/* 뒷표지 */
.backcover{page:bleed;width:210mm;height:297mm;position:relative;overflow:hidden;break-before:page;
  background:linear-gradient(160deg,#0E3A66 0%,#071F38 100%);
  color:#fff;padding:32mm 24mm;display:flex;flex-direction:column;justify-content:flex-end;gap:0}
.bc-brand{margin-bottom:6mm}.bc-brand svg{height:11mm;width:auto;display:block}
.bc-rule{width:24mm;height:3px;background:var(--c-mint);margin-bottom:8mm}
.bc-statement{font-size:11pt;color:rgba(255,255,255,.8);line-height:1.7;margin-bottom:auto;padding-bottom:20mm}
.bc-disclaimer{font-size:8pt;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:4mm}
.bc-contact{font-size:8.5pt;color:rgba(255,255,255,.65);margin-bottom:2mm}
.bc-copy{font-size:7.5pt;color:rgba(255,255,255,.4)}

/* KPI 카드 = 라벨 상단형 (label-top tile) */
.stat-wrap{margin:4mm 0 4.2mm;break-inside:avoid}
.stat-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:3mm;align-items:stretch}
.stat-card{background:#F7FAFC;border:0;border-left:2.4mm solid var(--c-primary);border-radius:0;
  padding:3.2mm 3.5mm;min-height:28mm;display:flex;flex-direction:column;justify-content:flex-start}
.stat-lab{font-size:8.1pt;color:var(--c-ink);font-weight:700;line-height:1.28;min-height:0;margin:0;
  word-break:keep-all;overflow-wrap:anywhere}
.stat-val{font-family:var(--font-title);font-size:18pt;font-weight:800;color:var(--c-ink);line-height:1.05;
  margin-bottom:2.2mm;white-space:nowrap}
.stat-val.up{color:var(--c-up)}.stat-val.down{color:var(--c-down)}
.stat-cap{font-size:7.4pt;color:var(--c-caption);margin-top:2.1mm;text-align:left}
.stat-highlight{background:#F7FAFC;border:0;border-left:2.4mm solid var(--c-primary);
  padding:4.2mm 5mm;margin:4mm 0 4.2mm;break-inside:avoid}
.stat-highlight-text{font-family:var(--font-title);font-size:15.5pt;font-weight:800;line-height:1.24;
  color:var(--c-ink);letter-spacing:-.02em;word-break:keep-all;overflow-wrap:anywhere}

/* 뉴스 카드 (03-4 / 04-3 기사 페이지) */
.news-card{background:#fff;border:1px solid var(--c-band-gray);border-top:3px solid var(--c-teal);
  padding:5mm 6mm;margin:4mm 0;break-inside:avoid}
.news-headline{font-family:var(--font-title);font-size:13pt;font-weight:800;color:var(--c-ink);
  margin-bottom:3mm;line-height:1.3}
.news-summary{font-size:9.5pt;color:var(--c-body);margin:0 0 3mm;line-height:1.6}
.news-meta{font-size:8pt;color:var(--c-caption);font-weight:600;letter-spacing:1px}
</style>
</head>
<body>

<section class="landing">
  <div class="spine-band"></div>
  <div class="spine-mask"></div>
  <div class="spine-text"><img src="${SPINE_IMG}" alt=""></div>
  <div class="ld-shade"></div>
  <div class="ld-head-zone">
    <div class="ld-kicker">MONTHLY MARKET INTELLIGENCE · VOL.${VOL} · ${ENG_MONTH} ${Number(YY)}</div>
    <h1 class="ld-title">월간 시장 인텔리전스</h1>
    <div class="ld-rule"></div>
    <p class="ld-sub">글로벌 해운·항공·철도 운임과 공급망·지정학 동향 종합 분석 · ${Number(YY)}년 ${Number(MM)}월호</p>
  </div>
  <div class="ld-bottom">
    <div class="ld-issue">
      <div class="ld-issue-h">IN THIS ISSUE</div>
      <ul>${issueRows}</ul>
    </div>
    <div class="ld-foot">
      <span>발행 ${PUB} · 데이터 기준: 직전월 최종 공표 주차</span>
      <span>logisight.mtlship.com</span>
    </div>
  </div>
</section>

<main class="flow">
${transformed.html}
</main>

<section class="backcover">
  <div class="bc-brand">${LOGO_SVG}</div>
  <div class="bc-rule"></div>
  <div class="bc-statement">Global Logistics &amp; Market Intelligence<br>해운·항공·철도 운임과 공급망 동향 종합 분석</div>
  <div class="bc-disclaimer">본 리포트는 공개 출처 기반 분석이며, 수치는 Logisight 지표 대시보드를 참조 바람. 무단 전재·재배포 금지.</div>
  <div class="bc-contact">logisight.mtlship.com</div>
  <div class="bc-copy">© ${Number(YY)} Logisight / MTL Shipping Agency. All rights reserved.</div>
</section>

${chartScript}
</body></html>`;
}

async function main() {
  console.log(`⏳ ${MONTH} 월간 리포트 PDF 생성 중...`);
  let md = loadMarkdown();

  // md 선두 blockquote의 발행일을 표지에 반영 (없으면 오늘 날짜)
  const pubMatch = md.match(/발행일[^\d]{0,8}(\d{4}-\d{2}-\d{2})/);
  if (pubMatch) PUB = pubMatch[1];

  const front = parseFrontMatterials(md);   // 프런트 페이지 재료 (KPI·헤드라인·체크포인트)
  md = stripCitations(md);
  // `---` 앞뒤에 빈 줄 보장 — 단락 바로 뒤의 `---`가 Setext H2로 파싱되는 것을 방지
  md = md.replace(/([^\n])\n(---+)(\n)/g, "$1\n\n$2\n\n");
  let bodyHtml = marked.parse(md);
  bodyHtml = markLeadLabels(bodyHtml);

  // 차트 토큰 치환: [[CHART:id]] → 차트 카드
  const ids = [];
  const tokenRe =
    /<p>\s*\[\[CHART:([a-z0-9_]+)\]\]\s*<\/p>|\[\[CHART:([a-z0-9_]+)\]\]/g;
  bodyHtml = bodyHtml.replace(tokenRe, (_m, a, b) => {
    const id = a || b;
    ids.push(id);
    return `<figure class="chart-box"><canvas id="chart_${id}"></canvas></figure>`;
  });

  // [[TAKEAWAY: 문장]] → 블록 하단 전망 밴드 (명시 토큰 — 8월호부터 생성 규격)
  bodyHtml = bodyHtml.replace(
    /<p>\s*\[\[TAKEAWAY:([\s\S]*?)\]\]\s*<\/p>|\[\[TAKEAWAY:([\s\S]*?)\]\]/g,
    (_m, a, b) => '<div class="takeaway"><p>' + String(a || b || '').trim() + '</p></div>',
  );

  // [[STATS: 값|라벨|up/down ; ... :: 캡션]] → 숫자 콜아웃 스트립
  bodyHtml = bodyHtml.replace(
    /<p>\s*\[\[STATS:([\s\S]*?)\]\]\s*<\/p>|\[\[STATS:([\s\S]*?)\]\]/g,
    function (_m, a, b) {
      var inner = a || b || "",
        cap = "",
        body = inner;
      var ci = inner.indexOf("::");
      if (ci >= 0) {
        cap = inner.slice(ci + 2).trim();
        body = inner.slice(0, ci);
      }
      if (!body.includes("|")) {
        var highlight = escapeHtml(body.trim());
        var highlightCap = cap ? '<div class="stat-cap">' + escapeHtml(cap) + "</div>" : "";
        return (
          '<div class="stat-wrap"><div class="stat-highlight"><div class="stat-highlight-text">' +
          highlight +
          "</div></div>" +
          highlightCap +
          "</div>"
        );
      }
      var cards = body
        .split(";")
        .map(function (x) {
          return x.trim();
        })
        .filter(Boolean)
        .map(function (x) {
          var parts = x.split("|").map(function (y) {
            return (y || "").trim();
          });
          var val = parts[0] || "",
            lab = parts[1] || "",
            dir = parts[2] || "";
          if (!looksLikeStatValue(val) && looksLikeStatValue(lab)) {
            var tmp = val;
            val = lab;
            lab = tmp;
          }
          var cls = dir === "up" ? " up" : dir === "down" ? " down" : "";
          return (
            '<div class="stat-card"><div class="stat-lab">' +
            escapeHtml(lab) +
            '</div><div class="stat-val' +
            cls +
            '">' +
            escapeHtml(val) +
            "</div></div>"
          );
        })
        .join("");
      var capHtml = cap ? '<div class="stat-cap">' + escapeHtml(cap) + "</div>" : "";
      return (
        '<div class="stat-wrap"><div class="stat-strip">' +
        cards +
        "</div>" +
        capHtml +
        "</div>"
      );
    },
  );

  const chartConfigs = [];
  const noDataIds = [];
  for (const id of [...new Set(ids)]) {
    const c = await buildChart(id);
    if (c) {
      chartConfigs.push(c);
      console.log(`  ✓ 차트 ${id}: ${c.data.datasets.length}계열`);
    } else {
      noDataIds.push(id);
      console.warn(`  ⚠️ 차트 ${id} 데이터 없음 — 안내 표시`);
    }
  }

  // B10: 데이터 없는 차트 캔버스 → 박스 자체를 제거 (운영 문구 노출 금지 — 스타일 가이드 §0-⑥)
  for (const id of noDataIds) {
    bodyHtml = bodyHtml.replace(
      `<figure class="chart-box"><canvas id="chart_${id}"></canvas></figure>`,
      "",
    );
  }

  // [[OGIMG: url]] → base64 <img> (fallback: 토큰 제거)
  const ogRe =
    /<p>\s*\[\[OGIMG:\s*([^\]]+?)\]\]\s*<\/p>|\[\[OGIMG:\s*([^\]]+?)\]\]/g;
  const ogJobs = [];
  let ogMatch;
  ogRe.lastIndex = 0;
  while ((ogMatch = ogRe.exec(bodyHtml)) !== null) {
    // marked가 URL을 <a href="...">...</a>로 자동 변환할 수 있으므로 태그 제거
    const url = (ogMatch[1] || ogMatch[2] || "")
      .trim()
      .replace(/<[^>]+>/g, "")
      .trim();
    if (url) ogJobs.push({ full: ogMatch[0], url });
  }
  const seenOgImages = new Set();   // 동일 이미지(같은 og:image 해석 결과) 리포트 내 1회만 — 중복 로고류 방지
  for (const job of ogJobs) {
    const dataUri = await fetchOgImage(job.url);
    const isDup = dataUri && seenOgImages.has(dataUri);
    if (dataUri && !isDup) seenOgImages.add(dataUri);
    bodyHtml = bodyHtml.replace(
      job.full,
      dataUri && !isDup ? `<img src="${dataUri}" alt="" loading="eager">` : "",
    );
    console.log(
      `  · OGIMG ${job.url.slice(0, 60)}… — ${!dataUri ? "없음(제거)" : isDup ? "중복(제거)" : "OK"}`,
    );
  }

  // [[NEWS: url :: headline :: summary :: source]] → news card
  const newsRe = /<p>\s*\[\[NEWS:\s*([\s\S]*?)\]\]\s*<\/p>|\[\[NEWS:\s*([\s\S]*?)\]\]/g;
  bodyHtml = bodyHtml.replace(newsRe, (_m, a, b) => {
    const inner = (a || b || '').replace(/<[^>]+>/g, '').trim();
    const parts = inner.split('::').map(s => s.trim());
    const [url, headline, summary, srcDate] = parts;
    if (!url || !headline) return '';
    return (
      '<div class="news-card">' +
      '<div class="news-headline">' + escapeHtml(headline) + '</div>' +
      (summary ? '<p class="news-summary">' + escapeHtml(summary) + '</p>' : '') +
      '<div class="news-meta">' + escapeHtml(srcDate || '') + '</div>' +
      '</div>'
    );
  });

  // 헤딩 분류(디바이더/서브섹션) + 목차 수집, 표 등락 색상
  const transformed = transformBody(bodyHtml);
  transformed.html = colorDeltas(transformed.html);
  // 블록 마지막 문단이 전망형 명사 종결(짧은 단락)이면 TAKEAWAY 밴드로 자동 승격
  transformed.html = transformed.html.replace(
    /<p>((?:(?!<\/p>|<div class="takeaway")[\s\S]){30,320}?(?:전망|국면|가능성|공산|주목|판정 포인트)\.?)<\/p>\s*(?=<h2|<section|<hr|$)/g,
    '<div class="takeaway"><p>$1</p></div>',
  );

  transformed.html = wrapFitTopics(transformed.html, new Set(["03-2"]));
  transformed.html = wrapOceanTopics(
    transformed.html,
    new Set(["02-5", "02-6", "02-7", "02-8"]),
  );
  transformed.html = wrapPairedTopics(transformed.html);

  // ── 02 해운: 네이비 디바이더 페이지 → 4차트 대시보드 오프너로 교체 ──
  const DASH = [
    { id: 'ocean_kcci', title: 'KCCI 종합 (p)', kpi: 'KCCI 종합' },
    { id: 'ocean_scfi', title: 'SCFI 종합 (p)', kpi: 'SCFI 종합' },
    { id: 'ocean_ccfi', title: 'CCFI 종합 (p)', kpi: 'CCFI 종합' },
    { id: 'ocean_wci',  title: 'WCI 종합 (USD/FEU)', kpi: 'WCI 종합' },
    { id: 'ocean_bunker', title: '벙커유 (USD/톤)', kpi: null },
    { id: 'ocean_intra_asia', title: '역내 항로 (KCCI)', kpi: null },
  ];
  const dashFigs = [];
  for (const d of DASH) {
    const src = chartConfigs.find((c) => c.id === d.id);
    if (!src) continue;
    const ds = (src.data.datasets || []).filter((x) => String(x.label || '').includes('종합'));
    chartConfigs.push({
      id: 'dash_' + d.id,
      data: { labels: src.data.labels, datasets: (ds.length ? ds : src.data.datasets).map((x) => Object.assign({}, x)) },
    });
    const k = (front.kpis || []).find((x) => x.label === d.kpi);
    const badge = k ? '<small>' + escapeHtml(k.mom) + ' MoM</small>' : '';
    dashFigs.push(
      '<div class="dash-fig"><div class="dash-band"><span>' + d.title + '</span>' + badge + '</div>' +
      '<div class="dash-plot"><canvas id="chart_dash_' + d.id + '"></canvas></div></div>',
    );
  }
  if (dashFigs.length >= 4) {
    const openTag = '<section class="divider"><div class="dv-tag">SECTION 02</div>';
    const di = transformed.html.indexOf(openTag);
    if (di !== -1) {
      const de = transformed.html.indexOf('</section>', di) + '</section>'.length;
      const dashHtml =
        '<section class="dash-page"><div class="sec-band">' +
        '<span class="st"><span class="no">02</span>해운 시황</span>' +
        '<span class="sp">Container Freight · 데이터 기준 직전월 최종 공표 주차</span></div>' +
        '<div class="dash-grid">' + dashFigs.join('') + '</div>' +
        '<div class="dash-src">출처: KOBC·SSE·CCFC·Drewry © Logisight — 상세 항로별 분석은 02-1~02-9 참조</div>' +
        '</section>';
      transformed.html = transformed.html.slice(0, di) + dashHtml + transformed.html.slice(de);
    }
  }

  // Executive Summary + KCCI 히트맵 페이지 — 본문 최앞(01 디바이더 앞)에 삽입
  try {
    const weekEnd = monthEndISO(prevMonthOf(MONTH));
    const execHtml = await buildExecPage(front, weekEnd);
    if (execHtml) {
      transformed.html = execHtml + transformed.html;
      console.log('  ✓ Executive Summary + KCCI 히트맵 페이지 생성');
    }
  } catch (e) {
    console.warn('  ⚠️ Exec Summary 생성 실패(생략):', e.message);
  }

  const html = buildHtml(transformed, chartConfigs, front);
  if (process.env.HTML_DUMP) fs.writeFileSync(process.env.HTML_DUMP, html);

  const browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    console.log(
      "⏳ 페이지 로드 중 (Pretendard·GyeonggiTitle CDN, Chart.js)...",
    );
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    if (chartConfigs.length) {
      await page.evaluate(
        () =>
          new Promise((res) => {
            let n = 0;
            const t = setInterval(() => {
              if (window.__chartsReady || n++ > 25) {
                clearInterval(t);
                res();
              }
            }, 100);
          }),
      );
      await new Promise((r) => setTimeout(r, 450)); // 캔버스 페인트 여유
    }

    const headingLayout = await page.evaluate(async () => {
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const details = [];
      for (const heading of document.querySelectorAll("h2.sub")) {
        const subNo = heading.querySelector(".sub-no")?.textContent?.trim() || "";
        let size = parseFloat(getComputedStyle(heading).fontSize);
        let changed = false;
        while (heading.scrollWidth > heading.clientWidth + 1 && size > 15) {
          size -= 0.75;
          heading.style.fontSize = size + "px";
          heading.style.letterSpacing = "-0.045em";
          changed = true;
          await nextFrame();
        }
        if (heading.scrollWidth > heading.clientWidth + 1) {
          const scale = Math.max(0.78, heading.clientWidth / heading.scrollWidth);
          heading.style.transform = `scaleX(${scale})`;
          heading.style.transformOrigin = "left top";
          heading.style.width = `${100 / scale}%`;
          changed = true;
          await nextFrame();
        }
        if (changed) {
          details.push({
            id: subNo,
            size: Math.round(size),
            overflow: heading.scrollWidth > heading.clientWidth + 2,
          });
        }
      }
      return details;
    });
    for (const heading of headingLayout) {
      console.log(`  · 제목 ${heading.id || "sub"}: 한 줄 압축 (${heading.size}px)`);
    }
    const headingOverflow = headingLayout.filter((heading) => heading.overflow);
    if (headingOverflow.length) {
      throw new Error(
        "하위 페이지 제목 한 줄 제한 초과: " +
          headingOverflow.map((heading) => heading.id || "sub").join(", "),
      );
    }

    const pairedLayout = await page.evaluate(async () => {
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const details = [];
      for (const pair of document.querySelectorAll(".paired-page")) {
        const overflows = () =>
          pair.scrollHeight > pair.clientHeight + 2 ||
          pair.scrollWidth > pair.clientWidth + 2 ||
          [...pair.querySelectorAll(".pair-item")].some(
            (item) =>
              item.scrollHeight > item.clientHeight + 2 ||
              item.scrollWidth > item.clientWidth + 2,
          );
        for (const level of ["tight"]) {
          if (!overflows()) break;
          pair.classList.add(level);
          await nextFrame();
        }
        details.push({
          id: pair.dataset.pair,
          mode:
            ["ultra", "tight"].find((x) => pair.classList.contains(x)) ||
            "normal",
          overflow: overflows(),
          content: pair.scrollHeight,
          page: pair.clientHeight,
          itemOverflow: [...pair.querySelectorAll(".pair-item")]
            .filter(
              (item) =>
                item.scrollHeight > item.clientHeight + 2 ||
                item.scrollWidth > item.clientWidth + 2,
            )
            .map((item) => item.dataset.topic),
        });
      }
      return details;
    });
    for (const pair of pairedLayout) {
      console.log(`  · 병합 페이지 ${pair.id}: ${pair.mode} 레이아웃`);
    }
    const pairOverflowing = pairedLayout.filter((pair) => pair.overflow);
    if (pairOverflowing.length) {
      throw new Error(
        "병합 페이지 1페이지 제한 초과: " +
          pairOverflowing
            .map(
              (pair) =>
                `${pair.id}(${pair.content}px>${pair.page}px; ${pair.itemOverflow.join(",")})`,
            )
            .join(", ") +
          " — 병합 대상 문단을 줄이거나 병합 제외가 필요합니다.",
      );
    }

    const fitLayout = await page.evaluate(async () => {
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const details = [];
      for (const topic of document.querySelectorAll(".fit-topic")) {
        const overflows = () => topic.scrollHeight > topic.clientHeight + 2;
        for (const level of ["compact", "tight"]) {
          if (!overflows()) break;
          topic.classList.add(level);
          await nextFrame();
        }
        details.push({
          id: topic.dataset.topic,
          rows: Number(topic.dataset.tableRows || 0),
          mode:
            ["ultra", "tight", "compact"].find((x) =>
              topic.classList.contains(x),
            ) || "normal",
          overflow: overflows(),
          content: topic.scrollHeight,
          page: topic.clientHeight,
        });
      }
      return details;
    });
    for (const topic of fitLayout) {
      console.log(
        `  · 고정 페이지 ${topic.id}: ${topic.mode} 레이아웃 (${topic.rows}행)`,
      );
    }
    const fitOverflowing = fitLayout.filter((topic) => topic.overflow);
    if (fitOverflowing.length) {
      throw new Error(
        "고정 페이지 1페이지 제한 초과: " +
          fitOverflowing
            .map((topic) => `${topic.id}(${topic.content}px>${topic.page}px)`)
            .join(", ") +
          " — 표 행 또는 분석 문단을 줄이세요.",
      );
    }

    const oceanLayout = await page.evaluate(async () => {
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const details = [];
      for (const topic of document.querySelectorAll(".ocean-topic")) {
        const overflows = () => topic.scrollHeight > topic.clientHeight + 2;
        for (const level of ["compact", "tight"]) {
          if (!overflows()) break;
          topic.classList.add(level);
          await nextFrame();
        }
        details.push({
          id: topic.dataset.topic,
          rows: Number(topic.dataset.tableRows || 0),
          mode:
            ["ultra", "tight", "compact"].find((x) =>
              topic.classList.contains(x),
            ) || "normal",
          overflow: overflows(),
          content: topic.scrollHeight,
          page: topic.clientHeight,
        });
      }
      return details;
    });
    for (const topic of oceanLayout) {
      console.log(
        `  · 해운 ${topic.id}: ${topic.mode} 레이아웃 (${topic.rows}행)`,
      );
    }
    const overflowing = oceanLayout.filter((topic) => topic.overflow);
    if (overflowing.length) {
      throw new Error(
        "해운 1페이지 제한 초과: " +
          overflowing
            .map((topic) => `${topic.id}(${topic.content}px>${topic.page}px)`)
            .join(", ") +
          " — 분석 문단을 줄이세요.",
      );
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    // ── CSS @page가 마진 담당(bleed named page 포함) — weekly-report-pdf.js와 동일 옵션 ──
    const pdfOpts = {
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      // 스파인 3구간: 콘텐츠 박스는 .spine-band(fixed), 상하 마진은 템플릿 블록.
      // 헤더 콘텐츠는 Chromium이 ~6mm 아래로 밀어 그림 → top:-6.5mm로 상쇄(박스에 클리핑됨)
      headerTemplate:
        '<div style="width:100%;height:16mm;position:relative;-webkit-print-color-adjust:exact;">' +
        '<div style="position:absolute;left:0;top:-6.5mm;width:6mm;height:24mm;background:#0E3A66;"></div></div>',
      footerTemplate:
        '<div style="position:relative;width:100%;height:14mm;-webkit-print-color-adjust:exact;font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="position:absolute;left:0;top:-2mm;width:6mm;height:20mm;background:#0E3A66;"></div>' +
        '<div style="position:absolute;left:24mm;right:18mm;top:5.5mm;border-top:1.2px solid #0E3A66;' +
        'padding-top:1.8mm;font-size:7.5px;color:#6B7178;display:flex;justify-content:space-between;">' +
        `<span>© ${Number(YY)} Logisight Maritime Intelligence</span>` +
        `<span>monthly-analysis-${MONTH} · <span class="pageNumber"></span></span>` +
        '</div></div>',
    };
    // Chromium은 footerTemplate를 bleed(마진 0) 페이지에도 콘텐츠 위에 겹쳐 그린다.
    // 표지(1)·뒷표지(마지막)는 위치가 항상 고정이므로 footer 없는 렌더의 페이지로 교체.
    const withFooter = await page.pdf(pdfOpts);
    const noFooter = await page.pdf({ ...pdfOpts, displayHeaderFooter: false });
    const { PDFDocument } = require("pdf-lib");
    const dstDoc = await PDFDocument.load(withFooter);
    const cleanDoc = await PDFDocument.load(noFooter);
    const total = dstDoc.getPageCount();
    if (cleanDoc.getPageCount() !== total) {
      throw new Error(`footer 유무 렌더 페이지 수 불일치: ${total} vs ${cleanDoc.getPageCount()}`);
    }
    const [cover, back] = await dstDoc.copyPages(cleanDoc, [0, total - 1]);
    dstDoc.removePage(0);
    dstDoc.insertPage(0, cover);
    dstDoc.removePage(total - 1);
    dstDoc.insertPage(total - 1, back);
    fs.writeFileSync(OUT_PATH, await dstDoc.save());
    console.log(`✅ PDF 완료: ${OUT_PATH} (${total}p, 표지·뒷표지 footer 제거)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("❌ monthly-report-pdf.js 실패:", err.message);
  process.exit(1);
});
