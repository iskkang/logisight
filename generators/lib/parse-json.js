'use strict';
// DeepSeek 응답에서 JSON을 견고하게 추출하는 공용 파서
// Usage: const result = parseJsonRobust(raw);  // null 반환 시 파싱 실패

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

module.exports = { parseJsonRobust };
