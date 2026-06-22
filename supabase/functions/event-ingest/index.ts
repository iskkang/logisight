// supabase/functions/event-ingest/index.ts
// 전 세계 재해 피드 → events 테이블. NOAA NHC + GDACS + NWS + HKO(태풍) + Meteoalarm(유럽 경보).
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
async function getText(u: string) { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.text(); }
// HKO TC XML은 평탄·고정 스키마(검증 완료) → 원격 XML 파서(stale-import 위험) 대신 태그 정규식 추출.
function tagText(xml: string, name: string): string { const m = xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>')); return m ? m[1].trim() : ''; }
function parseLatLon(v: string): number | null { const m = (v || '').match(/(-?\d+(?:\.\d+)?)\s*([NSEW])?/i); if (!m) return null; let n = parseFloat(m[1]); const d = (m[2] || '').toUpperCase(); if (d === 'S' || d === 'W') n = -n; return Number.isNaN(n) ? null : n; }

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

  // 4) HKO — 북서태평양 활성 태풍 (홍콩천문대 TC Track Info, WMO/상업 재사용 허용).
  //    tc_list.xml(활성 목록) → 각 TC track XML의 <AnalysisInformation>(현재 중심·강도). TC당 정확히 1행.
  //    활성 태풍 없으면 빈 목록 → 정상(에러 아님).
  try {
    const listXml = await getText('https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml');
    const blocks = listXml.match(/<TropicalCyclone>[\s\S]*?<\/TropicalCyclone>/g) || [];
    for (const b of blocks) {
      const id = tagText(b, 'TropicalCycloneID');
      const name = tagText(b, 'TropicalCycloneEnglishName');
      const url = tagText(b, 'TropicalCycloneURL').replace(/^http:/, 'https:');
      if (!id || !url) continue;
      let lat: number | null = null, lon: number | null = null, intensity = '';
      try {
        const trackXml = await getText(url);
        const a = (trackXml.match(/<AnalysisInformation>[\s\S]*?<\/AnalysisInformation>/) || [])[0] || '';
        intensity = tagText(a, 'Intensity');
        lat = parseLatLon(tagText(a, 'Latitude'));   // "17.40N" → 17.40
        lon = parseLatLon(tagText(a, 'Longitude'));  // "127.90E" → 127.90
      } catch (_) {}
      // 강도 매핑: TD/TS → 주의(a), STS·TY·STY·SuperTY → 경보(r).
      const low = /Depression/i.test(intensity) || /^Tropical Storm$/i.test(intensity);
      out.push({ id: 'hko-' + id, source: 'hko', kind: 'cyclone',
        title: (name || 'Tropical Cyclone') + (intensity ? ' (' + intensity + ')' : ''),
        severity: low ? 'a' : 'r', lon, lat, area: '북서태평양', starts_at: null, ends_at: null, url });
    }
  } catch (_) {}

  // 5) Meteoalarm — 유럽 경보 (EUMETNET Atom 피드). 커버국 자산에만 앵커링.
  //    legacy RSS는 2026-01-14 sunset → Atom 사용. orange(awareness_level 3, ≈Severe)+ 만 채택(green/yellow 스킵=노이즈).
  //    Meteoalarm은 지역 단위라 점좌표 없음 → 해당 국가 대표 자산 좌표에 앵커링(국가 단위 근사). 미커버국(RU/BY/TR) 제외.
  const MA: { country: string; assets: string[] }[] = [
    { country: 'finland', assets: ['helsinki', 'kotka'] },
    { country: 'latvia', assets: ['riga'] },
  ];
  try {
    const maIds = MA.flatMap((m) => m.assets);
    const { data: maAssets } = await sb.from('assets').select('id,lon,lat').in('id', maIds);
    const coord: Record<string, { lon: number; lat: number }> = {};
    (maAssets || []).forEach((a: any) => { coord[a.id] = { lon: a.lon, lat: a.lat }; });
    for (const m of MA) {
      const anchorId = m.assets.find((id) => coord[id]);
      if (!anchorId) continue;
      const anchor = coord[anchorId];
      try {
        const xml = await getText(`https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${m.country}`);
        const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) || [];
        let sevSeen = 0;
        entries.forEach((e, i) => {
          const alDigit = (e.match(/awareness_level<\/[^>]+>\s*<[^>]+>\s*(\d)/) || [])[1];
          const al = alDigit ? parseInt(alDigit, 10) : 0;
          const sev = (tagText(e, 'cap:severity') || '').trim();
          if (alDigit || sev) sevSeen++;
          let lvl = '';
          if (al >= 3) lvl = al >= 4 ? 'r' : 'a';                                  // orange(3)→주의, red(4)→경보
          else if (!al) lvl = sev === 'Extreme' ? 'r' : sev === 'Severe' ? 'a' : ''; // 폴백: CAP severity
          if (!lvl) return;                                                        // green/yellow 스킵
          const event = (tagText(e, 'cap:event') || tagText(e, 'event') || '기상 경보').trim();
          const ident = (tagText(e, 'cap:identifier') || tagText(e, 'id') || `${m.country}-${i}`).trim();
          const kind = /flood/i.test(event) ? 'flood' : /snow|ice/i.test(event) ? 'snow' : 'storm';
          out.push({ id: 'meteoalarm-' + ident, source: 'meteoalarm', kind,
            title: event + ' (' + m.country + ')', severity: lvl, lon: anchor.lon, lat: anchor.lat, area: m.country,
            starts_at: tagText(e, 'cap:effective') || null, ends_at: tagText(e, 'cap:expires') || null,
            url: 'https://www.meteoalarm.org/' });
        });
        // silent-zero 가드: 엔트리는 있는데 severity 신호를 하나도 못 읽으면 피드 포맷 변경 의심.
        if (entries.length > 0 && sevSeen === 0) console.warn(`meteoalarm ${m.country}: ${entries.length} entries, 0 severity parsed — feed format?`);
      } catch (_) {}
    }
  } catch (_) {}

  // 피드가 같은 이벤트를 여러 feature/에피소드로 중복 방출할 수 있음 → id 기준 dedup(나중 값 우선).
  // (안 하면 upsert 한 배치에 동일 id 2건 → "ON CONFLICT DO UPDATE command cannot affect row a second time")
  const byId = new Map<string, any>();
  for (const r of out) byId.set(r.id, r);
  const rows = [...byId.values()];

  // 피드는 "현재 활성 집합"이므로 소스별 통째 교체
  await sb.from('events').delete().in('source', ['nhc', 'gdacs', 'nws', 'hko', 'meteoalarm']);
  if (rows.length) { const { error } = await sb.from('events').upsert(rows, { onConflict: 'id' }); if (error) return new Response(error.message, { status: 500 }); }
  return new Response(JSON.stringify({ events: rows.length }), { headers: { 'Content-Type': 'application/json' } });
});
