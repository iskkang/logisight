'use strict';
// generators/jp-report/image/charts.js
// image maker — 팩트시트 → SVG 차트. 순수 함수(문자열 생성)라 브라우저·헤드리스 의존이 없다.
//
// 차트는 두 종류다:
//  - 단면 막대 — 지금의 수준·증감을 계열끼리 비교한다(SPPI 대비, 항만 전년비, 국가별 무역)
//  - 추이 선 — 지금이 어느 국면인지를 보여준다(세계 스팟 26주, SPPI 24개월)
// 본문은 단면 수치만 쓰므로, 국면은 차트가 아니면 독자에게 전해지지 않는다.

const PALETTE = {
  ink: '#1a2433',
  muted: '#828d9d',
  grid: '#e5e9f0',
  primary: '#1B4D8C',
  secondary: '#2dd4bf',
  up: '#0d9488',
  down: '#b45309',
};

const LINE_COLORS = [PALETTE.primary, PALETTE.up, PALETTE.down, '#7c3aed'];

function escapeXml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 가로 막대 차트. bars[i].values는 series와 같은 길이.
 * 값이 null이면 그 막대는 그리지 않는다(없는 값을 0으로 그리면 거짓말이 된다).
 */
function barChart({ title, subtitle, bars, series, colors, width = 720, signed = false, fmt }) {
  const rowH = 26;
  const groupGap = 14;
  const padL = 190;
  const padT = subtitle ? 72 : 54;
  const padR = 70;
  const height = padT + bars.length * (series.length * rowH + groupGap) + 24;
  const plotW = width - padL - padR;

  const all = bars.flatMap((b) => b.values.filter((v) => Number.isFinite(v)).map(Math.abs));
  const max = all.length ? Math.max(...all) : 1;
  const scale = (v) => (Math.abs(v) / max) * plotW;
  const palette = colors || [PALETTE.primary, PALETTE.secondary];

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Hiragino Sans, Yu Gothic, Meiryo, sans-serif">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<text x="24" y="30" font-size="16" font-weight="700" fill="${PALETTE.ink}">${escapeXml(title)}</text>`);
  if (subtitle) parts.push(`<text x="24" y="50" font-size="11" fill="${PALETTE.muted}">${escapeXml(subtitle)}</text>`);

  let y = padT;
  for (const bar of bars) {
    parts.push(`<text x="${padL - 10}" y="${y + 14}" font-size="11" text-anchor="end" fill="${PALETTE.ink}">${escapeXml(bar.label)}</text>`);
    bar.values.forEach((v, i) => {
      if (!Number.isFinite(v)) { y += rowH; return; }
      const w = Math.max(scale(v), 1);
      const fill = signed ? (v >= 0 ? PALETTE.up : PALETTE.down) : palette[i % palette.length];
      parts.push(`<rect class="bar" x="${padL}" y="${y + 3}" width="${w.toFixed(1)}" height="16" rx="2" fill="${fill}"/>`);
      // eslint-disable-next-line no-nested-ternary
      const label = fmt ? fmt(v) : (signed ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : String(v));
      parts.push(`<text x="${padL + w + 6}" y="${y + 15}" font-size="11" fill="${PALETTE.muted}">${escapeXml(label)}</text>`);
      y += rowH;
    });
    y += groupGap;
  }

  if (series.length > 1) {
    const lx = padL;
    parts.push(series.map((s, i) =>
      `<rect x="${lx + i * 110}" y="${height - 18}" width="10" height="10" fill="${palette[i % palette.length]}"/>`
      + `<text x="${lx + i * 110 + 15}" y="${height - 9}" font-size="10" fill="${PALETTE.muted}">${escapeXml(s)}</text>`).join(''));
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * 눈금을 사람이 읽는 수로 맞춘다. lo·hi를 그대로 4등분하면 4,998 / 3,920 처럼
 * 의미 없는 수가 축에 남아 인쇄물에서 정돈되지 않아 보인다.
 */
function niceTicks(lo, hi, count = 4) {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // eslint-disable-next-line no-nested-ternary
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo: start, hi: end, ticks };
}

/**
 * 折れ線。series[i].values は labels と同じ長さ。
 * 欠測(null)は線を切る — つないで描くと、無い観測を有るように見せてしまう。
 */
function lineChart({ title, subtitle, labels, series, width = 720, height = 300, valueFmt }) {
  if (!labels || labels.length < 2 || !series || series.length === 0) return null;
  const padL = 56;
  const padR = 18;
  const padT = subtitle ? 74 : 56;
  const padB = 48;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (all.length < 2) return null;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const { lo, hi, ticks } = niceTicks(min, max);

  const X = (i) => padL + (i / (labels.length - 1)) * plotW;
  const Y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  // 자릿수는 축 전체의 폭으로 정한다. 값마다 정하면 같은 축에 '0.0'과 '1,000'이 섞인다.
  const fmt = valueFmt
    || ((v) => (hi - lo >= 20 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)));

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Hiragino Sans, Yu Gothic, Meiryo, sans-serif">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<text x="24" y="30" font-size="16" font-weight="700" fill="${PALETTE.ink}">${escapeXml(title)}</text>`);
  if (subtitle) parts.push(`<text x="24" y="50" font-size="11" fill="${PALETTE.muted}">${escapeXml(subtitle)}</text>`);

  for (const v of ticks) {
    const y = Y(v).toFixed(1);
    parts.push(`<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${PALETTE.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 8}" y="${(Y(v) + 4).toFixed(1)}" font-size="10" text-anchor="end" fill="${PALETTE.muted}">${escapeXml(fmt(v))}</text>`);
  }

  // 가로축 눈금은 5개까지. 전부 찍으면 겹쳐서 읽히지 않는다.
  // 마지막 눈금은 반드시 찍되, 그 직전 눈금과 붙으면 앞의 것을 버린다 — 겹쳐 찍히면
  // 07/20과 07/27이 '07/2007/27'로 읽힌다.
  const step = Math.max(1, Math.ceil(labels.length / 5));
  const last = labels.length - 1;
  labels.forEach((l, i) => {
    if (i !== last && (i % step !== 0 || last - i < step / 2)) return;
    parts.push(`<text x="${X(i).toFixed(1)}" y="${padT + plotH + 18}" font-size="10" text-anchor="middle" fill="${PALETTE.muted}">${escapeXml(l)}</text>`);
  });

  series.forEach((s, si) => {
    const color = s.color || LINE_COLORS[si % LINE_COLORS.length];
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
      pen = true;
    });
    if (!d) return;
    parts.push(`<path class="line" d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`);
    // 直近の観測に点を打つ。今の水準がどこかを一目で拾えるようにする。
    const last = s.values.reduce((acc, v, i) => (Number.isFinite(v) ? i : acc), -1);
    parts.push(`<circle cx="${X(last).toFixed(1)}" cy="${Y(s.values[last]).toFixed(1)}" r="3" fill="${color}"/>`);
  });

  series.forEach((s, si) => {
    const color = s.color || LINE_COLORS[si % LINE_COLORS.length];
    const lx = padL + si * 160;
    parts.push(`<rect x="${lx}" y="${height - 17}" width="14" height="3" fill="${color}"/>`);
    parts.push(`<text x="${lx + 19}" y="${height - 11}" font-size="10" fill="${PALETTE.muted}">${escapeXml(s.label)}</text>`);
  });

  parts.push('</svg>');
  return parts.join('\n');
}

