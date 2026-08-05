'use strict';
// DeepSeek 응답에서 JSON을 견고하게 추출하는 공용 파서
// Usage: const result = parseJsonRobust(raw);  // null 반환 시 파싱 실패 (legacy)
//        const result = extractJson(raw);       // throw 방식 (truncation 복구 포함)

function parseJsonRobust(raw) {
  // 1) ```json ... ``` 코드펜스 제거
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // 2) 직접 파싱 시도
  try { return JSON.parse(stripped); } catch {}

  // 3) 첫 { ~ 마지막 } 사이 substring 추출
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch {}
  }

  return null;
}

// 잘린 JSON을 닫힌 중괄호/대괄호 보완으로 복구 시도
function repairTruncatedJson(s) {
  let str = s;
  // 마지막 매달린 콤마/콜론 정리
  str = str.replace(/,\s*$/, '');
  // 홀수 따옴표 → 마지막 미완성 문자열 라인 제거
  const quoteCount = (str.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) str = str.replace(/,?\s*"[^"]*$/, '');
  // 스택 기반 열린 괄호 추적 (카운팅 방식은 닫기 순서가 틀릴 수 있음)
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of str) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  str = str.replace(/,\s*$/, '');
  str = str.replace(/,(\s*[}\]])/g, '$1'); // 닫기 괄호 직전 trailing comma 제거
  str += stack.reverse().join('');
  return str;
}

// throw 방식 추출 (truncation 복구 포함) — callDeepSeekJson에서 사용
function extractJson(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('LLM 응답이 비어 있음(빈 문자열) — max_tokens가 사고 과정에 잠식됐을 수 있다');

  // 1) 코드펜스 제거 (멀티라인 펜스 처리)
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1].trim();

  // 2) 첫 '{' ~ 마지막 '}' 슬라이스
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1) throw new Error('DeepSeek 응답에 JSON 객체 없음');
  const candidate = end > start ? text.slice(start, end + 1) : text.slice(start);

  // 3) 1차 파싱
  try { return JSON.parse(candidate); } catch (_) {}

  // 4) 잘림 복구 후 재파싱
  return JSON.parse(repairTruncatedJson(candidate));
}

module.exports = { parseJsonRobust, extractJson, repairTruncatedJson };
