"use strict";
// generators/report/monthly-report-pdf.js
// 월간 리포트 마크다운 → PDF
// ── 디자인: design.md(증권사 리서치 계열 — 블루 #0070C0 + 틸 #008C8C + 무채색,
//    Pretendard/경기천년제목, 회색 헤더밴드 + 점선 표) 적용본 ──
// ── 파이프라인·페이지 구성(표지/목차/섹션디바이더/서브섹션/해운1p)·해운 압축 로직은 원본 유지 ──
// 사용법: node generators/report/monthly-report-pdf.js [--month=2026-05]

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const puppeteer = require("puppeteer-core");
const { buildChart } = require("./lib/chart-data");
const { fetchOgImage } = require("./lib/og-image");

const TODAY = new Date().toISOString().slice(0, 10);
const monthArg = process.argv.find((a) => a.startsWith("--month="));
const MONTH = monthArg ? monthArg.split("=")[1] : TODAY.slice(0, 7);
const [YY, MM] = MONTH.split("-");
const VOL = MM; // 5월 → "05"
let PUB = TODAY; // 발행일(아래 main에서 md의 발행일로 보정)

const MD_PATH = path.resolve(
  __dirname,
  `../../content/drafts/monthly-analysis-${MONTH}.md`,
);
const OUT_DIR = path.resolve(__dirname, "../../content/published");
const OUT_PATH = path.join(OUT_DIR, `monthly-analysis-${MONTH}.pdf`);

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
      const cls = leadNext ? "sub lead" : "sub";
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