/** SPPI 엔 vs 계약통화 — 계약통화 값이 있는 계열만. 없는 계열은 대비가 성립하지 않는다. */
function sppiChart(factsheet) {
  const bars = factsheet.sppi.series
    .filter((s) => Number.isFinite(s.contract) && Number.isFinite(s.yen))
    .map((s) => ({ label: s.name, values: [s.yen, s.contract] }));
  return barChart({
    title: '運賃指数 — 円ベース vs 契約通貨ベース',
    subtitle: `企業向けサービス価格指数 ${factsheet.periods.sppi}(${factsheet.sppi.baseYear}年=100)`,
    bars,
    series: ['円ベース', '契約通貨ベース'],
  });
}

/** 主要6港 전년동월비. 증감을 색으로 구분한다. */
function portChart(factsheet) {
  const bars = factsheet.port.ports
    .filter((p) => Number.isFinite(p.yoyPct))
    .map((p) => ({ label: p.name, values: [p.yoyPct] }));
  return barChart({
    title: '主要6港 コンテナ取扱量 前年同月比',
    subtitle: `${factsheet.periods.port}${factsheet.port.isPreliminary ? '(速報値)' : '(確報値)'}`,
    bars,
    series: ['前年同月比'],
    signed: true,
  });
}

/**
 * 世界のコンテナスポット指数の推移。このレポートの中心軸である。
 * 系列ごとに水準が違うため同一軸に置くと SCFI が上に離れるが、それも事実であり、
 * 各系列の「形」— 上げてきたのか下げ止まったのか — は同一軸のほうが正確に読める。
 */
