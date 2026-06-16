// supabase/functions/reports/index.ts
// 주간 리포트(weekly_reports) 서빙.
//   GET /reports            → 발행된 주간 리포트 목록(최신순)
//   GET /reports?week=YYYY-Www → 단건(body_md 포함)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', ...CORS },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );

  const week = new URL(req.url).searchParams.get('week');

  if (week) {
    const { data, error } = await supabase
      .from('weekly_reports')
      .select('week_id, title, period_start, period_end, summary_json, body_md, pdf_url, published_at')
      .eq('week_id', week)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: 'not found' }, 404);
    return json(data);
  }

  const { data, error } = await supabase
    .from('weekly_reports')
    .select('week_id, title, period_start, period_end, pdf_url, published_at')
    .order('week_id', { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json(data ?? []);
});
