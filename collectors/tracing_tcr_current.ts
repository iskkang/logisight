// collectors/tracing_tcr_current.ts
// TCR 현재 운영 지연 ETL — MTL Link `action=list` → tcr_containers_current / tcr_route_segments / tcr_risk_alerts
//
// Run:  npm run collect:tcr:current          (DB 기록)
//       DRY=true npm run collect:tcr:current  (DB 미기록, 매핑만 출력)
//
// 대상 프로젝트: hmg (SUPABASE_URL). /eurasia 현재 지연 뷰(public.tcr_delay_current_snapshot)가 소비한다.
//
// 보안 (CLAUDE.md):
//  - customer_list(PII) 절대 저장 금지 — 매핑에서 제외.
//  - container_no = 내부 upsert 키 (anon revoke 적용됨, 뷰만 노출).
//  - 원본 컨테이너 테이블에 anon grant 금지 (이 스크립트는 grant 안 함).
//
// 계약 (Option i, 2026-06-13):
//  - 세그먼트 eta := 컨테이너 eta_final. 뷰/프론트 변경 없음.
//  - 알려진 한계: eta_final=null 인 red 컨테이너("동일 위치 N일 정체")는 뷰의
//    (s.eta is not null AND d>0) 필터로 지연 지도엔 안 나타난다 → tcr_risk_alerts(severity=high)에만 기록.
//    지도 노출은 후속(스키마+뷰) 작업 필요. 여기서 임의 수치로 채우지 않는다.

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_URL      = process.env.TRACKING_API_URL ?? 'https://link.mtlship.com/api/tcr?action=list';
const API_TOKEN    = process.env.TRACKING_API_TOKEN ?? '';
const DRY          = process.env.DRY === 'true';

// ─── REST helpers (no @supabase/supabase-js — Node fetch only) ────────────────
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}

async function sbUpsert(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} failed: ${res.status} — ${await res.text()}`);
}

async function sbInsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert ${table} failed: ${res.status} — ${await res.text()}`);
}

// PostgREST in.(...) 삭제. ids 는 text(container_no/segment_id) — 따옴표로 감싼다.
async function sbDeleteIn(table: string, column: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const list = ids.map(v => `"${v.replace(/"/g, '')}"`).join(',');
  const url = `${SUPABASE_URL}/rest/v1/${table}?${column}=in.(${encodeURIComponent(list)})`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders({ Prefer: 'return=minimal' }) });
  if (!res.ok) throw new Error(`delete ${table} failed: ${res.status} — ${await res.text()}`);
}

// ─── Raw API type ─────────────────────────────────────────────────────────────
interface RawContainer {
  container_no:         string;
  customer_list:        string;        // ⛔ STRIP — never store
  origin:               string | null;
  destination:          string | null;
  current_location:     string | null;
  latitude:             number | null;
  longitude:            number | null;
  arrived_yn:           boolean;
  signal:               string | null; // green | blue | yellow | red
  signal_reason:        string | null; // KR 텍스트 (예: "동일 위치 14일 정체")
  eta_final:            string | null;  // YYYY-MM-DD
  ata_final:            string | null;
  current_segment_name: string | null; // "A → B"
  open_alert_count:     number | null;
  transport_mode:       string | null; // Rail | Truck
  load_type:            string | null;
}
interface ApiResponse { containers: RawContainer[]; total: number }

// ─── Mapping helpers ──────────────────────────────────────────────────────────
const clean = (v: string | null): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return t === '' || t === '?' ? null : t;
};

// "Kashgar → Andijan" → [from, to]. 구분자 '→'. 2조각 아니면 null.
function splitSegment(name: string | null): { from: string | null; to: string | null } {
  if (!name) return { from: null, to: null };
  const parts = name.split(/\s*→\s*/);
  if (parts.length !== 2) return { from: null, to: null };
  return { from: clean(parts[0]), to: clean(parts[1]) };
}

