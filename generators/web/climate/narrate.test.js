'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClimatePrompt, validateClimate, narrateClimate } = require('./narrate');

const ctx = {
  asof: new Date('2026-06-23T00:00:00Z'),
  event: { id: 'hko-2611', title: 'MEKKHALA (Super Typhoon)', name: 'MEKKHALA', kind: 'cyclone', severity: 'r', lon: 125.6, lat: 18.5, area: '북서태평양' },
  route: { id: 'r3', name: '아시아–미동안' },
  nearestKm: 878,
  nearestLabel: '대만 해협',
  nearbyAssets: [{ name: '대만 해협', type: 'choke', km: 878, risk: { score: 0, level: 'g', driver: '평온' } }],
};

const GOOD = {
  weather: 'MEKKHALA는 슈퍼태풍 강도로 대만 해협에서 약 880km 떨어진 지점에 위치한 것으로 나타났다. 예보 경로 데이터는 입력에 없어 접근 방향은 단정하지 않는다.',
  impact: '아시아–미동안 노선의 대만해협 통과 구간에서 우회·감속 가능성이 있으며, 리드타임은 +2~4일가량 늘 수 있다는 추정이 가능하다.',
  action: '대만해협 경유 화물의 부킹 일정에 버퍼를 두고 선사 공지를 모니터링할 것을 권고한다.',
  event_echo: 'MEKKHALA',
};

test('buildClimatePrompt: 시스템에 asset_risk 평시-only 가중 지침과 환각 차단 지침 포함', () => {
  const { system, user } = buildClimatePrompt(ctx);
  assert.match(system, /평시/);                 // asset_risk score는 평시 기상장만 반영
  assert.match(system, /활성 이벤트/);          // 둘 다 가중
  assert.match(system, /입력에 없는/);          // 환각 차단(없는 항만·수치 금지)
  // user에는 실데이터만 — 이벤트 타이틀·노선명·근접거리 포함
  assert.match(user, /MEKKHALA/);
  assert.match(user, /아시아–미동안/);
  assert.match(user, /878|880/);
});

test('validateClimate: 정상 3단 출력 통과', () => {
  assert.deepEqual(validateClimate(GOOD, ctx), { ok: true, issues: [] });
});

test('validateClimate: 단정 표현(반드시) 차단', () => {
  const bad = { ...GOOD, impact: '리드타임이 반드시 늘어난다는 추정이 가능하다.' };
  assert.equal(validateClimate(bad, ctx).ok, false);
});

test('validateClimate: 추정표현 없는 지연일 수치 차단', () => {
  const bad = { ...GOOD, impact: '아시아–미동안 노선 리드타임이 +3일 늘어난다.' };
  const v = validateClimate(bad, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => /추정/.test(i)));
});

test('validateClimate: 범위+추정 동반한 지연일은 허용', () => {
  assert.equal(validateClimate(GOOD, ctx).ok, true); // "+2~4일가량 … 추정"
});

test('validateClimate: 현실적 길이(450자) 본문 허용 — 태풍 초안은 길어진다', () => {
  const unit = 'MEKKHALA 슈퍼태풍 대만 해협 인근 위치 추정. ';
  const longWeather = unit.repeat(40).slice(0, 450);
  const v = validateClimate({ ...GOOD, weather: longWeather }, ctx);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
});

test('validateClimate: 폭주(>520자) weather는 차단', () => {
  const tooLong = 'MEKKHALA 슈퍼태풍 대만 해협 인근 위치 추정. '.repeat(40).slice(0, 540);
  assert.equal(validateClimate({ ...GOOD, weather: tooLong }, ctx).ok, false);
});

test('validateClimate: 권장행동 비면 실패', () => {
  const bad = { ...GOOD, action: '' };
  assert.equal(validateClimate(bad, ctx).ok, false);
});

test('validateClimate: 이벤트 echo 불일치 차단(환각 방지)', () => {
  const bad = { ...GOOD, event_echo: 'HAIKUI' };
  assert.equal(validateClimate(bad, ctx).ok, false);
});

test('narrateClimate: 검증 통과 시 3단 필드 반환', async () => {
  const fakeLLM = async () => JSON.stringify(GOOD);
  const out = await narrateClimate(fakeLLM, ctx);
  assert.equal(out.needs_editor, false);
  assert.equal(out.weather, GOOD.weather);
  assert.equal(out.action, GOOD.action);
});

test('narrateClimate: 검증 실패 반복 시 needs_editor=true(빈 본문)', async () => {
  const fakeLLM = async () => 'not json at all';
  const out = await narrateClimate(fakeLLM, ctx, { maxRetries: 1 });
  assert.equal(out.needs_editor, true);
  assert.equal(out.weather, null);
  assert.ok(out.validation_issues.length > 0);
});
