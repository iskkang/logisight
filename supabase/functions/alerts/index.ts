// supabase/functions/alerts/index.ts
// Returns active disruption_events (resolved_at IS NULL).
// Query params: ?lane_id=TCR (optional)
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  let query = supabase
    .from('disruption_events')
    .select('id, lane_id, event_type, title_en, title_ru, title_zh, title_ko, severity, started_at, resolved_at, source_url')
    .is('resolved_at', null)
    .order('severity')
    .limit(20);

  if (laneId) query = query.or(`lane_id.eq.${laneId},lane_id.is.null`);

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
