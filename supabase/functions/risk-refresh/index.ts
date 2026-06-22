// supabase/functions/risk-refresh/index.ts
// 해저드별 위험식 (해상=강풍·파고, 철도=폭설·한파, 결빙항만=기온) — 최악 해저드 등급이 결정.
// g/a/r 컷오프는 상단 CUT 상수(운영 디폴트, 미보정)에 중앙화 — 거기 숫자만 바꾸면 전체 반영.
// 예보 질의(Open-Meteo) → 자산 타입별 환산 → asset_risk upsert.
// service_role 키로 RLS 우회 (Supabase가 배포 시 env 자동 주입). 호출: functions invoke risk-refresh.
//
// Open-Meteo 무료 티어는 비상업용. 상용 전환 시 유료 플랜 또는 Meteomatics/StormGlass로 URL만 교체.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HORIZONS = [0, 3, 7, 14];
const clamp = (x: number) => Math.max(0, Math.min(100, x));

// ── g/a/r 임계값 (승인된 운영 디폴트) ──────────────────────────────────────
// expert/literature operational default, NOT statistically calibrated; tune here.
// 향후 delay 데이터 누적 시 재보정. 요청 단위 기준: wind m/s, wave m, snow cm/일, temp °C.
const CUT = {
  wind: { a: 14, r: 20 },    // 풍속 m/s (≈50 / 72 km/h). 돌풍(wind_gusts_10m) 측정값에 적용. 높을수록 위험(≥).
  wave: { a: 3, r: 4.5 },     // 유의파고 Hs(m). ≥.
  snow: { a: 5, r: 15 },      // 일 강설(cm). ≥.
  temp: { a: -20, r: -35 },   // 일최저기온(°C). 낮을수록 위험(≤).
};
// 측정값 → 0..100 점수. amber 컷오프 ↦ 30, red 컷오프 ↦ 60 (temp는 red<amber라 부호 자동 처리).
function hscore(v: number, c: { a: number; r: number }) { return clamp((v - c.a) / (c.r - c.a) * 30 + 30); }
function dayMax(a: (number | null)[], d: number) { let m = -Infinity; for (let i = d * 24; i < d * 24 + 24 && i < a.length; i++) { const v = a[i]; if (v != null && !Number.isNaN(v) && v > m) m = v; } return m === -Infinity ? null : m; }
function dayMin(a: (number | null)[], d: number) { let m = Infinity; for (let i = d * 24; i < d * 24 + 24 && i < a.length; i++) { const v = a[i]; if (v != null && !Number.isNaN(v) && v < m) m = v; } return m === Infinity ? null : m; }
function daySum(a: (number | null)[], d: number) { let t = 0, any = false; for (let i = d * 24; i < d * 24 + 24 && i < a.length; i++) { const v = a[i]; if (v != null && !Number.isNaN(v)) { t += v; any = true; } } return any ? t : null; }
async function getJSON(u: string) { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.json(); }

serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: assets, error } = await sb.from('assets').select('*');
  if (error) return new Response(error.message, { status: 500 });

  const rows: any[] = [];
  for (const a of assets!) {
    const isSea = a.type === 'port' || a.type === 'choke';
    const fc = `https://api.open-meteo.com/v1/forecast?latitude=${a.lat}&longitude=${a.lon}` +
      `&hourly=wind_gusts_10m,precipitation,snowfall,temperature_2m&wind_speed_unit=ms&forecast_days=16&timezone=UTC`;
    let gusts: any[] = [], precip: any[] = [], snow: any[] = [], temp: any[] = [], waves: any[] = [];
    try { const j = await getJSON(fc); gusts = j.hourly?.wind_gusts_10m ?? []; precip = j.hourly?.precipitation ?? []; snow = j.hourly?.snowfall ?? []; temp = j.hourly?.temperature_2m ?? []; } catch (_) {}
    if (isSea) { try { const m = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${a.lat}&longitude=${a.lon}&hourly=wave_height&forecast_days=16&timezone=UTC`); waves = m.hourly?.wave_height ?? []; } catch (_) {} }

    for (const d of HORIZONS) {
      const gust = dayMax(gusts, d), wave = dayMax(waves, d), prcp = daySum(precip, d), snowS = daySum(snow, d), tmin = dayMin(temp, d);
      const cand: [string, number, string][] = [];
      if (isSea) {
        if (gust != null) cand.push(['강풍', hscore(gust, CUT.wind), `돌풍 ${gust.toFixed(0)}m/s`]);
        if (wave != null) cand.push(['높은 파고', hscore(wave, CUT.wave), `${wave.toFixed(1)}m`]);
      }
      if (a.type === 'rail') {
        if (snowS != null) cand.push(['폭설', hscore(snowS, CUT.snow), `${snowS.toFixed(0)}cm`]);
        if (tmin != null)  cand.push(['한파', hscore(tmin, CUT.temp), `${tmin.toFixed(0)}℃`]);
      }
      let isFreeze = false;
      if (a.freeze_prone && tmin != null) { const fs = hscore(tmin, CUT.temp); cand.push(['결빙', fs, `일최저 ${tmin.toFixed(0)}℃`]); if (fs >= 30) isFreeze = true; }
      // precip(강수)는 운영 임계 세트에 미포함 → 점수 미반영, 측정값만 컬럼 기록.

      cand.sort((x, y) => y[1] - x[1]);
      const top = cand[0] || ['정상', 0, ''];
      const score = Math.round(top[1]);                       // 최악 해저드 등급이 점수 결정
      const level = score >= 60 ? 'r' : score >= 30 ? 'a' : 'g';
      const driver = score >= 30 ? `${top[0]}${top[2] ? ` (${top[2]})` : ''}` : '정상';
      rows.push({ asset_id: a.id, horizon_days: d, score, level, driver, wind_gust: gust, wave_height: wave, precip: prcp, snowfall: snowS, temp_min: tmin, is_freeze: isFreeze });
    }
  }
  const { error: up } = await sb.from('asset_risk').upsert(rows, { onConflict: 'asset_id,horizon_days' });
  if (up) return new Response(up.message, { status: 500 });
  return new Response(JSON.stringify({ updated: rows.length }), { headers: { 'Content-Type': 'application/json' } });
});
