'use strict';
// generators/jp-report/assemble/magazine.js
// 월간 리포트 → 매거진 조판 HTML.
//
// 한국판(generators/report/monthly-report-pdf.js)과 같은 구성이다:
//   표지(풀블리드 + IN THIS ISSUE) → Executive Summary → 섹션 구분면 → 본문 → 뒤표지
// 디자인 언어는 lib/theme.js 로 공유하고, 여기서는 일본판의 내용만 조립한다.
//
// 순수 함수만 둔다(파일 I/O 없음). 렌더는 to-pdf.js가 한다.

const { css, LOGO_SVG } = require('./lib/theme');
const { outputOrder } = require('../write/sections');

const ENG_MONTH = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "2026-06" → { yy, mm, engMonth, vol } — 창간을 2026-01로 보고 호수를 센다. */
function issueOf(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`period 형식 오류: ${period}`);
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  return { yy, mm, engMonth: ENG_MONTH[mm - 1], vol: String(mm).padStart(2, '0') };
}

const fmtIndex = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
const fmtPct = (v) => (v == null || !Number.isFinite(v)
  ? '—' : (v < 0 ? `▲${Math.abs(v).toFixed(1)}%` : `+${v.toFixed(1)}%`));
const fmtTeu = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('ja-JP'));

/** 千円 → 兆・億円. 본문 표기와 맞춘다. */
function fmtJpy(thousandYen) {
  if (thousandYen == null || !Number.isFinite(thousandYen)) return '—';
  const yen = Math.abs(thousandYen) * 1000;
  const sign = thousandYen < 0 ? '▲' : '';
  if (yen >= 1e12) {
    const cho = Math.floor(yen / 1e12);
    const oku = Math.round((yen % 1e12) / 1e8);
    return `${sign}${cho}兆${oku > 0 ? `${oku.toLocaleString('ja-JP')}億` : ''}円`;
  }
  return `${sign}${Math.round(yen / 1e8).toLocaleString('ja-JP')}億円`;
}

/**
 * Executive Summary — 한 눈에 보는 이번 달.
 *
 * 세계 스팟 / 일본 가격 / 물량·무역 세 블록. 한국판의 RATES·CONTRACT 구성과 같은 자리다.
 * 축마다 기준일이 다르므로 각 블록에 기준을 함께 적는다 — 이게 없으면 같은 시점으로 읽힌다.
 */
function execBlocks(facts) {
  const g = facts.global || {};
  const ocean = (facts.sppi?.series || []).find((s) => s.name === '外航貨物輸送') || null;
  const air = (facts.sppi?.series || []).find((s) => s.name === '国際航空貨物輸送') || null;
  const scfi = (g.indices || []).find((i) => i.code === 'SCFI') || null;
  const port = facts.port?.total || null;
  const trade = facts.trade?.total || null;

  const blocks = [];

  if (scfi) {
    blocks.push({
      tag: 'GLOBAL',
      head: `SCFI ${fmtIndex(scfi.value)} · ${fmtPct(scfi.changePct)}`,
      items: [
        `世界のコンテナ指数は ${g.containerTotal ?? 0} 系列中 ${g.containerUp ?? 0} 系列が上昇`,
        `基準日 ${g.asOf ?? '—'}(週次)`,
      ],
    });
  }
  if (ocean) {
    blocks.push({
      tag: 'JAPAN',
      head: `外航貨物輸送 円ベース ${fmtIndex(ocean.yen)} · ${fmtPct(ocean.yoyYenPct)}`,
      items: [
        `契約通貨ベース ${fmtIndex(ocean.contract)}(${fmtPct(ocean.yoyContractPct)})— 差は為替要因`,
        air ? `国際航空 円ベース ${fmtIndex(air.yen)} / 契約通貨 ${fmtIndex(air.contract)}` : null,
        `基準月 ${facts.periods?.sppi ?? '—'}(月次)`,
      ].filter(Boolean),
    });
  }
  if (port || trade) {
    blocks.push({
      tag: 'VOLUME',
      head: port ? `主要6港 ${fmtTeu(port.teu)} TEU · ${fmtPct(port.yoyPct)}` : '—',
      items: [
        trade ? `輸出 ${fmtJpy(trade.exportJpy)}(${fmtPct(trade.yoyExportPct)})· 収支 ${fmtJpy(trade.balanceJpy)}` : null,
        `港湾 ${facts.periods?.port ?? '—'}${facts.port?.isPreliminary ? '(速報値)' : ''} / 貿易 ${facts.periods?.trade ?? '—'}`,
      ].filter(Boolean),
    });
  }
  return blocks;
}

function execHtml(facts) {
  const rows = execBlocks(facts).map((b) => `
    <div class="ex-row">
      <div class="ex-tag">${esc(b.tag)}</div>
      <div class="ex-body">
        <div class="ex-head">${esc(b.head)}</div>
        <ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </div>
    </div>`).join('');

  const mismatch = facts.periodMismatch
    ? '<p class="ex-note">※ 軸ごとに公表タイミングが異なる。異なる月の数値を同一時点として比較しない。</p>'
    : '';

  return `<section class="execpage">
  <div class="ex-h">
    <h2>Executive Summary</h2>
    <span>ひと目でわかる今月の市況</span>
  </div>
  ${rows}
  ${mismatch}
</section>`;
}

/**
 * 섹션 구분면. 클래스는 theme.js가 이미 갖고 있는 것을 그대로 쓴다 —
 * 자체 정의로 덮으면 page:bleed를 잃어 페이지 아래가 흰 띠로 남는다(실제로 그랬다).
 */
