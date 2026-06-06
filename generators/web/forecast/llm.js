'use strict';
// Claude Messages API (raw fetch) — 저장소 LLM 클라이언트 패턴과 동일. 산문 1건 생성용.
async function callClaude({ system, user }, { maxTokens = 1500 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-8', max_tokens: maxTokens,
      thinking: { type: 'adaptive' }, system, messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('Anthropic HTTP ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
module.exports = { callClaude };
