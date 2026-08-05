'use strict';
// Claude(Anthropic) wrapper — 품질 민감 생성 경로 전용 (월간 리포트 본문·주간 리포트·맺음말).
// 대량 반복 작업(일간 큐레이션·번역·태깅)은 generators/lib/deepseek.js 유지 — 2026-07 하이브리드 정책.
// callDeepSeek와 동일한 반환·호출 형태를 유지해 호출부 스왑이 1줄이 되게 한다.
//
// Usage: const msg = await callClaude({ system, messages, max_tokens });
//        const text = msg.content[0].text;
//        const obj = await callClaudeJson({ system, messages, max_tokens, debugPrefix });

const fs = require('fs');
const path = require('path');

if (!process.env.ANTHROPIC_API_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
}

// claude-sonnet-5: adaptive thinking 기본 — max_tokens가 (thinking + 본문)을 함께 캡하므로
// 호출부는 구 비추론 예산보다 여유 있게 잡을 것 (JSON 4k 작업이면 8k 권장).
const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-5';

let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 미설정');
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

async function callClaude({ system, messages, max_tokens = 8192 }) {
  const res = await client().messages.create({
    model: MODEL(),
    max_tokens,
    ...(system ? { system } : {}),
    messages,
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { content: [{ type: 'text', text }], usage: res.usage, stop_reason: res.stop_reason };
}

// JSON 전용 래퍼: 호출 → extractJson → 실패 시 1회 재시도 → 최종 실패 시 전체 덤프 (deepseek.js와 동일 계약)
async function callClaudeJson({ system, messages, max_tokens = 8192, debugPrefix = 'claude' }) {
  const { extractJson } = require('./parse-json');

  async function attempt(msgs) {
    const msg = await callClaude({ system, messages: msgs, max_tokens });
    return msg.content[0].text.trim();
  }

  let raw = '';
  try {
    raw = await attempt(messages);
    return extractJson(raw);
  } catch (_firstErr) {
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: raw || '(빈 응답)' },
      { role: 'user', content: '이전 응답이 잘리거나 형식이 맞지 않았습니다. 반드시 완결된 단일 JSON 객체로만, 더 간결하게 응답해 주세요.' },
    ];
    try {
      // 간격 없이 다시 부르면 일시적 빈 응답이 그대로 또 빈 응답으로 온다.
      // 2026-06 일본판 재생성이 그렇게 두 번 연속 비어 죽었고, 15분치 호출이 버려졌다.
      await new Promise((r) => setTimeout(r, 2000));
      raw = await attempt(retryMessages);
      return extractJson(raw);
    } catch (finalErr) {
      const dumpFile = path.resolve(process.cwd(), `debug-${debugPrefix}-${Date.now()}.json`);
      try { fs.writeFileSync(dumpFile, raw, 'utf-8'); } catch (_) {}
      console.error(`❌ JSON 추출 실패 — 원본 전체를 ${path.basename(dumpFile)} 에 저장함 (length=${raw.length})`);
      console.error('❌ 앞 500자:', raw.slice(0, 500));
      throw new Error(`Claude 응답에서 JSON 추출 실패: ${finalErr.message}`);
    }
  }
}

module.exports = { callClaude, callClaudeJson };
