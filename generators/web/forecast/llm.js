'use strict';
// Claude Messages API (raw fetch). v1.4 스펙: Sonnet 계열, temperature 0~0.2, JSON 출력 강제.
async function callClaude({ system, user }, { maxTokens = 1500 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('Anthropic HTTP ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
module.exports = { callClaude };
