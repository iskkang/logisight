'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNarratePrompt, validateProse, narrate } = require('./narrate');

const verdict = {
  direction: 'up', strength: '상승 우세', composite_score: 0.6,
  expected_range_pct: '+1~4', confidence: '중간',
  factor_scores: [{ factor: 'supply', score: 0.5, missing: false }, { factor: 'cost', score: null, missing: true }],
  data_quality_flags: ['cost: 결측 — 가중치 재분배'],
};
const input = {
  metric_ref: 'kita_sea_rates:부산-함부르크', label: '부산→함부르크', cadence: 'monthly', horizon_date: '2026-07-04',
  rate_series: { latest: 2300, unit: 'USD/FEU', mom_pct: -20.7 },
  supply: { blank_sailing: { source_type: 'tracker_quoted', ratio_pct: 5.5, direction: 'stable', effective_capacity_chg_pct: null } },
  china_factor: { scfi_mom_pct: 22.9, scfi_vs_kr_spread: 'widening', china_export_signal: null, evidence: ['SCFI 2주 +22.9%'] },
  demand: { export_momentum_yoy_pct: 2.4, momentum_trend: null, seasonality_flag: 'peak_approaching', region: 'EU' },
  cost: null,
};

test('buildNarratePrompt: 한국발이면 H11~H13·중국변수 우선 + china_factor 주입', () => {
  const { system, user } = buildNarratePrompt(input, verdict);
  assert.match(system, /H11|중국 변수|경유항/);
  assert.match(system, /5문장/);
  assert.match(user, /china_factor/);
  assert.match(user, /22\.9/);
});

const okOpts = { missingFactors: ['cost'], isRate: true };

test('validateProse: 양호한 운임 산문 통과(달러 포함·가설 표지·enum 없음)', () => {
  const r = validateProse({
    statement: '부산발 함부르크향 해상운임은 5월 기준 FEU당 2,300달러로 전월 대비 21%↓(600달러 하락). 현물 약세에도 중국발 SCFI 강세가 선복을 조일 가능성이 크다. 유가 영향은 확인이 필요하다.',
    impact_note: 'FEU당 비용은 당분간 보합권. 중국발 선복 잠식 신호를 부킹 판단의 트리거로.',
    direction_echo: 'up',
  }, verdict, okOpts);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test('validateProse: enum 원문 누설 → 실패', () => {
  const r = validateProse({ statement: '운임은 stable 흐름이며 상승 가능성', impact_note: 'x', direction_echo: 'up' }, verdict, okOpts);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /enum/.test(i)));
});
test('validateProse: 방향 불일치 → 실패', () => {
  assert.equal(validateProse({ statement: '하락 가능성 2,300달러', impact_note: 'x', direction_echo: 'down' }, verdict, okOpts).ok, false);
});
test('validateProse: 결측 팩터(cost) 단정 서술 → 실패, 가설 표지 동반 시 허용', () => {
  const bad = validateProse({ statement: '유가가 올라 2,300달러로 상승 가능성', impact_note: 'x', direction_echo: 'up' }, verdict, okOpts);
  assert.equal(bad.ok, false);
  const ok = validateProse({ statement: '유가 영향 여부는 확인이 필요하며 2,300달러 상승 가능성', impact_note: 'x', direction_echo: 'up' }, verdict, okOpts);
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));
});
test('validateProse: 단위 — 운임 metric인데 달러 없음 → 실패; 지수 metric에 달러 → 실패', () => {
  assert.equal(validateProse({ statement: '상승 가능성이 크다', impact_note: 'x', direction_echo: 'up' }, verdict, { isRate: true }).ok, false);
  assert.equal(validateProse({ statement: 'KCCI 1,200달러 상승 가능성', impact_note: 'x', direction_echo: 'up' }, verdict, { isRate: false }).ok, false);
});
test('validateProse: 자수 560 초과 → 실패', () => {
  const longS = '가'.repeat(561);
  assert.equal(validateProse({ statement: `${longS} 달러 가능성`, impact_note: 'x', direction_echo: 'up' }, verdict, { isRate: true }).ok, false);
});
test('validateProse: 5문장 초과 → 실패', () => {
  const six = '운임은 강세다. 공급은 안정세다. 수요는 견조하다. 중국발은 강세다. 유가는 확인이 필요하다. 종합 달러 상승이다.';
  assert.equal(validateProse({ statement: six, impact_note: 'x', direction_echo: 'up' }, verdict, { isRate: true }).ok, false);
});
test('validateProse: 기준 월 불특정("최근 월") → 실패 (v1.4.1 #6)', () => {
  const s = { statement: '부산발 함부르크향 운임은 최근 월 기준 FEU당 2,300달러로 보합권이다.', impact_note: 'x', direction_echo: 'flat' };
  assert.equal(validateProse(s, { direction: 'flat', data_quality_flags: [] }, { isRate: true }).ok, false);
});
test('validateProse: trend enum 누설(up_2) → 실패', () => {
  const s = { statement: '부산발 LA향 운임은 5월 기준 FEU당 2,900달러로 보합권(up_2)이다.', impact_note: 'x', direction_echo: 'flat' };
  assert.equal(validateProse(s, { direction: 'flat', data_quality_flags: [] }, { isRate: true }).ok, false);
});
test('validateProse: 관측 1건 신호에 추세 동사 → 실패 (v1.4.1 #7)', () => {
  const v = { direction: 'flat', data_quality_flags: ['공급: 방향 미산출(관측 1건) — 기본값 stable'] };
  const s = { statement: '5월 기준 결항률은 5.5%로 안정세를 유지하고 있어 달러 보합권이다.', impact_note: 'x', direction_echo: 'flat' };
  assert.equal(validateProse(s, v, { isRate: true }).ok, false);
});

