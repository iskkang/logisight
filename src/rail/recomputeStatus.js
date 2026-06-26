const { ALL_CORRIDORS } = require('../../config/rail/corridor-mapping');
const { STATUS_THRESHOLDS, PRESUME_NORMAL_ON_NO_ISSUE } = require('../../config/rail/scoring');

function scoreToStatus(score) {
  for (const threshold of STATUS_THRESHOLDS) {
    if (score >= threshold.min) return threshold.status;
  }
  return 'unknown';
}

function recomputeCorridorStatus(scoredEvents) {
  const byCorridor = Object.fromEntries(ALL_CORRIDORS.map((code) => [code, []]));

  for (const event of scoredEvents) {
    for (const code of event.corridorCodes) {
      if (byCorridor[code]) byCorridor[code].push(event);
    }
  }

  return ALL_CORRIDORS.map((code) => {
    const events = byCorridor[code];
    if (events.length === 0) {
      return {
        corridor_code: code,
        status: PRESUME_NORMAL_ON_NO_ISSUE ? 'normal' : 'unknown',
        score: null,
        reason: PRESUME_NORMAL_ON_NO_ISSUE ? 'collection succeeded, no reported issue' : 'no signal',
        source: null,
        active_event_ids: [],
      };
    }

    const top = events.reduce((best, event) => (event.score > best.score ? event : best));
    return {
      corridor_code: code,
      status: scoreToStatus(top.score),
      score: top.score,
      reason: `${top.event_type} (${top.source}) - ${top.summary}`.slice(0, 240),
      source: top.source,
      active_event_ids: events.map((event) => event.id).filter(Boolean),
    };
  });
}

module.exports = { recomputeCorridorStatus, scoreToStatus };
