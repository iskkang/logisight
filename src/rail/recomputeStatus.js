const { ALL_CORRIDORS, CORRIDOR_RULES } = require('../../config/rail/corridor-mapping');
const { STATUS_THRESHOLDS } = require('../../config/rail/scoring');

const COVERAGE = Object.fromEntries(CORRIDOR_RULES.map((rule) => [rule.code, rule.coverage ?? null]));

function scoreToStatus(score) {
  for (const threshold of STATUS_THRESHOLDS) {
    if (score >= threshold.min) return threshold.status;
  }
  return 'unknown';
}

function recomputeCorridorStatus(scoredEvents, opts = {}) {
  const healthy = new Set(opts.healthySources ?? []);
  const stbCheckedCorridors = new Set(opts.stbCheckedCorridors ?? []);
  const byCorridor = Object.fromEntries(ALL_CORRIDORS.map((code) => [code, []]));

  for (const event of scoredEvents) {
    for (const code of event.corridorCodes) {
      if (byCorridor[code]) byCorridor[code].push(event);
    }
  }

  return ALL_CORRIDORS.map((code) => {
    const events = byCorridor[code];
    if (events.length === 0) {
      const coverage = COVERAGE[code];
      if (coverage && healthy.has(coverage)) {
        return {
          corridor_code: code,
          status: 'normal',
          score: null,
          reason: `${coverage.toUpperCase()} advisory checked - no reported disruption`,
          source: coverage,
          active_event_ids: [],
        };
      }

      if (stbCheckedCorridors.has(code)) {
        return {
          corridor_code: code,
          status: 'normal',
          score: null,
          reason: 'STB carrier-level checked - within normal range',
          source: 'stb',
          active_event_ids: [],
        };
      }

      return {
        corridor_code: code,
        status: 'unknown',
        score: null,
        reason: coverage ? `${coverage.toUpperCase()} collection failed` : 'limited public operating feed (news monitoring only)',
        source: null,
        active_event_ids: [],
      };
    }

    const top = events.reduce((best, event) => (event.score > best.score ? event : best));
    const reason = top.source === 'stb' ? top.summary : `${top.event_type} (${top.source}) - ${top.summary}`;
    return {
      corridor_code: code,
      status: scoreToStatus(top.score),
      score: top.score,
      reason: reason.slice(0, 240),
      source: top.source,
      active_event_ids: events.map((event) => event.id).filter(Boolean),
    };
  });
}

module.exports = { recomputeCorridorStatus, scoreToStatus };
