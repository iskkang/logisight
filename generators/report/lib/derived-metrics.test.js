'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  laneSpread,
  contractSpotGap,
  congestionRateSignal,
  kitaKcciGap,
} = require('./derived-metrics');

// ── laneSpread ────────────────────────────────────────────────────────────────

test('laneSpread: 공통 최신주 존재 — spread·4주전·변화량 계산', () => {
  const kcci = [
    { week: '2026-06-22', v: 2200 },
    { week: '2026-06-15', v: 2100 },
    { week: '2026-05-25', v: 1900 },
  ];
  const scfi = [
    { week: '2026-06-22', v: 2000 },
    { week: '2026-06-15', v: 1950 },
    { week: '2026-05-25', v: 1800 },
  ];
  const r = laneSpread(kcci, scfi);
  assert.equal(r.latest.week, '2026-06-22');
  assert.equal(r.latest.kcci, 2200);
  assert.equal(r.latest.scfi, 2000);
  assert.equal(r.latest.spread, 200);
  assert.equal(r.spread4wAgo, 100); // 1900 - 1800 (05-25, 28일 전 최근접)
  assert.equal(r.spreadChange, 100); // 200 - 100
});

test('laneSpread: 최신주 불일치(갭) — 공통 최신주로 되짚어 계산', () => {
  const kcci = [
    { week: '2026-06-22', v: 2300 }, // SCFI에 없는 주
    { week: '2026-06-15', v: 2100 },
    { week: '2026-05-18', v: 1900 },
  ];
  const scfi = [
    { week: '2026-06-15', v: 1950 }, // 공통 최신주
    { week: '2026-05-18', v: 1800 },
  ];
  const r = laneSpread(kcci, scfi);
  assert.equal(r.latest.week, '2026-06-15');
  assert.equal(r.latest.spread, 150); // 2100 - 1950
});

test('laneSpread: 공통주 전혀 없음 — 각자 최신주 병기, null 아님', () => {
  const kcci = [{ week: '2026-06-22', v: 2200 }];
  const scfi = [{ week: '2026-06-01', v: 2000 }];
  const r = laneSpread(kcci, scfi);
  assert.equal(r.latest.week, '2026-06-22/2026-06-01');
  assert.equal(r.latest.kcci, 2200);
  assert.equal(r.latest.scfi, 2000);
  assert.equal(r.spread4wAgo, null);
  assert.equal(r.spreadChange, null);
});

test('laneSpread: 입력 부족(빈 시리즈) — null', () => {
  assert.equal(laneSpread([], [{ week: '2026-06-22', v: 100 }]), null);
  assert.equal(laneSpread(null, null), null);
});

// ── contractSpotGap ───────────────────────────────────────────────────────────

test('contractSpotGap: 정상 케이스 — ratioLatest/ratio4wAgo 계산 (주별 비율을 다르게 해 anchor 선택 검증)', () => {
  // 비율: 06-22=0.5, 06-15=0.6, 05-25=0.4 — 상수 비율이면 anchor 오선택을 못 잡으므로 주별로 다르게.
  const ccfi = [
    { week: '2026-06-22', v: 1100 },
    { week: '2026-06-15', v: 1296 },
    { week: '2026-05-25', v: 800 },
  ];
  const scfi = [
    { week: '2026-06-22', v: 2200 },
    { week: '2026-06-15', v: 2160 },
    { week: '2026-05-25', v: 2000 },
  ];
  const r = contractSpotGap(ccfi, scfi);
  assert.equal(r.ratioLatest, 0.5);  // 1100/2200 — 최신 공통주(06-22)
  assert.equal(r.ratio4wAgo, 0.4);   // 800/2000 — 06-22−28일 이전 최근접(05-25). 06-15(0.6)를 잡으면 실패
});

test('contractSpotGap: 매칭 주 8개 미만 — lagWeeks null (throw 없음)', () => {
  const ccfi = [
    { week: '2026-06-22', v: 1100 },
    { week: '2026-06-15', v: 1080 },
  ];
  const scfi = [
    { week: '2026-06-22', v: 2200 },
    { week: '2026-06-15', v: 2160 },
  ];
  const r = contractSpotGap(ccfi, scfi);
  assert.equal(r.lagWeeks, null);
  assert.equal(r.corrAtLag, null);
  assert.equal(r.ratioLatest, 0.5);
});

test('contractSpotGap: 입력 부족(공통주 없음) — null', () => {
  const ccfi = [{ week: '2026-06-22', v: 1100 }];
  const scfi = [{ week: '2026-05-01', v: 2200 }];
  assert.equal(contractSpotGap(ccfi, scfi), null);
  assert.equal(contractSpotGap([], []), null);
});

