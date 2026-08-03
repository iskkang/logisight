'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeXml, barChart, sppiChart, portChart } = require('./charts');

test('escapeXml: SVG를 깨뜨리는 문자를 이스케이프', () => {
  assert.equal(escapeXml('A & B <c> "d"'), 'A &amp; B &lt;c&gt; &quot;d&quot;');
});

const bars = [
  { label: '外航貨物輸送', values: [233.8, 160.8] },
  { label: '国際航空貨物輸送', values: [142.4, 98.1] },
];

test('barChart: 유효한 SVG 루트를 만든다', () => {
  const svg = barChart({ title: 'テスト', bars, series: ['円', '契約通貨'] });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('viewBox'));
});

test('barChart: 라벨과 값이 모두 들어간다', () => {
  const svg = barChart({ title: 'テスト', bars, series: ['円', '契約通貨'] });
  assert.ok(svg.includes('外航貨物輸送'));
  assert.ok(svg.includes('233.8'));
  assert.ok(svg.includes('98.1'));
});

// 막대 길이가 값에 비례하지 않으면 차트가 거짓말을 한다.
test('barChart: 값이 클수록 막대가 길다', () => {
  const svg = barChart({ title: 't', bars: [{ label: 'A', values: [100] }, { label: 'B', values: [50] }], series: ['x'] });
  const widths = [...svg.matchAll(/<rect[^>]*class="bar"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2);
  assert.ok(widths[0] > widths[1]);
});

test('barChart: 값이 없으면 막대를 그리지 않는다', () => {
  const svg = barChart({ title: 't', bars: [{ label: 'A', values: [null] }], series: ['x'] });
  assert.ok(!svg.includes('class="bar"'));
});

// ── 팩트시트 → 차트 ──────────────────────────────────────────────────
const FACTS = {
  periods: { sppi: '2026-06', port: '2026-05' },
  sppi: {
    baseYear: '2020',
    series: [
      { name: '外航貨物輸送', yen: 233.8, contract: 160.8 },
      { name: '国際航空貨物輸送', yen: 142.4, contract: 98.1 },
      { name: '内航貨物輸送', yen: 135.0, contract: null },
    ],
  },
  port: {
    isPreliminary: true,
    ports: [
      { name: '東京港', teu: 367332, yoyPct: 0.058 },
      { name: '川崎港', teu: 6935, yoyPct: -7.087 },
    ],
  },
};

test('sppiChart: 계약통화 값이 있는 계열만 대비로 그린다', () => {
  const svg = sppiChart(FACTS);
  assert.ok(svg.includes('外航貨物輸送'));
  assert.ok(svg.includes('国際航空貨物輸送'));
  assert.ok(!svg.includes('内航貨物輸送')); // 계약통화 없음 — 대비가 성립하지 않는다
});

test('sppiChart: 기준연도를 제목에 밝힌다', () => {
  assert.ok(sppiChart(FACTS).includes('2020'));
});

test('portChart: 항만별 전년비를 그리고 속보임을 밝힌다', () => {
  const svg = portChart(FACTS);
  assert.ok(svg.includes('東京港'));
  assert.ok(svg.includes('速報'));
});

// 증감이 부호로 구분되지 않으면 감소를 증가로 읽는다.
test('portChart: 음수와 양수를 다른 색으로 그린다', () => {
  const svg = portChart(FACTS);
  const colors = [...svg.matchAll(/<rect[^>]*class="bar"[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(colors).size, 2);
});
