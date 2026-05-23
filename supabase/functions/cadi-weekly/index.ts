// supabase/functions/cadi-weekly/index.ts
// Returns aggregated delay_index_weekly rows.
// Query params: ?lane_id=TCR&weeks=4 (max 12)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url    = new URL(req.url);
  const laneId = url.searchParams.get('lane_id');
  const weeks  = Math.min(parseInt(url.searchParams.get('weeks') ?? '4', 10), 12);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  // Compute ISO week cutoff (weeks ago)
  const cutoffDate = new Date(Date.now() - weeks * 7 * 86_400_000);
  const jan4 = new Date(cutoffDate.getFullYear(), 0, 4);
  const weekNum = Math.ceil((((cutoffDate.getTime() - jan4.getTime()) / 86_400_000) + jan4.getDay() + 1) / 7);
  const minWeek = `${cutoffDate.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

  let query = supabase
    .from('delay_index_weekly')
    .select('lane_id, week_iso, milestone, median_delay_h, p90_delay_h, on_time_rate, sample_count, data_quality, updated_at')
    .gte('week_iso', minWeek)
    .order('week_iso', { ascending: false });

  if (laneId) query = query.eq('lane_id', laneId);

  const { data, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...CORS,
    },
  });
});
