const { CORRIDOR_RULES, PORT_ORIGIN_MAP } = require('../../config/rail/corridor-mapping');

function norm(value) {
  return (value || '').toLowerCase();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasToken(text, token) {
  const normalized = token.toLowerCase();
  if (normalized.length <= 3) {
    return new RegExp(`(^|[^a-z])${escapeRegex(normalized)}([^a-z]|$)`, 'i').test(text);
  }
  return text.includes(normalized);
}

function anyToken(text, tokens) {
  return tokens.some((token) => hasToken(text, token));
}

function matchCorridors(event) {
  const text = norm([event.location_text, event.summary, event.evidence_text].join(' '));
  const railroad = norm(event.railroad);
  const railroadAndText = `${railroad} ${text}`;

  if (event.event_type === 'terminal_dwell' && event.port && PORT_ORIGIN_MAP[event.port]) {
    return { corridorCodes: PORT_ORIGIN_MAP[event.port], scope: 'origin_wide', why: `port_dwell:${event.port}` };
  }

  const specific = [];
  for (const rule of CORRIDOR_RULES) {
    if (!rule.railroads.some((candidate) => hasToken(railroadAndText, candidate))) continue;
    if (anyToken(text, rule.origin) || anyToken(text, rule.routeLandmarks) || anyToken(text, rule.destination)) {
      specific.push(rule.code);
    }
  }
  if (specific.length) return { corridorCodes: specific, scope: 'specific', why: 'landmark' };

  if (/system[- ]?wide|network[- ]?wide|systemwide|all (lanes|corridors)/.test(text)) {
    const codes = CORRIDOR_RULES
      .filter((rule) => rule.railroads.some((candidate) => hasToken(railroadAndText, candidate)))
      .map((rule) => rule.code);
    if (codes.length) return { corridorCodes: codes, scope: 'carrier_wide', why: 'system_wide' };
  }

  return { corridorCodes: [], scope: 'none', why: 'no_match' };
}

module.exports = { matchCorridors, hasToken };
