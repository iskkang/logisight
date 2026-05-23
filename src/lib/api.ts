// src/lib/api.ts
// Thin wrapper around Supabase Edge Functions.
// All reads use anon key — shipment_legs never exposed.

const BASE_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : '';

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`API ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Lane {
  id: string;
  name_en: string;
  name_zh: string | null;
  name_ru: string | null;
  name_ko: string | null;
  transit_min: number | null;
  transit_max: number | null;
  border_points: string[];
}

export interface DelayRow {
  lane_id: string;
  week_iso: string;
  milestone: string;
  route_pattern: 'kashi' | 'khorgos' | 'northern' | 'tsr' | null;
  destination: string | null;
  median_delay_h: number | null;
  p90_delay_h: number | null;
  median_delay_d: number | null;   // generated: median_delay_h / 24
  p90_delay_d: number | null;      // generated: p90_delay_h / 24
  on_time_rate: number | null;     // fraction 0–1
  otp_pct: number | null;          // generated: on_time_rate * 100
  sample_count: number;
  data_quality: 'confirmed' | 'provisional' | 'indicative';
  methodology_version: string;
  updated_at: string;
}

export interface DisruptionEvent {
  id: string;
  lane_id: string | null;
  event_type: string;
  category: string | null;
  region: string | null;
  title_en: string;
  title_ru: string | null;
  title_zh: string | null;
  title_ko: string | null;
  body_en: string | null;
  impact_days: number | null;
  affected_lanes: string[] | null;
  verified_by: string[] | null;
  severity: 'high' | 'medium' | 'low';
  event_date: string | null;
  started_at: string | null;
  resolved_at: string | null;
  source_url: string | null;
}

export const api = {
  lanes: () => get<Lane[]>('/cadi-lanes'),
  weekly: (laneId?: string, weeks = 4) =>
    get<DelayRow[]>(`/cadi-weekly?${laneId ? `lane_id=${laneId}&` : ''}weeks=${weeks}`),
  alerts: (laneId?: string) =>
    get<DisruptionEvent[]>(`/alerts${laneId ? `?lane_id=${laneId}` : ''}`),
};
