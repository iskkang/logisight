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

  if (new RegExp(`^#+\\s*${section.no}\\.`).test(first)) return text; // 이미 정상

  // 모델이 쓴 제목 표현은 그대로 두고 번호만 끼운다.
  // 제목명을 잘라내려다 '港湾動向'을 단어 중간에서 끊어 '港湾 ― 動向 ―'처럼
  // 구분자가 겹친 적이 있다. 번호만 넣는 편이 안전하고 헤드라인도 보존된다.
  const headingText = first.replace(/^#+\s*/, '').trim();
  lines[0] = headingText ? `## ${section.no}. ${headingText}` : prefix;
  return lines.join('\n');
}

module.exports = { normalizeHeading };
