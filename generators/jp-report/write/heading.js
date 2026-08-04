'use strict';
// generators/jp-report/write/heading.js
// 섹션 제목 정규화.
//
// 실제 생성에서 재생성된 섹션이 '## 港湾 主要6港合計は…'로 번호를 잃었다.
// 목차·앵커·출력 순서가 번호에 의존하므로 형식이 흔들리면 안 된다.
// 다만 제목 뒤 헤드라인은 SEO 자산이라 보존한다.

/**
 * @param {string} body 섹션 본문(첫 줄이 '## …' 제목일 수 있다)
 * @param {{no: string, title: string}} section
 */
function normalizeHeading(body, section) {
  const text = String(body || '');
  const lines = text.split('\n');
  const prefix = `## ${section.no}. ${section.title}`;

  const first = (lines[0] || '').trim();
  if (!first.startsWith('#')) {
    return `${prefix}\n\n${text}`.trim();
  }

  // 맺음말처럼 라벨이 고정된 섹션은 제목을 반드시 남기고 헤드라인을 뒤에 붙인다.
  // 월간 시리즈에서 맺음말 라벨이 달마다 바뀌면 독자가 알아보지 못한다.
  if (section.keepTitle) {
    const raw = first.replace(/^#+\s*/, '').replace(/^\d[\d-]*\.\s*/, '').trim();
    const headline = raw.startsWith(section.title)
      ? raw.slice(section.title.length).replace(/^[\s―—–\-:：]+/, '')
      : raw;
    lines[0] = headline ? `${prefix} ― ${headline}` : prefix;
    return lines.join('\n');
  }

  if (new RegExp(`^#+\\s*${section.no}\\.`).test(first)) return text; // 이미 정상

  // 모델이 쓴 제목 표현은 그대로 두고 번호만 끼운다.
  // 제목명을 잘라내려다 '港湾動向'을 단어 중간에서 끊어 '港湾 ― 動向 ―'처럼
  // 구분자가 겹친 적이 있다. 번호만 넣는 편이 안전하고 헤드라인도 보존된다.
  const headingText = first.replace(/^#+\s*/, '').trim();
  lines[0] = headingText ? `## ${section.no}. ${headingText}` : prefix;
  return lines.join('\n');
}

/**
 * 섹션 제목 바로 뒤에 블록(표 등)을 끼운다.
 * 참조 리포트와 같은 배치 — 표가 먼저 오고 본문이 그것을 해석한다.
 */
function insertAfterHeading(body, block) {
  const text = String(body || '');
  if (!block) return text;
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /^#{1,6}\s/.test(l.trim()));
  if (idx < 0) return `${block}\n\n${text}`;
  return [...lines.slice(0, idx + 1), '', block, ...lines.slice(idx + 1)].join('\n');
}

const HEADING_RE = /^#{2,6}\s/;
/** 앞머리 번호('02-1.' '3.')를 떼고 제목 문구만 남긴다. */
const headingText = (line) => line.replace(/^#+\s*/, '').replace(/^\d[\d-]*\.\s*/, '').trim();

/**
 * 소섹션 제목에 번호를 매긴다.
 *
 * 모델은 소섹션을 순서대로 쓰지만 번호는 자주 빠뜨린다('## 国際航空 ― …').
 * 위치로 매긴다 — 모델이 쓴 헤드라인은 SEO 자산이므로 문구는 그대로 두고 번호만 갈아 끼운다.
 * 모델이 섹션 제목까지 쓴 경우는 코드가 따로 찍으므로 여기서 뺀다.
 */
function numberSubsections(body, section) {
  const lines = String(body || '').split('\n');
  const idx = lines.map((l, i) => (HEADING_RE.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return String(body || '');

  const first = idx[0];
  const drop = headingText(lines[first]).startsWith(section.title);
  const targets = drop ? idx.slice(1) : idx;
  targets.forEach((i, n) => {
    lines[i] = `## ${section.no}-${n + 1}. ${headingText(lines[i])}`;
  });
  if (drop) lines[first] = null;
  return lines.filter((l) => l !== null).join('\n').trim();
}

/**
 * 섹션 한 덩이를 조립한다. 참조 리포트와 같은 배치 —
 * 섹션 제목(본문 없는 구분선) → 표 → 번호 붙은 소섹션.
 * 소섹션이 없는 섹션(총론·맺음말)은 모델이 쓴 헤드라인 제목을 살린다.
 */
function composeSection(body, section, table) {
  if (!section.subsections || section.subsections.length === 0) {
    return insertAfterHeading(normalizeHeading(body, section), table);
  }
  return [`## ${section.no}. ${section.title}`, table, numberSubsections(body, section)]
    .filter(Boolean)
    .join('\n\n');
}

module.exports = {
  normalizeHeading, insertAfterHeading, numberSubsections, composeSection,
};
