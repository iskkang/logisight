'use strict';
// generators/jp-report/image/charts.js
// image maker — 팩트시트 → SVG 차트. 순수 함수(문자열 생성)라 브라우저·헤드리스 의존이 없다.
//
// 리포트에 필요한 차트는 두 개다:
//  1. SPPI 엔 베이스 vs 계약통화 베이스 — 이 리포트의 핵심 논점
//  2. 主要6港 전년동월비 — 증감이 갈린 항만 대비

const PALETTE = {
  ink: '#1a2433',
  muted: '#828d9d',
  grid: '#e5e9f0',
  primary: '#1B4D8C',
  secondary: '#2dd4bf',
  up: '#0d9488',
  down: '#b45309',
};

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
function barChart({ title, subtitle, bars, series, colors, width = 720, signed = false }) {
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
      const label = signed ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : String(v);
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

module.exports = { escapeXml, barChart, sppiChart, portChart, PALETTE };