test('narrate: 검증 통과 시 산문 반환', async () => {
  const fake = async () => JSON.stringify({
    statement: '부산발 함부르크향 해상운임은 5월 기준 FEU당 2,300달러로 전월 대비 21%↓(600달러 하락). 중국발 SCFI 강세가 선복을 조일 가능성이 크다. 유가 영향은 확인이 필요하다.',
    impact_note: 'FEU당 비용 보합권. 중국발 선복 잠식을 부킹 트리거로.',
    direction_echo: 'up',
  });
  const r = await narrate(fake, input, verdict);
  assert.equal(r.needs_editor, false);
  assert.match(r.statement, /달러/);
});
test('narrate: 지속 실패 → 산문 없는 draft(에디터)', async () => {
  const fake = async () => JSON.stringify({ statement: 'stable 하락', impact_note: 'x', direction_echo: 'down' });
  const r = await narrate(fake, input, verdict);
  assert.equal(r.needs_editor, true);
  assert.equal(r.statement, null);
});

// ── 언어 축 ─────────────────────────────────────────────────────────────
// 검증 어휘가 한국어뿐이면 일본어 산문은 무조건 통과한다. 가드가 있으나 마나다.
const JA_V = { ...verdict, data_quality_flags: [] };
const jaBody = (over = {}) => ({
  statement: 'SCFI 総合は7月基準で 2,300 ポイントと前月比 4% 上昇した。供給の引き締まりが上昇要因として働いたとみられる。'
    + '今後2〜4週は +1〜4% の範囲を基本シナリオとする。欠航率が下がれば横ばいシナリオに転じる。',
  impact_note: '調達コストの上振れに備え、契約更改の時期を前倒しで検討する。',
  direction_echo: 'up',
  ...over,
});

test('validateProse(ja): 정상 본문은 통과', () => {
  assert.equal(validateProse(jaBody(), JA_V, { lang: 'ja', isRate: false }).ok, true);
});

test('validateProse(ja): 일본어 단정 표현을 잡는다', () => {
  const v = validateProse(jaBody({ statement: '必ず上昇する。' }), JA_V, { lang: 'ja', isRate: false });
  assert.ok(v.issues.includes('단정 표현 포함'), `잡히지 않음: ${v.issues}`);
});

// 이 대비가 회귀를 막는다 — 언어를 안 넘기면 한국어 목록으로 검사해 그냥 통과한다.
test('validateProse: 언어를 안 넘기면 일본어 단정을 놓친다', () => {
  const v = validateProse(jaBody({ statement: '必ず上昇する。' }), JA_V, { isRate: false });
  assert.ok(!v.issues.includes('단정 표현 포함'));
});

test('validateProse(ja): 통화 단위는 ドル로 검사한다', () => {
  const noYen = validateProse(jaBody(), JA_V, { lang: 'ja', isRate: true });
  assert.ok(noYen.issues.some((i) => i.includes('ドル')), `잡히지 않음: ${noYen.issues}`);
  const withYen = validateProse(jaBody({ statement: 'FEU あたり 2,300 ドルとなった。' }), JA_V, { lang: 'ja', isRate: true });
  assert.ok(!withYen.issues.some((i) => i.includes('ドル')));
});

test('buildNarratePrompt: lang에 따라 출력 언어 지시가 바뀐다', () => {
  const ko = buildNarratePrompt(input, verdict, { lang: 'ko' });
  const ja = buildNarratePrompt(input, verdict, { lang: 'ja' });
  assert.ok(ja.system.includes('日本語'));
  assert.ok(!ko.system.includes('日本語'));
  assert.ok(ja.system.includes('横ばい'), 'enum 일본어화 지시 누락');
});

// 한국발 특례(H11~H13)는 부산 기점 항로에만 성립한다. 일본판 타깃에 붙으면 사실과 다르다.
test('buildNarratePrompt: 한국발 지침은 일본판에 넣지 않는다', () => {
  const withChina = { ...input, china_factor: { scfi_mom_pct: 3 } };
  assert.ok(buildNarratePrompt(withChina, verdict, { lang: 'ko' }).system.includes('부산'));
  assert.ok(!buildNarratePrompt(withChina, verdict, { lang: 'ja' }).system.includes('부산'));
});
