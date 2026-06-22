// supabase/functions/risk-refresh/index.ts
// 예보 질의(Open-Meteo) → 리스크 환산 → asset_risk upsert.
// 모든 asset에 대해 horizon(0/3/7/14일)별 강풍·파고·강수 점수를 계산한다.
// service_role 키로 RLS를 우회해 쓰기 (Supabase가 배포 시 env에 자동 주입).
// 호출: npx supabase functions invoke risk-refresh  (또는 step 6 pg_cron).
//
// Open-Meteo 무료 티어는 비상업용. 상용 전환 시 유료 플랜 또는 Meteomatics/StormGlass로 URL만 교체.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HORIZONS = [0, 3, 7, 14];
const clamp = (x: number) => Math.max(0, Math.min(100, x));

function dayMax(a: (number | null)[], d: number) {
  let m = -Infinity;
  for (let i = d * 24; i < d * 24 + 24 && i < a.length; i++) {
    const v = a[i]; if (v != null && !Number.isNaN(v) && v > m) m = v;
  }
  return m === -Infinity ? null : m;
}
function daySum(a: (number | null)[], d: number) {
  let t = 0, any = false;
  for (let i = d * 24; i < d * 24 + 24 && i < a.length; i++) {
    const v = a[i]; if (v != null && !Number.isNaN(v)) { t += v; any = true; }
  }
  return any ? t : null;
}
async function getJSON(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.json();
}

serve(async () => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: assets, error } = await sb.from('assets').select('*');
  if (error) return new Response(error.message, { status: 500 });

  const rows: any[] = [];
  for (const a of assets!) {
    const fcUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${a.lat}&longitude=${a.lon}` +
      `&hourly=wind_gusts_10m,precipitation&wind_speed_unit=ms&forecast_days=16&timezone=UTC`;
    const marUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${a.lat}&longitude=${a.lon}` +
      `&hourly=wave_height&forecast_days=16&timezone=UTC`;

    let gusts: any[] = [], precip: any[] = [], waves: any[] = [];
    try { const fc = await getJSON(fcUrl); gusts = fc.hourly?.wind_gusts_10m ?? []; precip = fc.hourly?.precipitation ?? []; } catch (_) {}
    try { const mar = await getJSON(marUrl); waves = mar.hourly?.wave_height ?? []; } catch (_) {} // 내륙 좌표는 파고 없음 → 무시

    for (const d of HORIZONS) {
      const gust = dayMax(gusts, d);
      const wave = dayMax(waves, d);
      const prcp = daySum(precip, d);
      const windScore = gust == null ? 0 : clamp((gust - 8) / (25 - 8) * 100);   // 8→0, 25m/s→100
      const waveScore = wave == null ? 0 : clamp((wave - 1.5) / (6 - 1.5) * 100); // 1.5→0, 6m→100
      const precScore = prcp == null ? 0 : clamp((prcp - 5) / (40 - 5) * 100);    // 5→0, 40mm→100
      const score = Math.round(0.45 * windScore + 0.40 * waveScore + 0.15 * precScore);
      const level = score >= 60 ? 'r' : score >= 30 ? 'a' : 'g';

      const parts: [string, number, string][] = [
        ['강풍', windScore, gust != null ? `돌풍 ${gust.toFixed(0)}m/s` : ''],
        ['높은 파고', waveScore, wave != null ? `${wave.toFixed(1)}m` : ''],
        ['강수', precScore, prcp != null ? `${prcp.toFixed(0)}mm` : ''],
      ].sort((x, y) => y[1] - x[1]);
      const driver = parts[0][1] >= 20 ? `${parts[0][0]}${parts[0][2] ? ` (${parts[0][2]})` : ''}` : '정상';

      rows.push({ asset_id: a.id, horizon_days: d, score, level, driver, wind_gust: gust, wave_height: wave, precip: prcp });
    }
  }

  const { error: upErr } = await sb.from('asset_risk').upsert(rows, { onConflict: 'asset_id,horizon_days' });
  if (upErr) return new Response(upErr.message, { status: 500 });
  return new Response(JSON.stringify({ updated: rows.length }), { headers: { 'Content-Type': 'application/json' } });
});
