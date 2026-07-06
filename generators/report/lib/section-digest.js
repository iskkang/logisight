'use strict';
// 크로스섹션 dedup — 앞서 생성된 섹션의 핵심 주제(소제목·리드 볼드)를 추출해
// 뒤 섹션 프롬프트에 "이미 다룬 주제" 블록으로 주입한다.
// 목적: 호르무즈·Del Monte·미들 코리도어가 여러 섹션에서 같은 서사로 반복되는 것을 차단.

const MAX_LINES = 12;

// 섹션 md에서 h2/h3 소제목과 독립 리드 볼드(**...**) 라인만 추출.
function extractDigest(markdown, sectionTitle) {
  const out = [];
  for (const raw of String(markdown).split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{2,3}\s+(.+)$/);
    if (h) { out.push('- ' + h[1]); continue; }
    const lead = line.match(/^\*\*([^*]{4,80})\*\*$/); // 독립 볼드 라인 = 리드 소제목
    if (lead) out.push('- ' + lead[1]);
    if (out.length >= MAX_LINES) break;
  }
  return `[${sectionTitle}]\n` + out.join('\n');
}

function buildPriorDigestBlock(digests) {
  if (!digests || !digests.length) return '';
  return [
    '## 앞 섹션에서 이미 다룬 주제 (중복 서술 금지)',
    '아래는 이 리포트의 앞 섹션들이 이미 상세히 다룬 이슈다. 같은 이슈를 같은 서사로 반복하지 말 것.',
    '겹치는 이슈는 (1) 이 섹션 고유의 **새로운 각도**(이 섹션 지표·모드에 미치는 영향)로만 짧게 연결하거나',
    '(2) 아예 생략하고 이 섹션 고유 이슈에 지면을 쓸 것. 동일 기업 사례·동일 수치의 재인용 금지.',
    '',
    ...digests,
    '',
  ].join('\n');
}

// 총론(01)용 — 마지막에 생성되는 총론이 전 섹션을 종합하도록 하는 입력 블록.
// dedup 블록과 반대 목적: 반복 금지가 아니라 섹션 간 연결·공통 동인 도출.
function buildSynthesisBlock(digests) {
  if (!digests || !digests.length) return '';
  return [
    '## 본 리포트 각 섹션의 핵심 (총론 종합용)',
    '아래는 이 리포트의 다른 섹션들이 이미 확정한 핵심 주제다. 총론은 이를 단순 재요약·나열하지 말고,',
    '섹션을 관통하는 **공통 동인과 단일 프레임**(예: 공급충격 사이클)을 도출해 종합할 것.',
    '해운-항공-철도-거시 간 연결(한 모드의 변화가 다른 모드에 미치는 파급)을 최소 1개 제시.',
    '',
    ...digests,
    '',
  ].join('\n');
}

module.exports = { extractDigest, buildPriorDigestBlock, buildSynthesisBlock };
