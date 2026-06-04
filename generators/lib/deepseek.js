'use strict';
// DeepSeek V4-Pro wrapper — OpenAI-compatible API, Anthropic response shape
// Usage: const msg = await callDeepSeek({ system, messages, max_tokens });
//        const text = msg.content[0].text;
//
// JSON 전용 고수준 래퍼:
//        const obj = await callDeepSeekJson({ messages, max_tokens, debugPrefix });
//        — json_object 모드 + 1회 재시도 + truncation 복구 + 실패 시 전체 덤프

const fs   = require('fs');
const path = require('path');

if (!process.env.DEEPSEEK_API_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
}

async function callDeepSeek({ system, messages, max_tokens = 4096, responseFormat }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 미설정');

  const body = { model: 'deepseek-chat', max_tokens, messages: [] };
  if (responseFormat) body.response_format = responseFormat;
  if (system) body.messages.push({ role: 'system', content: system });
  for (const m of messages) body.messages.push(m);

  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('DeepSeek HTTP ' + r.status + ': ' + t.slice(0, 200));
  }
  const data = await r.json();
  return { content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }] };
}

// JSON 전용 래퍼: 호출 → extractJson → 실패 시 1회 재시도 → 최종 실패 시 전체 덤프
async function callDeepSeekJson({
  system, messages, max_tokens = 8192, responseFormat, debugPrefix = 'deepseek',
}) {
  const { extractJson } = require('./parse-json');
  const rf = responseFormat || { type: 'json_object' };

  async function attempt(msgs) {
    const msg = await callDeepSeek({ system, messages: msgs, max_tokens, responseFormat: rf });
    return msg.content[0].text.trim();
  }

  let raw = '';
  try {
    raw = await attempt(messages);
    return extractJson(raw);
  } catch (_firstErr) {
    // 1회 재시도: 더 간결하게, 완결된 단일 JSON 요청
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: raw },
      { role: 'user', content: '이전 응답이 잘리거나 형식이 맞지 않았습니다. 반드시 완결된 단일 JSON 객체로만, 더 간결하게 응답해 주세요.' },
    ];
    try {
      raw = await attempt(retryMessages);
      return extractJson(raw);
    } catch (finalErr) {
      // 전체 응답 파일 덤프
      const dumpFile = path.resolve(process.cwd(), `debug-${debugPrefix}-${Date.now()}.json`);
      try { fs.writeFileSync(dumpFile, raw, 'utf-8'); } catch (_) {}
      console.error(`❌ JSON 추출 실패 — 원본 전체를 ${path.basename(dumpFile)} 에 저장함 (length=${raw.length})`);
      console.error('❌ 앞 500자:', raw.slice(0, 500));
      throw new Error(`DeepSeek 응답에서 JSON 추출 실패: ${finalErr.message}`);
    }
  }
}

module.exports = { callDeepSeek, callDeepSeekJson };
