'use strict';
// DeepSeek V4-Pro wrapper — OpenAI-compatible API, Anthropic response shape
// Usage: const msg = await callDeepSeek({ system, messages, max_tokens });
//        const text = msg.content[0].text;

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

module.exports = { callDeepSeek };