function globalTrendChart(factsheet) {
  const h = factsheet.global && factsheet.global.history;
  if (!h) return null;
  // 途中から始まる線がある。断らないと、その系列がそこで動き出したように読める。
  const partial = h.series.some((s) => !Number.isFinite(s.values[0]));
  return lineChart({
    title: '世界のコンテナスポット指数 — 直近の推移',
    subtitle: `週次 · 直近 ${h.weeks.length} 週(${h.weeks[0]}〜${h.weeks[h.weeks.length - 1]})`
      + (partial ? ' · 線が途中から始まる系列は、その期間の公表値が本レポートのデータに無い' : ''),
    labels: h.weeks.map((d) => d.slice(5).replace('-', '/')),
    series: h.series.map((s) => ({ label: s.label, values: s.values })),
  });
}

/**
 * SPPI 円ベース vs 契約通貨ベースの推移。
 * 単月の断面では「開きがある」ことしか言えないが、開きが広がってきたのかは推移でしか見えない。
 */
function sppiTrendChart(factsheet, name) {
  const h = factsheet.sppi && factsheet.sppi.history;
  const s = h && h.series.find((x) => x.name === name);
  if (!s) return null;
  return lineChart({
    title: `${name} — 円ベースと契約通貨ベースの推移`,
    subtitle: `月次 · ${factsheet.sppi.baseYear}年=100 · ${h.months[0]}〜${h.months[h.months.length - 1]}`,
    labels: h.months.map((m) => m.slice(2)),
    series: [
      { label: '円ベース', values: s.yen, color: PALETTE.primary },
      { label: '契約通貨ベース', values: s.contract, color: PALETTE.down },
    ],
    valueFmt: (v) => v.toFixed(0),
  });
}

/** 主要相手国の輸出入額。規模の順に並べ、輸出超・輸入超がどちらかを見えるようにする。 */
function tradeChart(factsheet) {
  const rows = (factsheet.trade && factsheet.trade.countries ? factsheet.trade.countries : [])
    .slice(0, 6)
    .filter((c) => Number.isFinite(c.exportJpy) || Number.isFinite(c.importJpy));
  if (rows.length < 2) return null;
  // 千円のままでは桁が読めない。単位を億円に落として副題に明記する。
  const oku = (v) => (Number.isFinite(v) ? (v * 1000) / 1e8 : null);
  return barChart({
    title: '主要相手国 輸出入額',
    subtitle: `財務省貿易統計 ${factsheet.trade.period} · 単位 億円`,
    bars: rows.map((c) => ({ label: c.name, values: [oku(c.exportJpy), oku(c.importJpy)] })),
    series: ['輸出', '輸入'],
    fmt: (v) => Math.round(v).toLocaleString('en-US'),
  });
}

module.exports = {
  escapeXml, barChart, lineChart,
  sppiChart, portChart, globalTrendChart, sppiTrendChart, tradeChart,
  PALETTE,
};