function dividerHtml(section) {
  return `<section class="divider">
  <div class="dv-tag">SECTION</div>
  <div class="dv-num">${esc(section.no)}</div>
  <div class="dv-rule"></div>
  <div class="dv-title">${esc(section.title)}</div>
</section>`;
}

/** 표지의 IN THIS ISSUE — 섹션 정의에서 만든다. 목차와 본문이 어긋나지 않는다. */
function issueRows() {
  return outputOrder()
    .map((s) => `<li><b>${esc(s.no)}</b><span>${esc(s.title)}</span></li>`)
    .join('');
}

function spineImg(issue) {
  const label = `LOGISIGHT MONTHLY INTELLIGENCE · VOL.${issue.vol} · ${issue.engMonth} ${issue.yy}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='23' height='605' viewBox='0 0 23 605'>`
    + `<text x='0' y='0' transform='translate(15,600) rotate(-90)' font-family='Arial,Helvetica,sans-serif' `
    + `font-size='8.8' font-weight='bold' letter-spacing='2.2' fill='rgba(255,255,255,0.92)'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * @param {object} p
 * @param {string} p.bodyHtml   섹션 구분면이 끼워진 본문 HTML
 * @param {object} p.facts      팩트시트
 * @param {string} p.period     'YYYY-MM'
 * @param {string} p.publishedAt 'YYYY-MM-DD'
 */
function buildMagazineHtml({ bodyHtml, facts, period, publishedAt }) {
  const issue = issueOf(period);
  const HOST = 'jpn.logisight.net';

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Logisight 月次マーケットレポート ${issue.yy}年${issue.mm}月号</title>
<style>
${css()}

/* ── 日本版で足す分 ── */
.execpage{page-break-after:always;padding:18mm 16mm}
.ex-h{display:flex;align-items:baseline;justify-content:space-between;
  border-bottom:2px solid #0E3A66;padding-bottom:3mm;margin-bottom:7mm}
.ex-h h2{font-family:var(--font-title);font-size:20pt;font-weight:800;color:#0E3A66;margin:0}
.ex-h span{font-size:8.5pt;color:#6B7683}
.ex-row{display:grid;grid-template-columns:26mm 1fr;gap:6mm;margin-bottom:6mm}
.ex-tag{background:#0E3A66;color:#fff;font-size:7.5pt;font-weight:800;letter-spacing:2px;
  text-align:center;padding:2mm 0;height:fit-content}
.ex-head{font-size:12.5pt;font-weight:800;color:#C0392B;margin-bottom:2mm}
.ex-body ul{margin:0;padding-left:4mm;list-style:square}
.ex-body li{font-size:9pt;line-height:1.75;color:#2C333B;margin-bottom:1mm}
.ex-note{margin-top:6mm;font-size:8pt;color:#6B7683;border-top:1px solid #E3E7EC;padding-top:3mm}
/* 図は節をまたがせない。表と離れると、どの数値の図か分からなくなる。
   余白を上だけに持たせる — 節末の図に下余白があると、本文が段組の底で終わったとき
   その余白だけが次ページへあふれ、白紙ページが1枚生まれる(実際に生まれた)。 */
figure{margin:6mm 0 0;break-inside:avoid;page-break-inside:avoid;text-align:center}
figure svg{max-width:100%;height:auto}
figcaption{font-size:8pt;color:#6B7683;margin-top:2mm}
</style>
</head>
<body>

<section class="landing">
  <div class="spine-band"></div>
  <div class="spine-mask"></div>
  <div class="spine-text"><img src="${spineImg(issue)}" alt=""></div>
  <div class="ld-shade"></div>
  <div class="ld-head-zone">
    <div class="ld-kicker">MONTHLY MARKET INTELLIGENCE · VOL.${issue.vol} · ${issue.engMonth} ${issue.yy}</div>
    <h1 class="ld-title">月次マーケットレポート</h1>
    <div class="ld-rule"></div>
    <p class="ld-sub">世界の海運・航空・鉄道運賃と日本の港湾・貿易 · ${issue.yy}年${issue.mm}月号</p>
  </div>
  <div class="ld-bottom">
    <div class="ld-issue">
      <div class="ld-issue-h">IN THIS ISSUE</div>
      <ul>${issueRows()}</ul>
    </div>
    <div class="ld-foot">
      <span>発行 ${esc(publishedAt)} · 出典と基準月は各セクションに明記</span>
      <span>${HOST}</span>
    </div>
  </div>
</section>

${execHtml(facts)}

<main class="flow">
${bodyHtml}
</main>

<section class="backcover">
  <div class="bc-brand">${LOGO_SVG}</div>
  <div class="bc-rule"></div>
  <div class="bc-statement">Global Logistics &amp; Market Intelligence<br>世界の運賃と日本の物流を毎月まとめる</div>
  <div class="bc-disclaimer">本レポートは公表統計にもとづく分析である。見通しは情報提供が目的であり、投資や契約の勧誘ではない。無断転載・再配布を禁じる。</div>
  <div class="bc-contact">${HOST}</div>
  <div class="bc-copy">© ${issue.yy} Logisight / MTL Shipping Agency. All rights reserved.</div>
</section>

</body></html>`;
}

module.exports = {
  issueOf, execBlocks, execHtml, dividerHtml, issueRows, buildMagazineHtml,
  fmtIndex, fmtPct, fmtTeu, fmtJpy,
};
