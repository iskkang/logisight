// supabase/functions/event-ingest/index.ts
// 전 세계 재해 피드 → events 테이블. NOAA NHC + GDACS + NWS + HKO(태풍) + Meteoalarm(유럽 경보).
// 사전 미정의 지역의 새 이벤트를 자동 감지해 핀+알람으로 띄운다. 부분 실패 허용(try/catch).
// 소스별로 "현재 활성 집합"을 통째 교체(delete→upsert). service_role 키로 RLS 우회.
//
// 주의: 피드 필드명(NHC/GDACS 속성)은 실제 응답으로 한 번 확인해 미세 조정할 것.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UA = 'MTL-RiskMonitor/1.0 (logistics ops monitor)';
// 업스트림이 응답을 안 주면 워커 wall-clock을 그대로 소진해 WORKER_RESOURCE_LIMIT(546)로 죽는다 → 소스별 상한.
const TIMEOUT_MS = 15_000;
async function getJSON(u: string) { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.json(); }
function centroid(geom: any): [number | null, number | null] {
  if (!geom) return [null, null];
  // 좌표를 배열에 모으면 대형 폴리곤(NWS 경보)에서 메모리·CPU가 튄다 → 합계만 누적.
  let x = 0, y = 0, n = 0;
  const walk = (c: any) => { if (typeof c[0] === 'number') { x += c[0]; y += c[1]; n++; } else c.forEach(walk); };
  walk(geom.coordinates); if (!n) return [null, null];
  return [x / n, y / n];
}
async function getText(u: string) { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.text(); }
// HKO TC XML은 평탄·고정 스키마(검증 완료) → 원격 XML 파서(stale-import 위험) 대신 태그 정규식 추출.
function tagText(xml: string, name: string): string { const m = xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>')); return m ? m[1].trim() : ''; }
function parseLatLon(v: string): number | null { const m = (v || '').match(/(-?\d+(?:\.\d+)?)\s*([NSEW])?/i); if (!m) return null; let n = parseFloat(m[1]); const d = (m[2] || '').toUpperCase(); if (d === 'S' || d === 'W') n = -n; return Number.isNaN(n) ? null : n; }

serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1) NOAA NHC — 활성 열대저기압 (대서양/동태평양)
  const nhc = async () => {
  const out: any[] = [];
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
  return out;
  };

  // 2) GDACS — 전 지구 다중재해 (태풍/홍수/산불/지진/쓰나미), Orange+Red만
  //    EQ/TS는 점 이벤트(트랙 없음) → (b) judge가 이벤트 심각도 기반 광역반경으로 passage 교차판정.
  //    (VO 화산은 범위 외 — 추가하지 않음.)
  const gdacs = async () => {
  const out: any[] = [];
  try {
    const j = await getJSON('https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP');
    const kindMap: any = { TC: 'cyclone', FL: 'flood', WF: 'storm', DR: 'other', EQ: 'earthquake', TS: 'tsunami' };
    (j.features || []).forEach((f: any) => {
      const p = f.properties || {}; const lvl = (p.alertlevel || '').toLowerCase(); const t = (p.eventtype || '').toUpperCase();
      if ((lvl !== 'orange' && lvl !== 'red') || !kindMap[t]) return;
      // GDACS는 같은 이벤트를 Point(진앙/중심)와 Polygon(영향권 링) 에피소드로 함께 방출 →
      // coordinates[0]을 lon으로 단정하면 Polygon에선 배열이 들어가 upsert 타입오류(500). centroid로 Point·Polygon 모두 처리(NWS와 동일).
      const [lon, lat] = centroid(f.geometry);
      // EQ/TS는 순간 이벤트 → GDACS todate==fromdate. ends_at으로 두면 프론트가 '만료'로 보고 ~1h 뒤 핀을 숨김.
      // null로(=종료시각 없음). 수명은 GDACS 활성집합(매 run delete→upsert)이 관리.
      const pointInTime = kindMap[t] === 'earthquake' || kindMap[t] === 'tsunami';
      out.push({ id: 'gdacs:' + (p.eventid || p.eventname), source: 'gdacs', kind: kindMap[t], title: p.name || p.eventname || t,
        severity: lvl === 'red' ? 'r' : 'a', lon, lat, area: p.country || '', starts_at: p.fromdate || null, ends_at: pointInTime ? null : (p.todate || null),
        url: (p.url && p.url.report) || 'https://www.gdacs.org/' });
    });
  } catch (_) {}
  return out;
  };

  // 3) NWS — 미국 활성 경보 (허리케인/블리자드/겨울폭풍/강풍/홍수)
  //    severity는 서버측 필터로 좁힌다 — 전량(수 MB, 대형 폴리곤 다수)을 받아 centroid를 돌리면 CPU/메모리 한도에 걸린다.
  const nws = async () => {
  const out: any[] = [];
  try {
    const j = await getJSON('https://api.weather.gov/alerts/active?status=actual&message_type=alert&severity=Extreme,Severe,Moderate');
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
  } catch (e) { console.warn('nws:', e instanceof Error ? e.message : e); }  // severity 파라미터 거부(400)를 조용히 삼키지 않도록 로깅
  return out;
  };

  // 4) HKO — 북서태평양 활성 태풍 (홍콩천문대 TC Track Info, WMO/상업 재사용 허용).
  //    tc_list.xml(활성 목록) → 각 TC track XML의 <AnalysisInformation>(현재 중심·강도)
  //    + <ForecastInformation>(예보 폴리라인) → track 적재((b) 교차판정용). TC당 정확히 1행.
  //    활성 태풍 없으면 빈 목록 → 정상(에러 아님).
  //    TC별 track XML은 병렬 — 순차로 돌리면 활성 태풍 수만큼 지연이 곱해진다.
  const hko = async () => {
  const out: any[] = [];
  try {
    const listXml = await getText('https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml');
    const blocks = listXml.match(/<TropicalCyclone>[\s\S]*?<\/TropicalCyclone>/g) || [];
    await Promise.all(blocks.map(async (b) => {
      const id = tagText(b, 'TropicalCycloneID');
      const name = tagText(b, 'TropicalCycloneEnglishName');
      const url = tagText(b, 'TropicalCycloneURL').replace(/^http:/, 'https:');
      if (!id || !url) return;
      let lat: number | null = null, lon: number | null = null, intensity = '';
      let track: number[][] | null = null;
      try {
        const trackXml = await getText(url);
        const a = (trackXml.match(/<AnalysisInformation>[\s\S]*?<\/AnalysisInformation>/) || [])[0] || '';
        intensity = tagText(a, 'Intensity');
        lat = parseLatLon(tagText(a, 'Latitude'));   // "17.40N" → 17.40
        lon = parseLatLon(tagText(a, 'Longitude'));  // "127.90E" → 127.90
        // 예보 폴리라인: <ForecastInformation> 각 블록의 위경도를 점열로. 현재 분석점을 선두에 둔다.
        const pts: number[][] = [];
        if (lon != null && lat != null) pts.push([lon, lat]);
        for (const fb of trackXml.match(/<ForecastInformation>[\s\S]*?<\/ForecastInformation>/g) || []) {
          const flat = parseLatLon(tagText(fb, 'Latitude'));
          const flon = parseLatLon(tagText(fb, 'Longitude'));
          if (flat != null && flon != null) pts.push([flon, flat]);
        }
        track = pts.length ? pts : null;
      } catch (_) {}
      // 강도 매핑: TD/TS → 주의(a), STS·TY·STY·SuperTY → 경보(r).
      const low = /Depression/i.test(intensity) || /^Tropical Storm$/i.test(intensity);
      out.push({ id: 'hko-' + id, source: 'hko', kind: 'cyclone',
        title: (name || 'Tropical Cyclone') + (intensity ? ' (' + intensity + ')' : ''),
        severity: low ? 'a' : 'r', lon, lat, area: '북서태평양', starts_at: null, ends_at: null, url, track });
    }));
  } catch (_) {}
  return out;
  };

  // 5) Meteoalarm — 유럽 경보 (EUMETNET Atom 피드). 커버국 자산에만 앵커링.
  //    legacy RSS는 2026-01-14 sunset → Atom 사용. orange(awareness_level 3, ≈Severe)+ 만 채택(green/yellow 스킵=노이즈).
  //    Meteoalarm은 지역 단위라 점좌표 없음 → 해당 국가 대표 자산 좌표에 앵커링(국가 단위 근사). 미커버국(RU/BY/TR) 제외.
  const MA: { country: string; assets: string[] }[] = [
    { country: 'finland', assets: ['helsinki', 'kotka'] },
    { country: 'latvia', assets: ['riga'] },
  ];
  const meteoalarm = async () => {
  const out: any[] = [];
  try {
    const maIds = MA.flatMap((m) => m.assets);
    const { data: maAssets } = await sb.from('assets').select('id,lon,lat').in('id', maIds);
    const coord: Record<string, { lon: number; lat: number }> = {};
    (maAssets || []).forEach((a: any) => { coord[a.id] = { lon: a.lon, lat: a.lat }; });
    await Promise.all(MA.map(async (m) => {
      const anchorId = m.assets.find((id) => coord[id]);
      if (!anchorId) return;
      const anchor = coord[anchorId];
      try {
        const xml = await getText(`https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${m.country}`);
        const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) || [];
        let sevSeen = 0;
        // 같은 경보의 재발령(다른 cap:identifier·다른 effective)을 (국가|경보종류)로 1건으로 합침 —
        // 가장 최근 effective만 채택. 서로 다른 경보(고온/홍수 등)는 제목이 달라 분리 유지.
        const maByType = new Map<string, any>();
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
          const eff = tagText(e, 'cap:effective') || null;
          const row = { id: 'meteoalarm-' + ident, source: 'meteoalarm', kind,
            title: event + ' (' + m.country + ')', severity: lvl, lon: anchor.lon, lat: anchor.lat, area: m.country,
            starts_at: eff, ends_at: tagText(e, 'cap:expires') || null,
            url: 'https://www.meteoalarm.org/' };
          const key = `${m.country}|${event}`;
          const prev = maByType.get(key);
          // effective 최신 우선(문자열 ISO 비교). effective 없으면 피드 후순위(나중 등장)를 최신으로 간주.
          if (!prev || (eff || '') >= (prev.starts_at || '')) maByType.set(key, row);
        });
        for (const row of maByType.values()) out.push(row);
        // silent-zero 가드: 엔트리는 있는데 severity 신호를 하나도 못 읽으면 피드 포맷 변경 의심.
        if (entries.length > 0 && sevSeen === 0) console.warn(`meteoalarm ${m.country}: ${entries.length} entries, 0 severity parsed — feed format?`);
      } catch (_) {}
    }));
  } catch (_) {}
  return out;
  };

  // 소스별로 순차 await하면 지연이 합산돼 워커 wall-clock 한도를 넘긴다 → 병렬 수집, 부분 실패 허용.
  const settled = await Promise.allSettled([nhc(), gdacs(), nws(), hko(), meteoalarm()]);
  const out = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));

  // 피드가 같은 이벤트를 여러 feature/에피소드로 중복 방출할 수 있음 → id 기준 dedup(나중 값 우선).
  // (안 하면 upsert 한 배치에 동일 id 2건 → "ON CONFLICT DO UPDATE command cannot affect row a second time")
  const byId = new Map<string, any>();
  for (const r of out) byId.set(r.id, r);
  const rows = [...byId.values()];
  // 컬럼 균일화: HKO만 track 보유 → 나머지는 null로 채워 upsert 컬럼 추론 일관성 확보.
  for (const r of rows) if (!('track' in r)) r.track = null;

  // 피드는 "현재 활성 집합"이므로 소스별 통째 교체
  await sb.from('events').delete().in('source', ['nhc', 'gdacs', 'nws', 'hko', 'meteoalarm']);
  if (rows.length) { const { error } = await sb.from('events').upsert(rows, { onConflict: 'id' }); if (error) return new Response(error.message, { status: 500 }); }
  return new Response(JSON.stringify({ events: rows.length }), { headers: { 'Content-Type': 'application/json' } });
});
