const { EVENT_BASE_SCORE, SCOPE_MULTIPLIER } = require('../../config/rail/scoring');

function scoreEvent(event, scope) {
  const base = EVENT_BASE_SCORE[event.event_type] ?? 0;
  const multiplier = SCOPE_MULTIPLIER[scope] ?? 1.0;
  let score = Math.round(base * multiplier);

  if (event.event_type === 'embargo') score = Math.max(score, 60);
  if (event.severity === 'severe') score = Math.max(score, 60);

  return Math.max(0, Math.min(100, score));
}

module.exports = { scoreEvent };
