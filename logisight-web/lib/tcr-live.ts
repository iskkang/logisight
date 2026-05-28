// lib/tcr-live.ts
// MTL Link TCR 라이브 API — 서버사이드 전용
// ⚠️  출력에 customer_list / container_no 절대 포함 금지 (집계·익명화만 공개)

const API_URL   = process.env.TRACKING_API_URL   ?? 'https://link.mtlship.com/api/tcr?action=list';
const API_TOKEN = process.env.TRACKING_API_TOKEN ?? '';

// ── 내부 원본 타입 (외부 미노출) ────────────────────────────────────────────
interface RawContainer {
  container_no:         string;   // ⛔ 저장/공개 금지
  customer_list:        string;   // ⛔ 저장/공개 금지
  origin:               string;
  destination:          string;
  current_location:     string | null;
  latitude:             number | null;
  longitude:            number | null;
  signal:               string | null;  // 'blue' | 'green' | 'red'
  eta_final:            string | null;
  ata_final:            string | null;
  current_segment_name: string | null;
  open_alert_count:     number;
  transport_mode:       string | null;
}

interface ApiResponse {
  containers: RawContainer[];
  total:      number;
}

// ── 공개 타입 (집계·익명화 결과만) ─────────────────────────────────────────
export interface AnonPosition {
  lat:    number;
  lng:    number;
  signal: string;   // 'blue' | 'green' | 'red'
  mode:   string | null;
}

export interface ByDestItem {
  dest:      string;
  inTransit: number;
  arrived:   number;
  total:     number;
}

export interface TcrAggregate {
  total:           number;
  inTransitCount:  number;
  arrivedCount:    number;
  alertCount:      number;
  byStatus:        { blue: number; green: number; red: number };
  byDestination:   ByDestItem[];
  bySegment:       Array<{ segment: string; count: number }>;
  byMode:          { Rail: number; Truck: number; other: number };
  anonymizedPositions: AnonPosition[];  // 좌표만, 화주/번호 없음
  fetchedAt:       string;
}

// ── API 호출 ─────────────────────────────────────────────────────────────────
export async function fetchTcrLive(): Promise<RawContainer[]> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
    const res = await fetch(API_URL, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[tcr-live] API HTTP ${res.status}`);
      return [];
    }
    const payload = await res.json() as ApiResponse;
    return payload.containers ?? [];
  } catch (e) {
    console.warn('[tcr-live] fetch failed:', (e as Error).message);
    return [];
  }
}

// ── 익명 집계 ────────────────────────────────────────────────────────────────
export function aggregateTcr(containers: RawContainer[]): TcrAggregate {
  const fetchedAt = new Date().toISOString();

  if (containers.length === 0) {
    return {
      total: 0, inTransitCount: 0, arrivedCount: 0, alertCount: 0,
      byStatus: { blue: 0, green: 0, red: 0 },
      byDestination: [], bySegment: [],
      byMode: { Rail: 0, Truck: 0, other: 0 },
      anonymizedPositions: [],
      fetchedAt,
    };
  }

  let inTransitCount = 0, arrivedCount = 0, alertCount = 0;
  const byStatus  = { blue: 0, green: 0, red: 0 };
  const byDestMap = new Map<string, { inTransit: number; arrived: number }>();
  const bySegMap  = new Map<string, number>();
  const byMode    = { Rail: 0, Truck: 0, other: 0 };
  const positions: AnonPosition[] = [];

  for (const c of containers) {
    const arrived = !!c.ata_final;
    arrived ? arrivedCount++ : inTransitCount++;

    const sig = (c.signal ?? 'blue').toLowerCase();
    if      (sig === 'green') byStatus.green++;
    else if (sig === 'red')   byStatus.red++;
    else                      byStatus.blue++;

    if (sig === 'red' || (c.open_alert_count ?? 0) > 0) alertCount++;

    const dest = c.destination ?? 'Unknown';
    if (!byDestMap.has(dest)) byDestMap.set(dest, { inTransit: 0, arrived: 0 });
    const dm = byDestMap.get(dest)!;
    arrived ? dm.arrived++ : dm.inTransit++;

    const seg = c.current_segment_name ?? '위치 확인 중';
    bySegMap.set(seg, (bySegMap.get(seg) ?? 0) + 1);

    const mode = (c.transport_mode ?? '').toLowerCase();
    if      (mode.includes('rail') || mode.includes('train')) byMode.Rail++;
    else if (mode.includes('truck') || mode.includes('road')) byMode.Truck++;
    else                                                       byMode.other++;

    // 좌표만 포함 — customer_list / container_no 완전 제거
    if (c.latitude != null && c.longitude != null) {
      positions.push({ lat: c.latitude, lng: c.longitude, signal: sig, mode: c.transport_mode ?? null });
    }
  }

  return {
    total: containers.length,
    inTransitCount,
    arrivedCount,
    alertCount,
    byStatus,
    byDestination: [...byDestMap.entries()]
      .map(([dest, d]) => ({ dest, inTransit: d.inTransit, arrived: d.arrived, total: d.inTransit + d.arrived }))
      .sort((a, b) => b.total - a.total),
    bySegment: [...bySegMap.entries()]
      .map(([segment, count]) => ({ segment, count }))
      .sort((a, b) => b.count - a.count),
    byMode,
    anonymizedPositions: positions,
    fetchedAt,
  };
}