// signal_reason → alert_type 분류 (자유 텍스트 컬럼 없음 → 카테고리로).
function alertType(reason: string | null): string {
  const r = reason ?? '';
  if (r.includes('정체')) return 'STALLED';            // 동일 위치 N일 정체
  if (r.includes('초과') || r.includes('출발')) return 'DEPARTURE_OVERDUE'; // 출발 N일 초과
  return 'DELAY';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!DRY && (!SUPABASE_URL || !SUPABASE_KEY)) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 없음. (DRY=true 로 미기록 검증 가능)');
    process.exit(1);
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  console.log(`🌐 Fetching ${API_URL} …`);
  const res = await fetch(API_URL, { headers });
  if (!res.ok) throw new Error(`API HTTP ${res.status} — ${await res.text()}`);
  const payload = await res.json() as ApiResponse;
  const containers = payload.containers ?? [];
  console.log(`📦 ${containers.length}건 수신 (API total: ${payload.total})`);

  const nowIso = new Date().toISOString();

  const containerRows: Record<string, unknown>[] = [];
  const segmentRows:   Record<string, unknown>[] = [];
  const alertRows:     Record<string, unknown>[] = [];
  const arrivedSegIds: string[] = [];   // 도착 컨테이너의 stale current-segment 제거용
  const allContainerNos: string[] = []; // 알림 갱신 범위

  for (const c of containers) {
    if (!c.container_no) continue;
    allContainerNos.push(c.container_no);

    // 1) tcr_containers_current — customer_list(PII) 제외
    containerRows.push({
      container_no:         c.container_no,
      origin:               clean(c.origin),
      destination:          clean(c.destination),
      transport_mode:       clean(c.transport_mode),
      current_location:     clean(c.current_location),
      current_location_raw: c.current_location,
      eta_final:            c.eta_final,
      ata_final:            c.ata_final,
      arrived_yn:           c.arrived_yn === true,
      load_type:            clean(c.load_type),
      updated_at:           nowIso,
      // ⛔ customer_list 미저장 / current_location_since·transit_time_days 는 이 소스에 없음 → null
    });

    // 2) tcr_route_segments — 현재 세그먼트 1건 (Option i: eta := eta_final)
    const segId = `${c.container_no}:CUR`;
    if (c.arrived_yn === true) {
      // 도착 → 현재 세그먼트 없음. 이전 :CUR 행이 남아 있으면 제거 (뷰 정합).
      arrivedSegIds.push(segId);
    } else {
      const { from, to } = splitSegment(c.current_segment_name);
      segmentRows.push({
        segment_id:         segId,
        container_no:       c.container_no,
        segment_no:         1,
        segment_name:       clean(c.current_segment_name),
        from_location:      from,
        to_location:        to,
        etd:                null,
        atd:                null,
        eta:                c.eta_final,   // Option i
        ata:                c.ata_final,
        is_current_segment: true,
      });
    }

    // 3) tcr_risk_alerts — red/yellow 만
    const sig = (c.signal ?? '').toLowerCase();
    if (sig === 'red' || sig === 'yellow') {
      alertRows.push({
        container_no: c.container_no,
        alert_type:   alertType(c.signal_reason),
        severity:     sig === 'red' ? 'high' : 'medium',
        status:       'Open',
        updated_at:   nowIso,
      });
    }
  }

  console.log(
    `🧭 매핑: containers=${containerRows.length} · current-segments=${segmentRows.length} ` +
    `· arrived(seg제거)=${arrivedSegIds.length} · alerts(red/yellow)=${alertRows.length}`,
  );

  if (DRY) {
    console.log('\n=== DRY RUN — DB 미기록. 샘플 미리보기 ===');
    console.log('container[0]:', JSON.stringify(containerRows[0], null, 0));
    console.log('segment[0]  :', JSON.stringify(segmentRows[0], null, 0));
    console.log('alert[0]    :', JSON.stringify(alertRows[0], null, 0));
    const eligible = segmentRows.filter(s => s.eta && new Date(String(s.eta)).getTime() < Date.now());
    console.log(`\nℹ️ 뷰 노출 예상(eta_final 지난 current-segment): ${eligible.length}건`);
    return;
  }

  // ── DB 기록 (순서: 컨테이너 → 도착 세그먼트 제거 → 현재 세그먼트 → 알림 갱신) ──
  await sbUpsert('tcr_containers_current', containerRows, 'container_no');
  console.log(`💾 tcr_containers_current upsert: ${containerRows.length}건`);

  await sbDeleteIn('tcr_route_segments', 'segment_id', arrivedSegIds);
  await sbUpsert('tcr_route_segments', segmentRows, 'segment_id');
  console.log(`💾 tcr_route_segments upsert: ${segmentRows.length}건 (도착분 ${arrivedSegIds.length}건 제거)`);

  // 알림: unique 제약 없음 → 처리한 컨테이너 범위의 기존 알림 제거 후 현재 red/yellow 삽입 (멱등).
  await sbDeleteIn('tcr_risk_alerts', 'container_no', allContainerNos);
  await sbInsert('tcr_risk_alerts', alertRows);
  console.log(`💾 tcr_risk_alerts refresh: ${alertRows.length}건 (red/yellow)`);

  console.log('\n✅ collect:tcr:current 완료');
}

main().catch(err => { console.error('❌ tracing_tcr_current 실패:', err); process.exit(1); });
