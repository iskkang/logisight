import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

if (existsSync('.env.local')) dotenv.config({ path: '.env.local' });
else dotenv.config();

globalThis.WebSocket = WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { enabled: false },
});

const line = (coordinates) => ({ type: 'LineString', coordinates });

const CORRIDORS = [
  {
    corridor_code: 'LALB_CHI_BNSF',
    name: 'LA/Long Beach -> Chicago (BNSF Southern Transcon)',
    origin_area: 'LA/LB',
    destination_area: 'Chicago',
    railroad: 'BNSF',
    geometry: line([
      [-118.21, 33.77],
      [-117.02, 34.9],
      [-114.61, 34.85],
      [-111.65, 35.2],
      [-106.65, 35.08],
      [-101.83, 35.22],
      [-94.58, 39.1],
      [-87.63, 41.88],
    ]),
  },
  {
    corridor_code: 'LALB_CHI_UP',
    name: 'LA/Long Beach -> Chicago (UP Overland Route)',
    origin_area: 'LA/LB',
    destination_area: 'Chicago',
    railroad: 'UP',
    geometry: line([
      [-118.21, 33.77],
      [-115.14, 36.17],
      [-111.89, 40.76],
      [-104.82, 41.14],
      [-95.94, 41.26],
      [-87.63, 41.88],
    ]),
  },
  {
    corridor_code: 'LALB_DAL_UP',
    name: 'LA/Long Beach -> Dallas (UP Sunset Route)',
    origin_area: 'LA/LB',
    destination_area: 'Dallas',
    railroad: 'UP',
    geometry: line([
      [-118.21, 33.77],
      [-110.97, 32.22],
      [-106.49, 31.76],
      [-96.8, 32.78],
    ]),
  },
  {
    corridor_code: 'VAN_TOR_CN',
    name: 'Vancouver -> Toronto (CN)',
    origin_area: 'Vancouver',
    destination_area: 'Toronto',
    railroad: 'CN',
    geometry: line([
      [-123.12, 49.28],
      [-120.33, 50.68],
      [-113.49, 53.55],
      [-106.67, 52.13],
      [-97.14, 49.9],
      [-89.25, 48.38],
      [-79.38, 43.65],
    ]),
  },
  {
    corridor_code: 'PRR_CHI_CN',
    name: 'Prince Rupert -> Chicago (CN)',
    origin_area: 'Prince Rupert',
    destination_area: 'Chicago',
    railroad: 'CN',
    geometry: line([
      [-130.32, 54.32],
      [-122.75, 53.92],
      [-113.49, 53.55],
      [-106.67, 52.13],
      [-97.14, 49.9],
      [-92.1, 46.79],
      [-87.63, 41.88],
    ]),
  },
];

async function main() {
  const { error: corridorError } = await supabase
    .from('rail_corridors')
    .upsert(CORRIDORS, { onConflict: 'corridor_code' });
  if (corridorError) {
    throw new Error(`rail_corridors upsert failed: ${JSON.stringify(corridorError)}`);
  }

  const updatedAt = new Date().toISOString();
  const statusRows = CORRIDORS.map((corridor) => ({
    corridor_code: corridor.corridor_code,
    status: 'unknown',
    score: null,
    reason: 'Phase 1 seed - data pipeline not connected (Phase 2 planned)',
    source: null,
    active_event_ids: [],
    updated_at: updatedAt,
  }));

  const { error: statusError } = await supabase
    .from('rail_corridor_status')
    .upsert(statusRows, { onConflict: 'corridor_code' });
  if (statusError) {
    throw new Error(`rail_corridor_status upsert failed: ${JSON.stringify(statusError)}`);
  }

  console.log(`seed complete: ${CORRIDORS.length} corridors / all status=unknown`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
