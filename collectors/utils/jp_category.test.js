'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { categorize } = require('./jp_category');

// 분류를 LLM에 맡기면 같은 기사가 실행마다 다른 칸에 들어간다. 코드가 정한다.

test('태그로 분류한다 — 매체가 붙인 것이 제목보다 정확하다', () => {
  assert.equal(categorize({ title: '無関係', tags: ['海運', '決算'] }), '海上');
  assert.equal(categorize({ title: '無関係', tags: ['鉄道'] }), '鉄道');
  assert.equal(categorize({ title: '無関係', tags: ['航空', 'JAL'] }), '航空');
  assert.equal(categorize({ title: '無関係', tags: ['貿易', '通関'] }), '貿易');
});

// 태그가 비는 기사가 실제로 있다.
test('태그가 없으면 제목으로 본다', () => {
  assert.equal(categorize({ title: '横須賀港で海上コンテナ輸送の実証', tags: [] }), '港湾');
  assert.equal(categorize({ title: 'JR貨物、新ダイヤ', tags: [] }), '鉄道');
});

// '港湾で海上コンテナ' 처럼 둘 다 걸리면 더 구체적인 쪽.
test('港湾이 海上보다 우선한다', () => {
  assert.equal(categorize({ title: 't', tags: ['港湾', '海上コンテナ輸送'] }), '港湾');
});

test('걸리는 것이 없으면 物流', () => {
  assert.equal(categorize({ title: 'ヤマトHDがJIJに出資', tags: ['CVCファンド', '量子技術'] }), '物流');
  assert.equal(categorize({ title: '', tags: [] }), '物流');
  assert.equal(categorize({}), '物流');
});

// 실제 피드에서 뽑은 태그로 회귀를 막는다.
test('실제 태그 표본이 의도한 칸으로 간다', () => {
  const cases = [
    [['ロジスティクス', 'アパレル物流', '港湾', '海上コンテナ輸送'], '港湾'],
    [['3PL・物流企業', '決算'], '物流'],
    [['SCM・経営', '運賃', '西濃運輸'], '物流'],   // 西濃運輸는 육운이다. 運賃만으로 海上이 아니다
    [['IT・機器', '自動化'], '物流'],
    [['タンカー', 'LPG', '飯野海運'], '海上'],
    [['ウクライナ鉄道', '米国鉄道協会AAR'], '鉄道'],
  ];
  for (const [tags, want] of cases) {
    assert.equal(categorize({ title: '', tags }), want, `${tags.join(',')} → ${want}`);
  }
});

// 해사 전문지의 기사가 키워드에 안 걸린다고 物流로 가면 어색하다.
// 키워드를 끝없이 늘리는 대신 매체 성격을 폴백으로 쓴다.
test('fallback: 전문지면 그 분야로 떨어뜨린다', () => {
  const item = { title: '紅海・アデン湾、針路変更相次ぐ。原油船や自動車船', tags: [] };
  assert.equal(categorize(item), '物流');
  assert.equal(categorize(item, '海上'), '海上');
});

test('fallback: 키워드에 걸리면 폴백보다 우선한다', () => {
  assert.equal(categorize({ title: '成田空港の航空貨物', tags: [] }, '海上'), '航空');
});

// '運賃'은 모드를 가리지 않는다. 海上 키워드에 넣었더니 트럭 운임 기사가 海上으로 갔다.
test('運賃만으로 海上으로 보내지 않는다', () => {
  assert.equal(categorize({ title: '西濃運輸／8月21日から新届出運賃、20％程度アップ', tags: [] }), '物流');
  // 해운 맥락이 함께 있으면 海上이 맞다.
  assert.equal(categorize({ title: 'コンテナ運賃', tags: ['海運'] }), '海上');
});
