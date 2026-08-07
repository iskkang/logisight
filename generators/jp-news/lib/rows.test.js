'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JA_SLUG_SUFFIX, categoryJa, jaSlug, needsTranslation, buildJaRow } = require('./rows');

const SRC = {
  id: 7786,
  slug: '2026-07-01-brief',
  title: '한국어 제목',
  summary: '한국어 리드',
  content: '## 본문',
  category: '해상',
  published_at: '2026-07-01T00:00:00Z',
  image_url: 'https://img/1.jpg',
  image_source: 'Unsplash',
  image_credit: 'someone',
  is_hero: true,
  agent_type: 'brief',
};
const JA = { title: '日本語見出し', summary: '日本語リード', content: '## 本文', tags: ['海上', '運賃'] };

// 처음엔 한국어 slug에 -ja만 붙였다. 그 결과 일본 사이트 URL에 한글이 그대로 남았다:
//   /article/2026-08-03-중국-장쑤-국제-철도-...-ja
// 퍼센트 인코딩돼 검색 결과에도 노출됐다. 날짜+번호로 바꾼다.
test('jaSlug: 날짜-원문ID. 비ASCII를 URL에 넣지 않는다', () => {
  assert.equal(jaSlug(SRC), '2026-07-01-7786');
  assert.ok(/^[ -~]+$/.test(jaSlug(SRC)), 'ASCII만 있어야 한다');
});

test('jaSlug: 발행일이 없으면 번호만', () => {
  assert.equal(jaSlug({ id: 42, published_at: null }), 'n42');
});

// maritime_news の一意キーは url。韓国語行と同じ url を使うと上書きしてしまう。
test('buildJaRow: url·slug를 한국어 행과 분리한다', () => {
  const r = buildJaRow(SRC, JA);
  assert.equal(r.slug, '2026-07-01-7786');
  assert.equal(r.url, 'https://jpn.logisight.net/article/2026-07-01-7786');
  assert.notEqual(r.url, 'https://logisight.mtlship.com/article/2026-07-01-brief');
});

test('buildJaRow: slug에 한글이 남지 않는다', () => {
  const src = { ...SRC, slug: '2026-08-03-중국-장쑤-철도' };
  assert.ok(!/[가-힣]/.test(buildJaRow(src, JA).slug));
  assert.ok(!/[가-힣]/.test(buildJaRow(src, JA).url));
});

test('buildJaRow: lang=ja', () => {
  assert.equal(buildJaRow(SRC, JA).lang, 'ja');
});

// 사이트의 카테고리 필터가 이 값과 일치해야 한다. 한국어 값이 남으면 아무것도 안 걸린다.
test('categoryJa: 한국어 카테고리를 일본어로', () => {
  assert.equal(categoryJa('해상'), '海上');
  assert.equal(categoryJa('항공'), '航空');
  assert.equal(categoryJa('철도'), '鉄道');
  assert.equal(categoryJa('무역'), '貿易');
  assert.equal(categoryJa('물류'), '物流');
});

test('categoryJa: 매핑에 없으면 物流로 떨어뜨린다', () => {
  assert.equal(categoryJa('알수없음'), '物流');
  assert.equal(categoryJa(null), '物流');
});

// 이미지·발행일·hero는 원문의 편집 판단이다. 번역이 바꿀 대상이 아니다.
test('buildJaRow: 편집 메타를 원문에서 그대로 가져온다', () => {
  const r = buildJaRow(SRC, JA);
  assert.equal(r.published_at, SRC.published_at);
  assert.equal(r.image_url, SRC.image_url);
  assert.equal(r.image_credit, SRC.image_credit);
  assert.equal(r.is_hero, true);
  assert.equal(r.agent_type, 'brief');
});

test('buildJaRow: 번역된 본문을 담는다', () => {
  const r = buildJaRow(SRC, JA);
  assert.equal(r.title, '日本語見出し');
  assert.equal(r.content, '## 本文');
  assert.deepEqual(r.tags, ['海上', '運賃']);
});

test('buildJaRow: 태그가 비면 null — 빈 배열을 넣지 않는다', () => {
  assert.equal(buildJaRow(SRC, { ...JA, tags: [] }).tags, null);
  assert.equal(buildJaRow(SRC, { ...JA, tags: undefined }).tags, null);
});

// 재실행이 미처리분만 처리해야 한다. 매번 전량 번역하면 비용이 계속 든다.
test('needsTranslation: 이미 번역된 건 건너뛴다', () => {
  const done = new Set(['2026-07-01-7786']);
  assert.equal(needsTranslation(SRC, done), false);
  assert.equal(needsTranslation({ ...SRC, id: 9999 }, done), true);
});

test('needsTranslation: slug가 없으면 대상이 아니다', () => {
  assert.equal(needsTranslation({ ...SRC, slug: null }, new Set()), false);
});

// 일일 다이제스트는 옮기지 않는다.
// 한국판이 매일 만드는 「글로벌 물류 동향 브리프」를 그대로 번역해 넣었더니
// 일본판 뉴스 목록이 날짜만 다른 같은 제목으로 56건 덮였다.
// 그 안의 개별 기사는 글로벌 매체 기사로 따로 들어오므로 중복이기도 하다.
test('일일 다이제스트는 번역 대상에서 뺀다', () => {
  const done = new Set();
  assert.equal(needsTranslation({ slug: 'n1', title: '2026-07-30 글로벌 물류 동향 브리프' }, done), false);
  assert.equal(needsTranslation({ slug: 'n2', title: '글로벌 물류 동향 브리프(2026-07-18)' }, done), false);
  // 이미 일본어로 들어간 것도 다시 잡히면 안 된다
  assert.equal(needsTranslation({ slug: 'n3', title: '2026-08-01 グローバル物流動向ブリーフ' }, done), false);
});

test('보통 기사는 그대로 번역 대상', () => {
  assert.equal(needsTranslation({ slug: 'n4', title: '머스크, FI2 신규 서비스 론칭' }, new Set()), true);
});
