const RAILROAD_PATTERNS = [
  { rr: 'BNSF', re: /\bbnsf\b/i },
  { rr: 'UP', re: /\bunion pacific\b|\bup\b/i },
  { rr: 'NS', re: /\bnorfolk southern\b/i },
  { rr: 'CSX', re: /\bcsx\b/i },
  { rr: 'CN', re: /\bcanadian national\b|\bcn\b/i },
  { rr: 'CPKC', re: /\bcpkc\b|\bcanadian pacific\b/i },
];

const EVENT_PATTERNS = [
  { type: 'embargo', re: /\bembargo\b/i, sev: 'severe' },
  { type: 'derailment', re: /\bderail/i, sev: 'severe' },
  { type: 'line_out_of_service', re: /line out of service|track out of service|line closure/i, sev: 'severe' },
  { type: 'service_interruption', re: /service interruption|service disruption|service interruptions/i, sev: 'moderate' },
  { type: 'terminal_dwell', re: /\bdwell\b/i, sev: 'moderate' },
  { type: 'congestion', re: /\bcongestion\b|\bcongested\b/i, sev: 'moderate' },
  { type: 'service_advisory', re: /service advisory|customer (advisory|notification|alert)/i, sev: 'info' },
  { type: 'weather', re: /\bweather\b|\bstorm\b|\bflood/i, sev: 'watch' },
  { type: 'construction', re: /\bconstruction\b|maintenance window/i, sev: 'info' },
];

function ruleParseEvent(rawText, meta = {}) {
  const text = rawText || '';
  const railroad = RAILROAD_PATTERNS.find((pattern) => pattern.re.test(text))?.rr ?? (meta.railroad || 'unknown');
  const event = EVENT_PATTERNS.find((pattern) => pattern.re.test(text));

  return {
    id: meta.id || null,
    source: meta.source || 'unknown',
    railroad,
    event_type: event?.type || 'unknown',
    severity: event?.sev || 'info',
    port: meta.port || null,
    location_text: meta.location_text || text.slice(0, 200),
    summary: (text.split(/[.\n]/)[0] || '').slice(0, 200),
    evidence_text: text.slice(0, 500),
    confidence_score: event ? 0.7 : 0.3,
    start_date: meta.start_date || null,
    end_date: meta.end_date || null,
  };
}

module.exports = { ruleParseEvent };
