const XLSX = require('xlsx');
const {
  STB_PAGE,
  STB_CARRIERS,
  STB_CARRIER_CORRIDORS,
  STB_CHICAGO_CORRIDORS,
  STB_THRESHOLDS,
  STB_STATUS_SCORE,
} = require('../../../config/rail/stb');

const UA = 'LogisightRailMonitor/0.1 (+research)';

function numberOrNull(value) {
  if (typeof value === 'string') {
    const cleaned = value.replace(/[\s,\u00a0]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentChange(latest, prior) {
  return prior ? ((latest - prior) / Math.abs(prior)) * 100 : null;
}

function formatValue(value, suffix = '') {
  return Number.isInteger(value) ? `${value}${suffix}` : `${Number(value).toFixed(1)}${suffix}`;
}

function excelDateToISO(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return XLSX.SSF.format('yyyy-mm-dd', value);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function normalizedHeader(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function findLatestUrl(fetchImpl) {
  const response = await fetchImpl(STB_PAGE, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`page HTTP ${response.status}`);
  const html = await response.text();
  const re = /href=["']([^"']*EP724[^"']*?(\d{4}-\d{2}-\d{2})[^"']*\.xlsx)["']/gi;

  let match;
  let best = null;
  let bestDate = '';
  while ((match = re.exec(html))) {
    if (match[2] > bestDate) {
      bestDate = match[2];
      best = match[1];
    }
  }

  if (!best) throw new Error('consolidated xlsx link not found');
  const url = best.startsWith('http') ? best : new URL(best, STB_PAGE).href;
  return { url, week: bestDate };
}

function loadSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });

  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    if ((rows[i] || []).some((cell) => /^Railroad\/\s*Region$/i.test(normalizedHeader(cell)))) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) throw new Error('header row not found');

  const header = rows[headerIndex];
  const railroadCol = header.findIndex((cell) => /^Railroad\/\s*Region$/i.test(normalizedHeader(cell)));
  const dateCols = header
    .map((cell, index) => ({ index, date: excelDateToISO(cell) }))
    .filter((col) => /^\d{4}-\d{2}-\d{2}$/.test(col.date || ''))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (dateCols.length < 2) throw new Error('need at least two date columns');
  return {
    rows,
    headerIndex,
    railroadCol,
    firstDateCol: dateCols[0].index,
    prior: dateCols[dateCols.length - 2],
    latest: dateCols[dateCols.length - 1],
  };
}

function carrierFromText(value) {
  const text = String(value || '');
  return STB_CARRIERS.find((carrier) => new RegExp(`\\b${carrier}\\b`, 'i').test(text)) || null;
}

function speedTier(percent) {
  if (percent == null) return null;
  if (percent <= -STB_THRESHOLDS.speedDeclinePct.delayed) return 'delayed';
  if (percent <= -STB_THRESHOLDS.speedDeclinePct.watch) return 'watch';
  return null;
}

function dwellTier(percent) {
  if (percent == null) return null;
  if (percent >= STB_THRESHOLDS.dwellIncreasePct.delayed) return 'delayed';
  if (percent >= STB_THRESHOLDS.dwellIncreasePct.watch) return 'watch';
  return null;
}

function addBestSignal(bestByCorridor, corridors, tier, signal) {
  const rank = { watch: 1, delayed: 2 };
  for (const corridor of corridors) {
    const current = bestByCorridor[corridor];
    if (!current || rank[tier] > rank[current.tier]) bestByCorridor[corridor] = { ...signal, tier };
  }
}

async function collectStb({ fetchImpl = fetch } = {}) {
  const out = { source: 'stb', week: null, events: [], debug: [], errors: [] };

  let buffer;
  try {
    const latestFile = await findLatestUrl(fetchImpl);
    out.week = latestFile.week;
    const response = await fetchImpl(latestFile.url, { headers: { 'User-Agent': UA } });
    if (!response.ok) throw new Error(`xlsx HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    out.errors.push(`fetch: ${error.message}`);
    return out;
  }

  let sheet;
  try {
    sheet = loadSheet(buffer);
  } catch (error) {
    out.errors.push(`parse: ${error.message}`);
    return out;
  }

  const { rows, headerIndex, railroadCol, firstDateCol, prior, latest } = sheet;
  const bestByCorridor = {};

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;

    const railroad = String(row[railroadCol] ?? '').trim();
    const descriptor = row
      .slice(0, firstDateCol)
      .map((cell) => (cell == null ? '' : String(cell)))
      .join(' | ');
    const lower = descriptor.toLowerCase();
    const latestValue = numberOrNull(row[latest.index]);
    const priorValue = numberOrNull(row[prior.index]);
    if (latestValue == null || priorValue == null) continue;

    if (/train speed/.test(lower) && /intermodal/.test(lower)) {
      const carrier = carrierFromText(railroad) || carrierFromText(descriptor);
      if (!carrier || !STB_CARRIER_CORRIDORS[carrier]) continue;

      const change = percentChange(latestValue, priorValue);
      const tier = speedTier(change);
      out.debug.push(
        `speed ${carrier}: ${formatValue(priorValue)}->${formatValue(latestValue)} MPH (${change.toFixed(1)}%) ${tier ?? 'ok'}`,
      );
      if (tier) {
        addBestSignal(bestByCorridor, STB_CARRIER_CORRIDORS[carrier], tier, {
          event_type: 'stb_speed_decline',
          reason: `STB: ${carrier} intermodal speed ${change.toFixed(1)}% WoW (${formatValue(priorValue)}->${formatValue(latestValue)} MPH)`,
        });
      }
    } else if (/dwell/.test(lower) && /\bsystem\b/.test(lower)) {
      const carrier = carrierFromText(railroad) || carrierFromText(descriptor);
      if (!carrier || !STB_CARRIER_CORRIDORS[carrier]) continue;

      const change = percentChange(latestValue, priorValue);
      const tier = dwellTier(change);
      out.debug.push(
        `dwell ${carrier} system: ${formatValue(priorValue)}->${formatValue(latestValue)}h (${change.toFixed(1)}%) ${tier ?? 'ok'}`,
      );
      if (tier) {
        addBestSignal(bestByCorridor, STB_CARRIER_CORRIDORS[carrier], tier, {
          event_type: 'stb_terminal_dwell',
          reason: `STB: ${carrier} system terminal dwell +${change.toFixed(1)}% WoW (${formatValue(priorValue)}->${formatValue(latestValue)}h)`,
        });
      }
    } else if ((railroad.toLowerCase() === 'chicago' || /chicago/.test(lower)) && /dwell/.test(lower)) {
      const carrier = carrierFromText(descriptor) || carrierFromText(railroad);
      if (!carrier || !STB_CHICAGO_CORRIDORS[carrier]) continue;

      const change = percentChange(latestValue, priorValue);
      const tier = dwellTier(change);
      out.debug.push(
        `chicago-dwell ${carrier}: ${formatValue(priorValue)}->${formatValue(latestValue)}h (${change.toFixed(1)}%) ${tier ?? 'ok'} [${descriptor.slice(0, 80)}]`,
      );
      if (tier) {
        addBestSignal(bestByCorridor, STB_CHICAGO_CORRIDORS[carrier], tier, {
          event_type: 'stb_chicago_congestion',
          reason: `STB: ${carrier} Chicago yard dwell +${change.toFixed(1)}% WoW (${formatValue(priorValue)}->${formatValue(latestValue)}h)`,
        });
      }
    }
  }

  for (const [corridor, signal] of Object.entries(bestByCorridor)) {
    out.events.push({
      source: 'stb',
      source_uid: `stb:${corridor}:${out.week}`,
      checksum: `${signal.tier}:${out.week}:${signal.event_type}:${signal.reason}`,
      event_type: signal.event_type,
      severity: signal.tier === 'delayed' ? 'moderate' : 'watch',
      railroad: null,
      location_text: corridor,
      affected_corridors: [corridor],
      scope: 'carrier_wide',
      score: STB_STATUS_SCORE[signal.tier],
      summary: signal.reason,
      evidence_text: signal.reason,
      confidence_score: 0.8,
      start_date: out.week,
      end_date: null,
    });
  }

  return out;
}

module.exports = { collectStb, findLatestUrl, loadSheet };
