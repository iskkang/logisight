// supabase/functions/event-ingest/index.ts
// 전 세계 재해 피드 → events 테이블. NOAA NHC(열대저기압) + GDACS(다중재해) + NWS(미국 경보).
// 사전 미정의 지역의 새 이벤트를 자동 감지해 핀+알람으로 띄운다. 부분 실패 허용(try/catch).
// 소스별로 "현재 활성 집합"을 통째 교체(delete→upsert). service_role 키로 RLS 우회.
//
// 주의: 피드 필드명(NHC/GDACS 속성)은 실제 응답으로 한 번 확인해 미세 조정할 것.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UA = 'MTL-RiskMonitor/1.0 (logistics ops monitor)';
async function getJSON(u: string) { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.json(); }
function centroid(geom: any): [number | null, number | null] {
  if (!geom) return [null, null];
  const pts: number[][] = []; const walk = (c: any) => { if (typeof c[0] === 'number') pts.push(c); else c.forEach(walk); };
  walk(geom.coordinates); if (!pts.length) return [null, null];
  let x = 0, y = 0; pts.forEach(p => { x += p[0]; y += p[1]; }); return [x / pts.length, y / pts.length];
}

serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const out: any[] = [];

  // 1) NOAA NHC — 활성 열대저기압 (대서양/동태평양)
  try {
    const j = await getJSON('https://www.nhc.noaa.gov/CurrentStorms.json');
    (j.activeStorms || []).forEach((s: any) => {
      const lat = parseFloat(s.latitudeNumeric ?? s.latitude), lon = parseFloat(s.longitudeNumeric ?? s.longitude);
      const hu = (s.classification || '').toUpperCase().includes('HU');
      out.push({ id: 'nhc:' + s.id, source: 'nhc', kind: 'cyclone', title: (s.name || 'Tropical System') + ' (' + (s.classification || '') + ')',
        severity: hu ? 'r' : 'a', lon: isNaN(lon) ? null : lon, lat: isNaN(lat) ? null : lat, area: s.binNumber || 'Atlantic/E-Pacific',
        starts_at: null, ends_at: null, url: 'https://www.nhc.noaa.gov/' });
    });
  } catch (_) {}

  // 2) GDACS — 전 지구 다중재해 (태풍/홍수/산불), Orange+Red만
  try {
    const j = await getJSON('https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP');
    const kindMap: any = { TC: 'cyclone', FL: 'flood', WF: 'storm', DR: 'other' };
    (j.features || []).forEach((f: any) => {
      const p = f.properties || {}; const lvl = (p.alertlevel || '').toLowerCase(); const t = (p.eventtype || '').toUpperCase();
      if ((lvl !== 'orange' && lvl !== 'red') || !kindMap[t]) return;
      const lon = f.geometry?.coordinates?.[0] ?? null, lat = f.geometry?.coordinates?.[1] ?? null;
      out.push({ id: 'gdacs:' + (p.eventid || p.eventname), source: 'gdacs', kind: kindMap[t], title: p.name || p.eventname || t,
        severity: lvl === 'red' ? 'r' : 'a', lon, lat, area: p.country || '', starts_at: p.fromdate || null, ends_at: p.todate || null,
        url: (p.url && p.url.report) || 'https://www.gdacs.org/' });
    });
  } catch (_) {}

  // 3) NWS — 미국 활성 경보 (허리케인/블리자드/겨울폭풍/강풍/홍수)
  try {
    const j = await getJSON('https://api.weather.gov/alerts/active?status=actual&message_type=alert');
    const want = /Hurricane|Tropical Storm|Blizzard|Winter Storm|Ice Storm|High Wind|Flood|Tornado/i;
    (j.features || []).forEach((f: any) => {
      const p = f.properties || {}; if (!want.test(p.event || '')) return;
      const sev = (p.severity || '').toLowerCase(); if (sev !== 'severe' && sev !== 'extreme' && sev !== 'moderate') return;
      const [lon, lat] = centroid(f.geometry);
      out.push({ id: 'nws:' + p.id, source: 'nws',
        kind: /Flood/i.test(p.event) ? 'flood' : /Snow|Winter|Blizzard|Ice/i.test(p.event) ? 'snow' : 'storm',
        title: p.event, severity: (sev === 'moderate') ? 'a' : 'r', lon, lat, area: p.areaDesc || 'US',
        starts_at: p.effective || null, ends_at: p.expires || null, url: 'https://www.weather.gov/' });
    });
  } catch (_) {}

  // 피드가 같은 이벤트를 여러 feature/에피소드로 중복 방출할 수 있음 → id 기준 dedup(나중 값 우선).
  // (안 하면 upsert 한 배치에 동일 id 2건 → "ON CONFLICT DO UPDATE command cannot affect row a second time")
  const byId = new Map<string, any>();
  for (const r of out) byId.set(r.id, r);
  const rows = [...byId.values()];

  // 피드는 "현재 활성 집합"이므로 소스별 통째 교체
  await sb.from('events').delete().in('source', ['nhc', 'gdacs', 'nws']);
  if (rows.length) { const { error } = await sb.from('events').upsert(rows, { onConflict: 'id' }); if (error) return new Response(error.message, { status: 500 }); }
  return new Response(JSON.stringify({ events: rows.length }), { headers: { 'Content-Type': 'application/json' } });
});
