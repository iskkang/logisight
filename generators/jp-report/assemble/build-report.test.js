'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { injectCharts } = require('./build-report');

// 図の位置は節番号で決めていた。モード別構成に組み替えたとき、港湾の図が「03. 航空」に
// ぶら下がったまま気づかなかった — 図と本文が別々に定義されていて対応の検査が無かった。
// ここが守るのは「図は指定した節の中に入る」ことだけである。

const MD = [
  '## 01. 総論',
  'ほんぶん。',
  '',
  '---',
  '',
  '## 02. 海運',
  '',
  '## 02-1. 世界のスポット指数',
  'ほんぶん。',
  '',
  '---',
  '',
  '## 05. 港湾',
  'ほんぶん。',
].join('\n');

const chart = (no, key) => ({ afterSection: no, svgFile: `${key}.svg`, alt: key });

/** 図が入った行が、どの節の範囲にあるか。 */
function sectionOf(md, file) {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.includes(file));
  assert.ok(at >= 0, `図が入っていない: ${file}`);
  let no = null;
  for (let i = 0; i <= at; i += 1) {
    const m = /^#{1,3}\s*(\d{2})\.\s/.exec(lines[i].trim());
    if (m) no = m[1];
  }
  return no;
}

test('injectCharts: 지정한 섹션 안에 들어간다', () => {
  const out = injectCharts(MD, [chart('05', 'port'), chart('02', 'global')]);
  assert.equal(sectionOf(out, 'port.svg'), '05');
  assert.equal(sectionOf(out, 'global.svg'), '02');
});

// 小見出し(02-1.)を節見出しと誤認すると、図が小見出しの中に紛れ込む。
test('injectCharts: 소섹션 번호를 섹션으로 오인하지 않는다', () => {
  const out = injectCharts(MD, [chart('02', 'a')]);
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.includes('a.svg'));
  const head = lines.findIndex((l) => l.startsWith('## 05.'));
  assert.ok(at < head, '図が02節の外に出た');
});

test('injectCharts: 없는 섹션은 건너뛴다', () => {
  const out = injectCharts(MD, [chart('09', 'ghost')]);
  assert.ok(!out.includes('ghost.svg'));
  assert.equal(out.split('\n').length, MD.split('\n').length);
});

// 同じ節に2枚置くとき、順序が入れ替わると図と説明の対応が崩れる。
test('injectCharts: 같은 섹션의 여러 장은 정의 순서대로 쌓인다', () => {
  const out = injectCharts(MD, [chart('02', 'first'), chart('02', 'second')]);
  assert.ok(out.indexOf('first.svg') < out.indexOf('second.svg'));
});

test('injectCharts: 마지막 섹션에도 넣는다', () => {
  const out = injectCharts(MD, [chart('05', 'last')]);
  assert.equal(sectionOf(out, 'last.svg'), '05');
});
