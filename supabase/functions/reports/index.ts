// supabase/functions/reports/index.ts
// Lists published CADI reports. Currently returns placeholder.
// Phase 7+: replace with Supabase Storage bucket scan.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const placeholder = [
    {
      title: 'CADI 보고서 — 발행 준비 중',
      date: new Date().toISOString().slice(0, 10),
      url: null,
    },
  ];

  return new Response(JSON.stringify(placeholder), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
      ...CORS,
    },
  });
});
