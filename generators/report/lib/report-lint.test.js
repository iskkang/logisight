'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const { lintReport } = require('./report-lint');

function criticalRules(findings) {
  return findings.filter(f => f.severity === 'critical').map(f => f.rule);
}

test('금지패턴 ①: ➔/☞ 라인 → critical', () => {
  const md = '본문 서술.\n\n➔ 화주는 계약 갱신을 검토해야 함.\n';
  const { findings } = lintReport(md, []);
  assert.ok(criticalRules(findings).includes('forbidden-arrow'));
});

test('금지패턴 ②: 미수집/수집 실패/접속 실패/다음 호 업데이트 → critical', () => {
  const md1 = 'KITA 참고운임은 미수집 상태임.';
  const md2 = '데이터 접속 실패로 표를 비움.';
  const md3 = '다음 호 업데이트 예정.';
  assert.ok(criticalRules(lintReport(md1, []).findings).includes('ops-leak'));
  assert.ok(criticalRules(lintReport(md2, []).findings).includes('ops-leak'));
  assert.ok(criticalRules(lintReport(md3, []).findings).includes('ops-leak'));
});

test('금지패턴 ③: 경어체(습니다/입니다)·평서체(했다./이다.) → critical', () => {
  const md1 = '운임이 상승했습니다.';
  const md2 = '이는 공급 과잉 때문입니다.';
  const md3 = '운임이 큰 폭으로 상승했다.';
  const md4 = '이는 구조적 요인 때문이다.';
  assert.ok(criticalRules(lintReport(md1, []).findings).includes('formal-ending'));
  assert.ok(criticalRules(lintReport(md2, []).findings).includes('formal-ending'));
  assert.ok(criticalRules(lintReport(md3, []).findings).includes('formal-ending'));
  assert.ok(criticalRules(lintReport(md4, []).findings).includes('formal-ending'));
});

test('금지패턴 ④: ▲ 0.0% / ▼ 0.0% (보합인데 방향기호) → critical', () => {
  const md1 = '| 한국→중국 | 54 | ▲ 0.0% | ▼ 3.6% |';
  const md2 = '한국→중국 항로는 ▼ 0.0% 보합세를 기록.';
  assert.ok(criticalRules(lintReport(md1, []).findings).includes('flat-with-arrow'));
  assert.ok(criticalRules(lintReport(md2, []).findings).includes('flat-with-arrow'));
});

test('정상 문장(명사형 종결) → critical findings 없음', () => {
  const md = [
    '## 02-1. KCCI 원양 항로 강세 지속',
    '',
    '**컨테이너 운임 강세 지속**',
    '',
    'SCFI 종합은 3,327p로 전월 대비 ▲22.0% MoM 상승하며 연중 최고치를 경신하는 국면. 성수기 수요 집중이 주된 동인으로 작용하며, 3분기에도 상방 압력이 이어질 전망.',
  ].join('\n');
  const { findings } = lintReport(md, [3327, 22.0]);
  assert.equal(criticalRules(findings).length, 0);
});

test('표 수치는 수치 대조(warn) 대상에서 제외 — 표 안 미매칭 수치는 warn 없음', () => {
  const md = '| 지수 | 최신값 |\n|---|---|\n| SCFI | 9,999 |\n';
  const { findings } = lintReport(md, [1, 2, 3]); // 9999는 injected에 없음
  assert.equal(findings.filter(f => f.rule === 'number-mismatch').length, 0);
});

test('본문(prose) 미매칭 수치 → warn', () => {
  const md = 'SCFI는 9,999p로 급등하며 사상 최고치를 기록하는 국면.';
  const { findings } = lintReport(md, [3327, 22.0]); // 9999는 주입 수치에 없음
  const warns = findings.filter(f => f.rule === 'number-mismatch' && f.severity === 'warn');
  assert.equal(warns.length, 1);
});

test('본문 수치가 주입 수치와 일치 → warn 없음(±반올림·쉼표 허용)', () => {
  const md = 'SCFI는 3327.04p로 상승하며 강세 국면을 이어감.';
  const { findings } = lintReport(md, [3327.0]); // 반올림 1자리 일치
  assert.equal(findings.filter(f => f.rule === 'number-mismatch').length, 0);
});

