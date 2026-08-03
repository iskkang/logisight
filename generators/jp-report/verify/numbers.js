'use strict';
// generators/jp-report/verify/numbers.js
// verifier (a) — 결정적 수치 검증. 본문의 숫자를 팩트시트와 대조한다.
//
// LLM 검수로는 수치 오류를 안정적으로 못 잡는다. 실제 샘플에서 지수 차이 73포인트를
// "15ポイント超の開き"로 쓴 오류가 나왔는데, 이런 건 코드로 대조하면 100% 걸린다.
//
// 전제: writer 프롬프트가 "팩트시트에 있는 수치만 사용하고 차이를 계산해 쓰지 말 것"을
// 지시한다. 그래야 이 검증이 엄격해도 오탐이 나지 않는다.

/** 지수 기준값. "100を下回る" 같은 기준연도 서술에 쓰인다. */
const ALWAYS_ALLOWED = [0, 100];

/** 상대 오차 허용치. 兆·億 반올림 표기를 흡수한다. */
const REL_TOLERANCE = 0.005;
/** 절대 오차 허용치. 소수 1자리 반올림(0.128 → 0.13)을 흡수한다. */
const ABS_TOLERANCE = 0.05;

const UNITS = { 万: 1e4, 億: 1e8, 兆: 1e12 };

/** '10兆9,270億' → 1.0927e13 / '117万7,717' → 1177717 / '▲7.09' → -7.09 */
function parseJpNumber(raw) {
  let s = String(raw).trim();
  let sign = 1;
  if (/^[▲△-]/.test(s)) { sign = -1; s = s.slice(1); }
  else if (/^\+/.test(s)) s = s.slice(1);

  let total = 0;
  let buf = '';
  for (const ch of s) {
    if (UNITS[ch]) {
      total += Number(buf.replace(/,/g, '')) * UNITS[ch];
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) total += Number(buf.replace(/,/g, ''));
  return Number.isFinite(total) ? sign * total : NaN;
}

// 숫자 토큰: 부호 + 자릿수/쉼표/소수 + 万億兆 복합
const NUM_RE = /[▲△+-]?\d[\d,]*(?:\.\d+)?(?:[万億兆]\d[\d,]*(?:\.\d+)?)*(?:[万億兆])?/g;

/**
 * 검증 대상이 아닌 숫자의 뒤 글자.
 * 날짜(2026年·6月)와 조수사(主要6港·13品目)는 데이터 주장이 아니라 서술이다.
 * 걸러내지 않으면 매 회차 오탐이 난다.
 */
const SKIP_SUFFIX = /^(?:カ月|ヶ月|か月|カ国|ヶ国|か国|年間|年|月|日|港|件|社|品目|位|週|期|番|回|軸|つ|種)/;

/** 본문에서 숫자를 뽑는다. 날짜·조수사는 제외한다. */
function extractNumbers(text) {
  const out = [];
  const src = String(text || '');
  for (const m of src.matchAll(NUM_RE)) {
    const raw = m[0];
    const after = src.slice(m.index + raw.length, m.index + raw.length + 3);
    if (SKIP_SUFFIX.test(after)) continue;
    // '## 02. 海上運賃' / '1. 項目' — 섹션·목록 번호는 데이터가 아니라 문서 구조다.
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const before = src.slice(lineStart, m.index);
    if (/^#{0,6}\s*$/.test(before) && /^\.\s/.test(after)) continue;
    const value = parseJpNumber(raw);
    if (!Number.isFinite(value)) continue;
    out.push({
      raw,
      value,
      index: m.index,
      context: src.slice(Math.max(0, m.index - 20), m.index + raw.length + 20).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

/** 팩트시트의 모든 수치를 평면화한다. 千円→円 변환분도 함께 담는다. */
function collectFactValues(factsheet) {
  const values = new Set(ALWAYS_ALLOWED);
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) return;
      values.add(node);
      values.add(-node);
      // 팩트시트 금액은 千円이지만 본문은 円(兆·億)으로 쓴다.
      values.add(node * 1000);
      values.add(-node * 1000);
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') { Object.values(node).forEach(walk); }
  };
  walk(factsheet);
  return [...values];
}

function matches(candidate, factValues) {
  for (const f of factValues) {
    const diff = Math.abs(candidate - f);
    if (diff <= ABS_TOLERANCE) return true;
    if (Math.abs(f) > 0 && diff / Math.abs(f) < REL_TOLERANCE) return true;
  }
  return false;
}

/**
 * @returns {{ok: boolean, checked: number, violations: Array<{raw,value,context}>}}
 */
function verifyNumbers(text, factsheet) {
  const factValues = collectFactValues(factsheet);
  const found = extractNumbers(text);
  const violations = found
    .filter((n) => !matches(n.value, factValues))
    .map(({ raw, value, context }) => ({ raw, value, context }));
  return { ok: violations.length === 0, checked: found.length, violations };
}

module.exports = { parseJpNumber, extractNumbers, collectFactValues, verifyNumbers };
