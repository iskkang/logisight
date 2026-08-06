'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const cache = require('./cache');

const SECTION = {
  id: 'ocean', no: '02', title: '海運',
  focus: '海上コンテナを中心に述べる。',
  subsections: ['02-1. 世界のスポット指数'],
};
const BASE = {
  slim: { sppi: { series: [{ name: '外航貨物輸送', yen: 233.8 }] } },
  section: SECTION,
  style: '文体ガイド',
  seo: 'SEO ガイド',
  digests: [{ title: '海運', digest: '要旨' }],
};
const PERIOD = '9999-99'; // 실제 회차와 섞이지 않게

test.after(() => fs.rmSync(path.join(cache.ROOT, PERIOD), { recursive: true, force: true }));

test('저장하고 같은 지문으로 되읽는다', () => {
  const fp = cache.fingerprint(BASE);
  cache.write(PERIOD, 'ocean', fp, '本文である。');
  assert.equal(cache.read(PERIOD, 'ocean', fp), '本文である。');
});

// 낡은 원고가 살아남는 것이 캐시의 진짜 위험이다. 팩트시트가 바뀌면 무조건 버려야 한다.
test('팩트시트가 바뀌면 되쓰지 않는다', () => {
  cache.write(PERIOD, 'ocean', cache.fingerprint(BASE), '古い本文。');
  const changed = { ...BASE, slim: { sppi: { series: [{ name: '外航貨物輸送', yen: 240.0 }] } } };
  assert.equal(cache.read(PERIOD, 'ocean', cache.fingerprint(changed)), null);
});

test('섹션 지시가 바뀌면 되쓰지 않는다', () => {
  cache.write(PERIOD, 'ocean', cache.fingerprint(BASE), '古い本文。');
  const changed = { ...BASE, section: { ...SECTION, focus: '別の狙い。' } };
  assert.equal(cache.read(PERIOD, 'ocean', cache.fingerprint(changed)), null);
});

test('문체 가이드가 바뀌면 되쓰지 않는다', () => {
  cache.write(PERIOD, 'ocean', cache.fingerprint(BASE), '古い本文。');
  assert.equal(cache.read(PERIOD, 'ocean', cache.fingerprint({ ...BASE, style: '新しいガイド' })), null);
});

// 총론·전망은 앞 섹션의 요지를 종합하는 것이 일이다. 요지가 바뀌면 다시 써야 한다.
test('총론은 요지가 바뀌면 되쓰지 않는다', () => {
  const overview = { ...BASE, section: { id: 'overview', no: '01', title: '総論', focus: 'まとめる。', generateLast: true } };
  cache.write(PERIOD, 'overview', cache.fingerprint(overview), '古い総論。');
  const changed = { ...overview, digests: [{ title: '海運', digest: '別の要旨' }] };
  assert.equal(cache.read(PERIOD, 'overview', cache.fingerprint(changed)), null);
});

// 데이터 섹션에게 요지는 배경 맥락일 뿐이다. 앞 섹션이 문장을 다듬었다고
// 이쪽이 틀리지는 않는다. 전부 무효화하면 한 섹션만 고쳐도 뒤가 통째로 날아간다.
test('데이터 섹션은 요지가 바뀌어도 되쓴다', () => {
  const fp = cache.fingerprint(BASE);
  cache.write(PERIOD, 'ocean', fp, '本文である。');
  const changed = { ...BASE, digests: [{ title: '海運', digest: '別の要旨' }] };
  assert.equal(cache.read(PERIOD, 'ocean', cache.fingerprint(changed)), '本文である。');
});

test('저장분이 없으면 null', () => {
  assert.equal(cache.read(PERIOD, 'あるはずのない', 'x'), null);
});

test('빈 본문은 되쓰지 않는다', () => {
  const fp = cache.fingerprint(BASE);
  cache.write(PERIOD, 'ocean', fp, '   ');
  assert.equal(cache.read(PERIOD, 'ocean', fp), null);
});

test('clear 하면 그 회차가 사라진다', () => {
  const fp = cache.fingerprint(BASE);
  cache.write(PERIOD, 'ocean', fp, '本文である。');
  cache.clear(PERIOD);
  assert.equal(cache.read(PERIOD, 'ocean', fp), null);
});
