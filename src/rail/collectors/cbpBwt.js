const API = 'https://bwt.cbp.gov/api/waittimes';
const UA = 'LogisightRailMonitor/0.1 (+research)';
const WTB_PORT = '230404';
const THRESHOLD_WATCH = 90;
const CORRIDORS = ['LAR_CHI_CPKC', 'LAZ_LAR_CPKC'];
const WATCH_SCORE = 30;

function parseDelay(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
}

function toISO(value) {
  const parts = String(value || '').split('/');
  if (parts.length !== 3) return new Date().toISOString().slice(0, 10);

  const [month, day, year] = parts;
  if (!month || !day || !year) return new Date().toISOString().slice(0, 10);
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function collectCbpBwt({ fetchImpl = fetch } = {}) {
  const out = { source: 'cbp_bwt', events: [], debug: [], errors: [] };

  let data;
  try {
    const response = await fetchImpl(API, { headers: { 'User-Agent': UA } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    out.errors.push(`fetch: ${error.message}`);
    return out;
  }

  const entry = (Array.isArray(data) ? data : []).find((port) => String(port.port_number) === WTB_PORT);
  if (!entry) {
    out.errors.push('WTB 230404 not found');
    return out;
  }

  const standard = entry?.commercial_vehicle_lanes?.standard_lanes || {};
  const fast = entry?.commercial_vehicle_lanes?.FAST_lanes || {};
  const delay = parseDelay(standard.delay_minutes);
  const lanesOpen = standard.lanes_open ?? '-';
  const standardDelayText = standard.delay_minutes ?? '';
  const standardStatus = standard.operational_status ?? '-';
  const standardUpdate = standard.update_time ?? '';
  const fastDelay = fast.delay_minutes ?? '-';
  const fastLanes = fast.lanes_open ?? '-';

  out.debug.push(
    `WTB standard: delay=${standardDelayText} (${delay == null ? 'non-numeric/skip' : `${delay}min`}) `
      + `status=${standardStatus} lanes=${lanesOpen} fast=${fastDelay}/${fastLanes} ${standardUpdate}`,
  );

  if (delay == null || delay < THRESHOLD_WATCH) return out;

  const date = toISO(entry.date);
  const reason = `Laredo World Trade Bridge truck BWT: standard lanes ${delay} min (border congestion proxy, not railroad disruption)`;
  const evidence = `${reason}; status=${standardStatus}; lanes_open=${lanesOpen}; FAST delay=${fastDelay}; update=${standardUpdate}`;

  for (const code of CORRIDORS) {
    out.events.push({
      source: 'cbp_bwt',
      source_uid: `cbp_bwt:${code}:${date}`,
      checksum: `watch:${delay}:${date}:${standardUpdate}`,
      event_type: 'border_congestion',
      severity: 'watch',
      railroad: null,
      location_text: 'Laredo World Trade Bridge',
      affected_corridors: [code],
      scope: 'border',
      score: WATCH_SCORE,
      summary: reason,
      evidence_text: evidence,
      confidence_score: 0.5,
      start_date: date,
      end_date: null,
    });
  }

  return out;
}

module.exports = { collectCbpBwt, parseDelay, toISO };