test('연도·주차·날짜·페이지·%p는 수치 대조에서 제외 — false positive 방지', () => {
  const md = '2026년 7월 24일(W30) 기준 3페이지 표를 참고, 격차는 3%p로 축소.';
  const { findings } = lintReport(md, []); // 주입 수치 없어도 warn 없어야 함
  assert.equal(findings.filter(f => f.rule === 'number-mismatch').length, 0);
});

test('excerpt는 120자 이내로 절단', () => {
  const longLine = '➔ ' + '가'.repeat(200);
  const { findings } = lintReport(longLine, []);
  const f = findings.find(x => x.rule === 'forbidden-arrow');
  assert.ok(f.excerpt.length <= 121); // 120 + 말줄임표(…) 1글자
});

test('발췌는 매치 지점 중심 — 긴 문단 뒤쪽 위반도 발췌에 보임', () => {
  const long = 'A'.repeat(500) + ' 연쇄 반응이 발생했다. ' + 'B'.repeat(100);
  const { findings } = lintReport(long, []);
  const f = findings.find(x => x.rule === 'formal-ending');
  assert.ok(f, 'formal-ending 검출');
  assert.match(f.excerpt, /발생했다/);   // 500자 뒤 매치가 발췌에 포함
});

test('평서체 ~한다./~됐다. 종결도 검출 (§2 전체 커버)', () => {
  const { findings: f1 } = lintReport('양극화가 심화된다.', []);
  const { findings: f2 } = lintReport('개편이 단행됐다.', []);
  assert.ok(f1.some(x => x.rule === 'formal-ending'));
  assert.ok(f2.some(x => x.rule === 'formal-ending'));
  // 명사형 정상 문장은 통과
  const { findings: ok } = lintReport('상승 압력 지속 전망.', []);
  assert.ok(!ok.some(x => x.rule === 'formal-ending'));
});

test('중국어식 축약(근 1/5 류) — critical 검출', () => {
  const { findings } = lintReport('세계 석유의 근 1/5이 통과.', []);
  assert.ok(findings.some(x => x.rule === 'calque'));
});

test('금지 직역어(주간선) — critical 검출', () => {
  const { findings } = lintReport("핵심 '주간선'으로 부상.", []);
  assert.ok(findings.some(x => x.rule === 'calque'));
});

test('고유명사 표기 혼용(호르무즈/오르무즈 동시 사용) — critical 검출', () => {
  const md = '호르무즈 해협 긴장.\n\n오르무즈 사태 이후 회복 지연.';
  const { findings } = lintReport(md, []);
  assert.ok(findings.some(x => x.rule === 'inconsistent-name'));
});

test('단일 표기만 쓰면 표기 혼용 미검출', () => {
  const { findings } = lintReport('호르무즈 해협 긴장 지속. 호르무즈 통항 재개.', []);
  assert.ok(!findings.some(x => x.rule === 'inconsistent-name'));
});

test('STATS/OGIMG 토큰 라인은 수치 대조 제외 (시스템 주입 카드)', () => {
  const { findings } = lintReport('[[STATS: 141.9|지수|flat ; 7,777|라벨|up :: 출처]]', []);
  assert.ok(!findings.some(x => x.rule === 'number-mismatch'));
});

test('기사 귀속 라인("에 따르면")은 수치 대조 제외 — 기사 인용은 교차검증이 담당', () => {
  const { findings } = lintReport('FreightWaves에 따르면 점유율이 59%로 급증.', []);
  assert.ok(!findings.some(x => x.rule === 'number-mismatch'));
});

test('서수·조수사(3중·2차)는 수치로 취급 안 함', () => {
  const { findings } = lintReport('3중 운송 모드 연쇄와 2차 터널 공사.', []);
  assert.ok(!findings.some(x => x.rule === 'number-mismatch'));
});

test('미매칭 수치는 발췌에 명시 — 검토 용이성', () => {
  const { findings } = lintReport('운임이 9,999달러를 기록.', [100]);
  const f = findings.find(x => x.rule === 'number-mismatch');
  assert.ok(f && /9999|9,999/.test(f.excerpt));
});