test('contractSpotGap: 합성 시리즈(CCFI = SCFI를 2주 선행) — lagWeeks=2 검증', () => {
  // 20주 분량, 1주 간격, 갭 없음. SCFI(t) = 1000 + 10*i(과거일수록 작음)
  // CCFI(t) = SCFI(t-2주) 로 구성 → corr(SCFI(t-2), CCFI(t))가 k=2에서 최대(=1)여야 함.
  const N = 20;
  const weeks = [];
  const start = new Date('2026-01-05T00:00:00Z'); // 과거 → 최신 순으로 생성 후 역순 정렬
  for (let i = 0; i < N; i++) {
    const d = new Date(start.getTime() + i * 7 * 86400000);
    weeks.push(d.toISOString().slice(0, 10));
  }
  // 비선형/비주기 패턴 — 순수 선형이면 모든 지연(k)에서 상관계수가 1이 되어 k=2를 구분 못함
  const scfiAsc = weeks.map((w, i) => ({ week: w, v: 1000 + 300 * Math.sin(i * 0.7) + 80 * Math.cos(i * 0.37) + 5 * i }));
  const scfiByWeek = Object.fromEntries(scfiAsc.map(r => [r.week, r.v]));
  // CCFI(t) = SCFI(t-2주). 첫 2주는 대응 SCFI 값 없음 → 제외
  const ccfiAsc = weeks
    .map((w, i) => ({ week: w, i }))
    .filter(({ i }) => i >= 2)
    .map(({ week, i }) => ({ week, v: scfiByWeek[weeks[i - 2]] }));

  const scfi = scfiAsc.slice().reverse();  // 최신순
  const ccfi = ccfiAsc.slice().reverse();  // 최신순

  const r = contractSpotGap(ccfi, scfi, { weeks: 26 });
  assert.equal(r.lagWeeks, 2);
  assert.ok(r.corrAtLag > 0.99);
});

// ── congestionRateSignal ──────────────────────────────────────────────────────

test('congestionRateSignal: 운임↑ 혼잡↑ — 수요 견인 신호', () => {
  const rows = [
    { port: 'Long Beach', median_wait_days: 2, wow_pct: 5 },
    { port: 'Rotterdam', median_wait_days: 3, wow_pct: 3 },
    { port: 'Busan', median_wait_days: 1, wow_pct: 4 },
  ];
  const r = congestionRateSignal(rows, 2.5);
  assert.equal(r.quadrant, 'demand_pull');
  assert.equal(r.label, '수요 견인 신호');
});

test('congestionRateSignal: 결측 wow_pct 섞임 — 유효값만으로 중앙값, ±1%p 이내면 flat', () => {
  const rows = [
    { port: 'Long Beach', median_wait_days: 2, wow_pct: null },
    { port: 'Rotterdam', median_wait_days: 3, wow_pct: 0.5 },
    { port: 'Busan', median_wait_days: 1, wow_pct: -0.5 },
  ];
  const r = congestionRateSignal(rows, 0.3); // 운임도 ±1%p 이내
  assert.equal(r.quadrant, 'flat');
});

test('congestionRateSignal: 입력 부족(빈 rows / wow_pct 전부 결측) — null', () => {
  assert.equal(congestionRateSignal([], 2), null);
  assert.equal(congestionRateSignal([{ port: 'X', median_wait_days: 1, wow_pct: null }], 2), null);
  assert.equal(congestionRateSignal(null, 2), null);
});

// ── kitaKcciGap ───────────────────────────────────────────────────────────────

test('kitaKcciGap: 정상 케이스 — 3개 노선 gapPct 계산', () => {
  const kitaLanes = [
    { destName: '롱비치', feu: 2500, yearMon: '202606' },
    { destName: '뉴욕', feu: 4000, yearMon: '202606' },
    { destName: '로테르담', feu: 3000, yearMon: '202606' },
  ];
  const kcciByCode = {
    KCCI_USWC: [{ week: '2026-06-22', v: 2000 }],
    KCCI_USEC: [{ week: '2026-06-22', v: 4200 }],
    KCCI_NEU: [{ week: '2026-06-22', v: 2800 }],
  };
  const r = kitaKcciGap(kitaLanes, kcciByCode);
  assert.equal(r.length, 3);
  const lb = r.find(x => x.lane === '롱비치');
  assert.equal(lb.kita, 2500);
  assert.equal(lb.kcci, 2000);
  assert.equal(lb.gapPct, 25); // (2500-2000)/2000*100
  assert.equal(lb.week, '2026-06-22');
  assert.equal(lb.kitaMonth, '202606');
});

test('kitaKcciGap: 일부 노선 KCCI 결측 — 해당 노선만 제외', () => {
  const kitaLanes = [
    { destName: '롱비치', feu: 2500, yearMon: '202606' },
    { destName: '뉴욕', feu: 4000, yearMon: '202606' },
  ];
  const kcciByCode = {
    KCCI_USWC: [{ week: '2026-06-22', v: 2000 }],
    // KCCI_USEC 없음
  };
  const r = kitaKcciGap(kitaLanes, kcciByCode);
  assert.equal(r.length, 1);
  assert.equal(r[0].lane, '롱비치');
});

test('kitaKcciGap: 입력 부족 — null', () => {
  assert.equal(kitaKcciGap([], { KCCI_USWC: [{ week: '2026-06-22', v: 2000 }] }), null);
  assert.equal(kitaKcciGap(null, null), null);
  assert.equal(kitaKcciGap([{ destName: '롱비치', feu: 100, yearMon: '202606' }], {}), null);
});