// 02-1~02-9 해운 주제는 각각 독립된 A4 본문 페이지로 고정한다.
// 표 행 수가 많은 블록은 초기 compact 레이아웃을 적용하고, 렌더 후 실제 높이로 추가 압축한다.
function wrapOceanTopics(html) {
  const headingRe =
    /<h2 class="sub(?: lead)?"><span class="sub-no">(02-[1-9])<\/span>[\s\S]*?<\/h2>/g;
  const topics = [...html.matchAll(headingRe)];
  if (!topics.length) return html;

  let result = "";
  let cursor = 0;
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const start = topic.index;
    const nextTopicStart = topics[i + 1]?.index ?? html.length;
    const boundaries = [
      nextTopicStart,
      html.indexOf('<section class="divider">', start),
      html.indexOf("<hr>", start),
    ].filter((x) => x >= 0);
    const end = Math.min(...boundaries);
    const topicId = topic[1];
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

function buildHtml(transformed, chartConfigs = []) {
  // 차트 라인 팔레트 = design.md §5-4 (primary → slate → gray → … → teal/red)
  const chartScript = chartConfigs.length
    ? `
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
const PALETTE = ['#0070C0','#5484CC','#7E7E7E','#9DAEAC','#008C8C','#C0392B'];
const CFG = ${JSON.stringify(chartConfigs)};
CFG.forEach(c => {
  const el = document.getElementById('chart_' + c.id);
  if (!el) return;
  (c.data.datasets || []).forEach((d, i) => {            // 색이 지정되지 않은 계열만 팔레트 적용
    if (!d.borderColor) d.borderColor = PALETTE[i % PALETTE.length];
    if (d.backgroundColor == null) d.backgroundColor = 'transparent';
    if (d.borderWidth == null) d.borderWidth = 1.6;
    if (d.pointRadius == null) d.pointRadius = 0;
    if (d.tension == null) d.tension = 0.25;
  });
  new Chart(el, { type:'line', data:c.data, options:{
    responsive:true, maintainAspectRatio:false, animation:false,
    plugins:{ title:{display:false},
      legend:{position:'bottom',labels:{font:{size:9},boxWidth:14,color:'#555555'}} },
    scales:{
      x:{ticks:{font:{size:7},maxRotation:45,autoSkip:true,maxTicksLimit:10,color:'#888888'},grid:{display:false}},
      y:{ticks:{font:{size:7},color:'#888888'},grid:{color:'#E6E6E6'}}
    }
  }});
});
window.__chartsReady = true;
</script>`
    : "";

  // t.title은 marked 출력에서 추출 → 이미 HTML-encoded. escapeHtml() 재호출 금지(이중 인코딩).
  const tocRows = transformed.toc
    .map(
      (t) =>
        `<li><span class="toc-no">${t.num}</span><span class="toc-tt">${t.title}</span></li>`,
    )
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
  --c-primary:#0070C0; --c-primary-deep:#005599;
  --c-teal:#008C8C; --c-teal-cyan:#0090A8; --c-charcoal:#4D4D4D;
  --c-ink:#1A1A1A; --c-body:#333333; --c-body-soft:#555555; --c-caption:#888888;
  --c-rule:#D9D9D9; --c-rule-strong:#BFBFBF;
  --c-thead:#7E7E7E; --c-thead-2:#A6A6A6; --c-zebra:#F2F2F2;
  --c-box-fill:#EDEDED; --c-band-gray:#E6E6E6;
  --c-up:#C00000; --c-down:#0070C0;
  --font-title:'GyeonggiTitle','Pretendard','Noto Sans KR',sans-serif;
  --font-sans:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;
  --font-serif:'Noto Serif KR',serif;  /* 인용·각주 한정(거의 미사용) */
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── PAGE GEOMETRY ──────────────────────────────────────────────
   본문 18/18/16mm(design.md §4-1), 풀블리드 페이지는 margin:0.
   풀블리드 박스 높이는 296mm (페이지=297mm) — 정확히 297mm로 두면 Chrome이
   1px 단편을 다음 페이지로 흘려 '띠 + 빈 페이지'가 생기므로 296mm로 고정.
   ── 이 두 줄 + 296mm 가 빈 페이지/제목 누락의 핵심 수정점 ── */
@page{size:A4;margin:18mm 18mm 16mm}
@page bleed{size:A4;margin:0}
.cover,.divider,.toc,.backcover{page:bleed}

body{font-family:var(--font-sans);color:var(--c-body);font-size:10pt;line-height:1.6;
  background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* ── COVER (design.md §4-2① : 차콜 그라운드 + 블루 강조 + 우하단 대각 컷) ── */
.cover{width:210mm;height:296mm;position:relative;overflow:hidden;break-after:page;
  background:linear-gradient(160deg,#4D4D4D 0%,#414141 58%,#363636 100%);
  color:#fff;padding:24mm 22mm;display:flex;flex-direction:column;justify-content:space-between}
.cv-diagonal{position:absolute;right:0;bottom:0;width:118mm;height:82mm;z-index:0;
  background:linear-gradient(135deg,var(--c-primary) 0%,var(--c-primary-deep) 100%);
  clip-path:polygon(100% 0,100% 100%,0 100%)}
.cv-top,.cv-mid,.cv-foot{position:relative;z-index:1}
.cv-top{display:flex;align-items:center;gap:5mm}
.cv-mark{width:11mm;height:11mm;flex:0 0 auto}
.cv-brand{font-family:var(--font-title);font-weight:800;font-size:15pt;letter-spacing:2px}
.cv-brand small{display:block;font-family:var(--font-sans);font-weight:500;font-size:7pt;
  letter-spacing:4px;color:#7FC0F0;margin-top:1mm}
.cv-mid{margin-top:auto}
.cv-kicker{font-size:9pt;letter-spacing:5px;color:#5EB0EE;font-weight:600;margin-bottom:7mm}
.cv-title{font-family:var(--font-title);font-weight:800;font-size:40pt;line-height:1.12;
  letter-spacing:-.02em;margin-bottom:7mm}
.cv-rule{width:26mm;height:3px;background:var(--c-primary);margin:0 0 8mm}
.cv-issue{font-family:var(--font-title);font-size:13pt;color:#34C7C7;font-weight:800;margin-bottom:7mm}
.cv-sub{font-size:11pt;color:rgba(255,255,255,.78);font-weight:400;max-width:150mm;line-height:1.65}
.cv-foot{display:flex;justify-content:space-between;align-items:flex-end;
  border-top:1px solid rgba(255,255,255,.18);padding-top:6mm;font-size:8.5pt;color:rgba(255,255,255,.62)}
.cv-foot strong{color:#fff;font-weight:600}
.cv-vol{font-family:var(--font-title);font-size:13pt;color:#fff;font-weight:800}

/* ── TABLE OF CONTENTS (페이퍼 화이트 + 블루 강조) ── */
.toc{width:210mm;height:296mm;background:#fff;padding:26mm 24mm;overflow:hidden;break-after:page}
.toc-h{font-family:var(--font-title);font-size:9pt;letter-spacing:6px;color:var(--c-primary);font-weight:700;margin-bottom:3mm}
.toc-h2{font-family:var(--font-title);font-size:24pt;color:var(--c-ink);font-weight:800;letter-spacing:-.01em;
  border-bottom:2.5px solid var(--c-primary);padding-bottom:5mm;margin-bottom:9mm}
.toc ol{list-style:none}
.toc li{display:flex;align-items:baseline;gap:6mm;padding:4mm 0;border-bottom:1px solid var(--c-rule)}
.toc-no{font-family:var(--font-title);font-size:14pt;font-weight:800;color:var(--c-primary);min-width:14mm}
.toc-tt{font-size:11.5pt;color:var(--c-ink);font-weight:500}

/* ── SECTION DIVIDER (풀블리드, 블루 — 섹션을 브랜드 컬러로 구분) ── */
.divider{width:210mm;height:296mm;overflow:hidden;color:#fff;
  background:linear-gradient(135deg,var(--c-primary) 0%,var(--c-primary-deep) 100%);
  padding:30mm 24mm;display:flex;flex-direction:column;justify-content:center}
.dv-tag{font-size:9pt;letter-spacing:6px;color:rgba(255,255,255,.85);font-weight:600;margin-bottom:4mm}
.dv-num{font-family:var(--font-title);font-size:120pt;font-weight:800;line-height:.86;color:rgba(255,255,255,.16)}
.dv-rule{width:30mm;height:3px;background:#fff;margin:7mm 0}
.dv-title{font-family:var(--font-title);font-size:28pt;font-weight:800;color:#fff;
  letter-spacing:-.01em;border:none;padding:0;margin:0}

/* ── FLOW CONTENT ── */
.flow{padding-top:1mm}
.flow>:first-child{margin-top:0}
hr{display:none}

/* 서브섹션 제목 = 자기 페이지에서 시작(블루 밑줄). 디바이더 직후 첫 제목만 lead */
h2.sub{font-family:var(--font-title);font-size:19pt;font-weight:800;color:var(--c-ink);
  letter-spacing:-.01em;margin:0 0 6mm;padding-bottom:2.5mm;border-bottom:2.5px solid var(--c-primary);
  break-before:page;break-after:avoid}
h2.sub.lead{break-before:auto}
h2.sub .sub-no{font-family:var(--font-title);color:var(--c-primary);font-weight:800;margin-right:3mm}
h3{font-family:var(--font-title);font-size:12pt;font-weight:700;color:var(--c-teal);margin:6mm 0 2.5mm;break-after:avoid}

/* 해운 02-1~02-9: 각 주제를 정확히 본문 1페이지에 고정 */
.ocean-topic{height:262mm;overflow:hidden;break-before:page;break-after:page}
.ocean-topic h2.sub{break-before:auto}
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

p{font-size:10pt;line-height:1.6;color:var(--c-body);margin:0 0 3.4mm}
strong{color:var(--c-ink);font-weight:700}

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
blockquote{background:#F2F6FB;border-left:3px solid var(--c-primary);border-radius:0 4px 4px 0;
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
.chart-box{height:64mm;background:#FAFAFA;border:1px solid var(--c-band-gray);border-radius:6px;
  padding:4mm 4mm 3mm;margin:4mm 0 5mm;break-inside:avoid}
.chart-box canvas{max-width:100%}

/* 기사 이미지 */
.flow img{display:block;width:100%;height:auto;max-height:95mm;object-fit:cover;
  border-radius:6px;margin:4mm 0 5mm;break-inside:avoid}
.flow p em{color:var(--c-caption);font-style:italic;font-size:8.5pt}
.flow p:last-child em{color:#9aa3af}

/* 카테고리 배지 (해운 기사 섹션) — 틸 보조강조 */
p.article-cat{font-family:var(--font-sans);font-size:7.5pt;letter-spacing:4px;
  color:var(--c-teal);font-weight:700;text-transform:uppercase;margin:0 0 2mm}

/* 차트 no-data 안내 */
.chart-box.no-data{display:flex;align-items:center;justify-content:center;background:#F5F5F5}
.no-data-msg{color:#9aa3af;font-style:italic;font-size:9pt}

/* 뒷표지 */
.backcover{width:210mm;height:296mm;position:relative;overflow:hidden;break-before:page;
  background:linear-gradient(160deg,#4D4D4D 0%,#363636 100%);
  color:#fff;padding:32mm 24mm;display:flex;flex-direction:column;justify-content:flex-end;gap:0}
.bc-brand{font-family:var(--font-title);font-size:22pt;font-weight:800;letter-spacing:3px;color:#fff;margin-bottom:6mm}
.bc-rule{width:24mm;height:3px;background:var(--c-primary);margin-bottom:8mm}
.bc-statement{font-size:11pt;color:rgba(255,255,255,.8);line-height:1.7;margin-bottom:auto;padding-bottom:20mm}
.bc-disclaimer{font-size:8pt;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:4mm}
.bc-contact{font-size:8.5pt;color:rgba(255,255,255,.65);margin-bottom:2mm}
.bc-copy{font-size:7.5pt;color:rgba(255,255,255,.4)}

/* KPI 카드 = 라벨 상단형 (label-top tile) */
.stat-wrap{margin:5mm 0 5mm;break-inside:avoid}
.stat-strip{display:flex;gap:4mm}
.stat-card{flex:1;background:#fff;border:1px solid var(--c-band-gray);
  border-left:3px solid var(--c-primary);border-radius:0;padding:4mm 4.5mm 4mm;
  display:flex;flex-direction:column;justify-content:space-between}
.stat-lab{font-size:8.4pt;color:var(--c-body-soft);font-weight:600;line-height:1.35;min-height:21pt;margin-bottom:3mm}
.stat-val{font-family:var(--font-title);font-size:21pt;font-weight:800;color:var(--c-ink);line-height:1}
.stat-val.up{color:var(--c-up)}.stat-val.down{color:var(--c-down)}
.stat-cap{font-size:7.5pt;color:var(--c-caption);margin-top:2.5mm;text-align:left}

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

<section class="cover">
  <div class="cv-diagonal"></div>
  <div class="cv-top">
    <svg class="cv-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" stroke="rgba(255,255,255,.55)" stroke-width="1.4"/>
      <path d="M20 5 L23 18 L35 20 L23 22 L20 35 L17 22 L5 20 L17 18 Z" fill="#0070C0"/>
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

<section class="backcover">
  <div class="bc-brand">LOGISIGHT</div>
  <div class="bc-rule"></div>
  <div class="bc-statement">Global Logistics &amp; Market Intelligence<br>해운·항공·철도 운임과 공급망 동향 종합 분석</div>
  <div class="bc-disclaimer">본 리포트는 공개 출처 기반 분석이며, 수치는 Logisight 지표 대시보드를 참조 바람. 무단 전재·재배포 금지.</div>
  <div class="bc-contact">contact@logisight.com · www.logisight.com</div>
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

  md = stripCitations(md);
  // `---` 앞뒤에 빈 줄 보장 — 단락 바로 뒤의 `---`가 Setext H2로 파싱되는 것을 방지
  md = md.replace(/([^\n])\n(---+)(\n)/g, "$1\n\n$2\n\n");
  let bodyHtml = marked.parse(md);

  // 차트 토큰 치환: [[CHART:id]] → 차트 카드
  const ids = [];
  const tokenRe =
    /<p>\s*\[\[CHART:([a-z0-9_]+)\]\]\s*<\/p>|\[\[CHART:([a-z0-9_]+)\]\]/g;
  bodyHtml = bodyHtml.replace(tokenRe, (_m, a, b) => {
    const id = a || b;
    ids.push(id);
    return `<figure class="chart-box"><canvas id="chart_${id}"></canvas></figure>`;
  });

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
          var cls = dir === "up" ? " up" : dir === "down" ? " down" : "";
          return (
            '<div class="stat-card"><div class="stat-lab">' +
            lab +
            '</div><div class="stat-val' +
            cls +
            '">' +
            val +
            "</div></div>"
          );
        })
        .join("");
      var capHtml = cap ? '<div class="stat-cap">' + cap + "</div>" : "";
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

  // B10: 데이터 없는 차트 캔버스 → 안내 박스로 교체
  for (const id of noDataIds) {
    bodyHtml = bodyHtml.replace(
      `<figure class="chart-box"><canvas id="chart_${id}"></canvas></figure>`,
      `<figure class="chart-box no-data"><span class="no-data-msg">데이터 미수집</span></figure>`,
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
  for (const job of ogJobs) {
    const dataUri = await fetchOgImage(job.url);
    bodyHtml = bodyHtml.replace(
      job.full,
      dataUri ? `<img src="${dataUri}" alt="" loading="eager">` : "",
    );
    console.log(
      `  · OGIMG ${job.url.slice(0, 60)}… — ${dataUri ? "OK" : "없음(제거)"}`,
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
  transformed.html = wrapOceanTopics(transformed.html);

  const html = buildHtml(transformed, chartConfigs);

  const browser = await puppeteer.launch({
    executablePath:
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

    const oceanLayout = await page.evaluate(async () => {
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const details = [];
      for (const topic of document.querySelectorAll(".ocean-topic")) {
        const overflows = () => topic.scrollHeight > topic.clientHeight + 2;
        for (const level of ["compact", "tight", "ultra"]) {
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
    // ── margin/format 제거, preferCSSPageSize:true 로 CSS @page(풀블리드 포함) 사용 ──
    await page.pdf({
      path: OUT_PATH,
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log(`✅ PDF 완료: ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("❌ monthly-report-pdf.js 실패:", err.message);
  process.exit(1);
});
