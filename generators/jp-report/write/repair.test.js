'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sentencesOf, numberRule, numberTargets, attachSentences, hedgeTargets, repairSection,
} = require('./repair');

// 실제 팩트시트의 축소판. 欠航は 49便(6%)まで、10 は無い。
const FACTS = {
  generatedFor: '2026-07',
  supply: { blankedSailings: 49, blankPct: 6, recent: [{ blankedSailings: 58, blankPct: 8 }] },
  global: { indices: [{ code: 'SCFI', value: 3509.53, changePct: 2.93 }] },
};

// 2026-09-22 실행에서 02. 海運을 막은 실제 문장.
const BAD = '公表された直近回の欠航は49便(6%)である。欠航率も再び10%を上回る水準にある。';

test('sentencesOf: 표와 각주는 건드리지 않는다', () => {
  const body = ['| 港 | TEU |', '※ 速報値である。', '主要6港は増加した。'].join('\n');
  assert.deepEqual(sentencesOf(body), ['主要6港は増加した。']);
});

test('numberTargets: 위반이 든 문장만 집는다', () => {
  const targets = numberTargets(BAD, FACTS);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].sentence, '欠航率も再び10%を上回る水準にある。');
  assert.ok(targets[0].raws.includes('10'));
});

test('numberRule: 위반 숫자와 임계값 금지를 문자 그대로 싣는다', () => {
  const rule = numberRule(['10']);
  assert.ok(rule.includes('『10』'));
  assert.ok(rule.includes('factsheetに存在しない'));
  assert.ok(rule.includes('閾値・目安の数値も新たに作らないこと'));
});

// ±20자 문맥만 보내면 모델이 어디를 고칠지 못 짚는다. 문장 원문을 붙인다.
test('attachSentences: 위반에 그 문장 원문이 붙는다', () => {
  const [v] = attachSentences(BAD, [{ raw: '10', value: 10, context: '再び10%を上回る' }], FACTS);
  assert.equal(v.sentence, '欠航率も再び10%を上回る水準にある。');
  assert.ok(v.rule.includes('『10』'));
});

test('hedgeTargets: 상한을 넘은 문장만, 위치와 함께 집는다', () => {
  const body = [
    '航空のスポット指数は本レポートのデータに含まれていない。',
    '需給のどちらから動いたかは説明できない。',
    'この点はデータの限界として明記しておく。',
  ].join('');
  const targets = hedgeTargets(body);
  assert.equal(targets.length, 2); // 상한 1 — 첫 문장은 남긴다
  assert.ok(targets[0].sentence.includes('説明できない'));
  assert.ok(targets[0].instruction.includes('2文目'));
});

test('repairSection: 문장 재작성으로 통과하면 ok', async () => {
  const logs = [];
  const r = await repairSection({
    body: BAD,
    factsheet: FACTS,
    rewrite: async () => '欠航は公表された直近回で49便である。',
    log: (m) => logs.push(m),
  });
  assert.equal(r.ok, true);
  assert.equal(r.how, 'rewrite');
  assert.ok(!r.body.includes('10%'));
  assert.ok(logs.join(' ').includes('재작성'));
});

// 재작성이 또 위반을 물고 오면 그 문장을 지운 판으로 검증한다.
test('repairSection: 재작성이 실패하면 문장 삭제로 해결한다', async () => {
  const logs = [];
  const r = await repairSection({
    body: BAD,
    factsheet: FACTS,
    rewrite: async () => '欠航率は15%を上回る。', // 15도 팩트시트에 없다
    log: (m) => logs.push(m),
  });
  assert.equal(r.ok, true);
  assert.equal(r.how, 'delete');
  assert.equal(r.body, '公表された直近回の欠航は49便(6%)である。');
  assert.ok(logs.join(' ').includes('삭제'));
});

// 남는 문장이 없으면 통과시키지 않는다. 빈 섹션을 내보내느니 미해결이 낫다.
test('repairSection: 삭제해도 남는 게 없으면 미해결', async () => {
  const only = '欠航率も再び10%を上回る水準にある。';
  const r = await repairSection({ body: only, factsheet: FACTS, rewrite: async () => '20%を上回る。' });
  assert.equal(r.ok, false);
  assert.equal(r.body, only);
});

// 목차·앵커가 소섹션 번호에 의존한다. 제목 줄은 지우지 않는다.
test('repairSection: 제목 줄은 삭제 대상이 아니다', async () => {
  const body = ['## 02-3. 欠航 — 10%超の週', '', '公表された直近回の欠航は49便(6%)である。'].join('\n');
  const r = await repairSection({ body, factsheet: FACTS, rewrite: async () => '## 02-3. 欠航 — 49便の週' });
  assert.equal(r.ok, true);
  assert.equal(r.how, 'rewrite');
  assert.ok(r.body.includes('## 02-3.'));
});

test('repairSection: 수리 대상이 아닌 검사(인과 등)는 손대지 않는다', async () => {
  const body = '円安が運賃を押し上げた。';
  let called = 0;
  const r = await repairSection({ body, factsheet: FACTS, rewrite: async () => { called += 1; return 'x'; } });
  assert.equal(r.ok, false);
  assert.equal(called, 0);
});

// 호출이 죽어도 삭제 경로까지는 가야 한다. 여기서 던지면 회차 전체가 날아간다.
test('repairSection: 재작성 호출이 실패해도 삭제로 이어진다', async () => {
  const r = await repairSection({
    body: BAD,
    factsheet: FACTS,
    rewrite: async () => { throw new Error('timeout'); },
  });
  assert.equal(r.ok, true);
  assert.equal(r.how, 'delete');
});
