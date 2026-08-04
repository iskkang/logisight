'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeXml, barChart, lineChart, sppiChart, portChart,
  globalTrendChart, sppiTrendChart, tradeChart,
} = require('./charts');

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

// ── 추이 선 ──────────────────────────────────────────────────────────
const LINE = {
  title: 'テスト',
  labels: ['1', '2', '3', '4'],
  series: [{ label: 'A', values: [100, 110, 105, 120] }],
};

test('lineChart: 유효한 SVG 루트를 만든다', () => {
  const svg = lineChart(LINE);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

// 값이 클수록 위에 그려지지 않으면 차트가 추세를 뒤집어 보여준다(SVG는 y가 아래로 증가).
test('lineChart: 값이 클수록 y가 작다', () => {
  const svg = lineChart({ ...LINE, series: [{ label: 'A', values: [100, 200, 100, 200] }] });
  const pts = [...svg.match(/<path class="line" d="([^"]+)"/)[1].matchAll(/[ML]([\d.]+) ([\d.]+)/g)]
    .map((m) => Number(m[2]));
  assert.ok(pts[1] < pts[0]);
});

// 결측을 이어 그리면 없는 관측을 있는 것처럼 만든다.
test('lineChart: 결측에서 선을 끊는다', () => {
  const svg = lineChart({ ...LINE, series: [{ label: 'A', values: [100, null, 105, 120] }] });
  const d = svg.match(/<path class="line" d="([^"]+)"/)[1];
  assert.equal((d.match(/M/g) || []).length, 2); // 끊긴 만큼 M이 늘어난다
});

test('lineChart: 점이 2개 미만이면 그리지 않는다', () => {
  assert.equal(lineChart({ ...LINE, labels: ['1'], series: [{ label: 'A', values: [100] }] }), null);
  assert.equal(lineChart({ ...LINE, series: [{ label: 'A', values: [100, null, null, null] }] }), null);
});

// ── 팩트시트 → 추이 차트 ─────────────────────────────────────────────
const TREND = {
  ...FACTS,
  sppi: {
    ...FACTS.sppi,
    history: {
      months: ['2026-04', '2026-05', '2026-06'],
      series: [{ name: '外航貨物輸送', yen: [220, 228, 233.8], contract: [158, 159, 160.8] }],
    },
  },
  global: {
    asOf: '2026-07-27',
    history: {
      weeks: ['2026-07-13', '2026-07-20', '2026-07-27'],
      series: [{ code: 'SCFI', label: 'SCFI 総合', values: [3000, 3100, 3206] }],
    },
  },
  trade: {
    period: '2026-06',
    countries: [
      { name: '中国', exportJpy: 1_800_000_000, importJpy: 2_400_000_000 },
      { name: '米国', exportJpy: 1_900_000_000, importJpy: 1_100_000_000 },
    ],
  },
};

test('globalTrendChart: 계열 라벨과 기간을 밝힌다', () => {
  const svg = globalTrendChart(TREND);
  assert.ok(svg.includes('SCFI 総合'));
  assert.ok(svg.includes('2026-07-13'));
});

test('sppiTrendChart: 두 기준을 각각의 선으로 그린다', () => {
  const svg = sppiTrendChart(TREND, '外航貨物輸送');
  assert.ok(svg.includes('円ベース'));
  assert.ok(svg.includes('契約通貨ベース'));
  assert.equal((svg.match(/<path class="line"/g) || []).length, 2);
});

// 시계열이 없으면 빈 액자를 남기지 말고 그림 자체를 빼야 한다.
test('추이 차트: 시계열이 없으면 null', () => {
  assert.equal(globalTrendChart(FACTS), null);
  assert.equal(sppiTrendChart(FACTS, '外航貨物輸送'), null);
  assert.equal(sppiTrendChart(TREND, '存在しない系列'), null);
});

// 千円のまま描くと桁が読めない。副題の単位と目盛が食い違えば図が嘘になる。
test('tradeChart: 億円 단위로 환산해 그린다', () => {
  const svg = tradeChart(TREND);
  assert.ok(svg.includes('単位 億円'));
  assert.ok(svg.includes('18,000')); // 1,800,000,000 千円 = 1兆8,000億円
  assert.ok(svg.includes('中国'));
});

test('tradeChart: 상대국이 없으면 null', () => {
  assert.equal(tradeChart({ trade: { period: '2026-06', countries: [] } }), null);
});

// 4,998 / 3,920 같은 눈금이 인쇄물에 남으면 정돈되지 않아 보인다.
test('lineChart: y축 눈금을 읽기 좋은 수로 맞춘다', () => {
  const svg = lineChart({ ...LINE, series: [{ label: 'A', values: [685, 3206, 1400, 2800] }] });
  const ticks = [...svg.matchAll(/text-anchor="end"[^>]*>([\d,]+)</g)].map((m) => Number(m[1].replace(/,/g, '')));
  assert.ok(ticks.every((t) => t % 500 === 0), `눈금이 라운드하지 않다: ${ticks}`);
  assert.ok(Math.min(...ticks) <= 685 && Math.max(...ticks) >= 3206, '데이터가 축 밖으로 나갔다');
});

// 마지막 눈금과 그 앞이 붙으면 '07/2007/27'처럼 겹쳐 찍힌다.
test('lineChart: x축 라벨이 겹치지 않는다', () => {
  const labels = Array.from({ length: 26 }, (_, i) => `w${i}`);
  const svg = lineChart({ title: 't', labels, series: [{ label: 'A', values: labels.map((_, i) => i) }] });
  const shown = labels.filter((l) => new RegExp(`>${l}<`).test(svg));
  assert.ok(shown.includes('w25'), '마지막 눈금이 없다');
  assert.ok(!shown.includes('w24'), '마지막 눈금과 붙은 눈금이 남았다');
});

// 途中から始まる線を断らないと、その系列がそこで動き出したように読める。
test('globalTrendChart: 도중부터 시작하는 계열이 있으면 부기한다', () => {
  const partial = {
    ...TREND,
    global: {
      history: {
        weeks: ['2026-07-13', '2026-07-20', '2026-07-27'],
        series: [
          { code: 'SCFI', label: 'SCFI 総合', values: [3000, 3100, 3206] },
          { code: 'WCI', label: 'WCI 総合', values: [null, 2000, 2100] },
        ],
      },
    },
  };
  assert.ok(globalTrendChart(partial).includes('公表値が本レポートのデータに無い'));
  assert.ok(!globalTrendChart(TREND).includes('公表値が本レポートのデータに無い'));
});
