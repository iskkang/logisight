// Logisight queries adapted to EXISTING Supabase schema.
//
// Tables touched:
//   freight_indices (existing)  → IndexBar (index_code, value, change_pct, week_date)
//   maritime_news   (existing+) → NewsFeed (extended with category, is_hero, agent_type)
//   weekly_briefings, weekly_briefing_points (new) → WeeklyBriefing
//   policy_alerts   (new)       → PolicyMonitor
//   freight_rates   (new)       → KoreaRoutes
//   data_updates    (new)       → IndexBar timestamp
//
// Eurasia routes: 기존 lanes + delay_index_weekly 구조 확인 필요.
// v1에서는 mock 유지, 추후 lanes 데이터 확인 후 통합.

import { createServerClient, hasSupabase } from './server';
import * as mock from '@/lib/mock-data';
import { formatIndexValue, formatTimestamp } from '@/lib/format';
import type {
  NewsArticle, IndexBarItem, RailRoute, PolicyAlert,
  WeeklyBriefingPoint,
} from '@/lib/types';

// ----------------------------------------------------------------------------
// Weekly Briefing
// ----------------------------------------------------------------------------
export interface WeeklyBriefingData {
  title: string;
  subtitle: string | null;
  points: WeeklyBriefingPoint[];
  published_at: string;
}

export async function getLatestBriefing(): Promise<WeeklyBriefingData> {
  const fallback: WeeklyBriefingData = {
    title: '주간 시장 브리핑',
    subtitle: '2026년 5월 4주 · 운임 · 기업 · 글로벌',
    points: mock.MOCK_WEEKLY_BRIEFING,
    published_at: '2026-05-28T09:00:00+09:00',
  };
  if (!hasSupabase) return fallback;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('weekly_briefings')
    .select(`
      title, subtitle, published_at,
      points:weekly_briefing_points (category, agent_type, headline, display_order)
    `)
    .order('week_of', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[getLatestBriefing]', error);
    return fallback;
  }

  const points = (data.points as any[])
    .sort((a, b) => a.display_order - b.display_order)
    .map((p) => ({
      category: p.category,
      agent: p.agent_type,
      headline: p.headline,
    })) as WeeklyBriefingPoint[];

  return {
    title: data.title,
    subtitle: data.subtitle,
    points,
    published_at: data.published_at,
  };
}

// ----------------------------------------------------------------------------
// Freight Indices — 기존 스키마(index_code, value, change_pct, week_date) 사용
// ----------------------------------------------------------------------------
const WANTED_INDICES = ['SCFI', 'WCI', 'FBX', 'KCCI', 'BAI', 'VLSFO'];

export async function getIndices(): Promise<IndexBarItem[]> {
  if (!hasSupabase) return mock.MOCK_INDICES;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('freight_indices')
    .select('index_code, value, change_pct, week_date')
    .order('week_date', { ascending: false })
    .limit(50);

  if (error || !data || data.length === 0) {
    if (error) console.error('[getIndices]', error);
    return mock.MOCK_INDICES;
  }

  // 각 index_code별 최신 행 1개만
  const latestByCode = new Map<string, typeof data[number]>();
  for (const row of data) {
    if (!latestByCode.has(row.index_code)) {
      latestByCode.set(row.index_code, row);
    }
  }

  // 원하는 순서대로 정렬, 없는 코드는 mock에서 보완
  return WANTED_INDICES.map((code): IndexBarItem => {
    const row = latestByCode.get(code);
    if (row && row.value !== null) {
      const change = Number(row.change_pct) || 0;
      return {
        name: code,
        value: formatIndexValue(code, Number(row.value)),
        change_pct: change,
        change_sign: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
      };
    }
    return mock.MOCK_INDICES.find((m) => m.name === code) ?? {
      name: code, value: '—', change_pct: null, change_sign: 'flat',
    };
  });
}

// ----------------------------------------------------------------------------
// News — maritime_news 테이블 사용 (lang='ko' 필터)
// ----------------------------------------------------------------------------
function mapNewsRow(row: any): NewsArticle {
  return {
    id: String(row.id),
    title: row.title,
    summary: row.summary,
    category: row.category,
    agent_type: row.agent_type,
    source_name: row.source,
    source_url: row.url,
    image_url: row.image_url,
    tags: row.tags,
    published_at: row.published_at?.slice(0, 10) ?? '',
  };
}

export async function getHeroNews(): Promise<NewsArticle> {
  if (!hasSupabase) return mock.MOCK_HERO_NEWS;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('maritime_news')
    .select('id, title, summary, url, source, lang, category, agent_type, is_hero, image_url, tags, published_at')
    .eq('is_hero', true)
    .eq('lang', 'ko')
    .not('category', 'is', null)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[getHeroNews]', error);
    return mock.MOCK_HERO_NEWS;
  }

  return mapNewsRow(data);
}

export async function getNewsGrid(limit: number = 4): Promise<NewsArticle[]> {
  if (!hasSupabase) return mock.MOCK_NEWS_GRID;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('maritime_news')
    .select('id, title, summary, url, source, lang, category, agent_type, is_hero, image_url, tags, published_at')
    .or('is_hero.is.null,is_hero.eq.false')
    .eq('lang', 'ko')
    .not('category', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error || !data || data.length === 0) {
    if (error) console.error('[getNewsGrid]', error);
    return mock.MOCK_NEWS_GRID;
  }

  return data.map(mapNewsRow);
}

// ----------------------------------------------------------------------------
// Korea Routes — freight_rates 테이블 (data.go.kr 화물운임공표 적재 대상)
// ----------------------------------------------------------------------------
export interface KoreaRouteData {
  pol_name: string;
  pod_name: string;
  rate_usd: number;
  change_pct: number;
}

export async function getKoreaRoutes(): Promise<KoreaRouteData[]> {
  if (!hasSupabase) return mock.MOCK_KOREA_ROUTES as any;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('freight_rates')
    .select('pol_name, pod_name, rate_usd, weekly_change_pct')
    .eq('is_featured', true)
    .order('display_order', { ascending: true });

  if (error || !data || data.length === 0) {
    if (error) console.error('[getKoreaRoutes]', error);
    return mock.MOCK_KOREA_ROUTES as any;
  }

  return data.map((row) => ({
    pol_name: row.pol_name ?? '',
    pod_name: row.pod_name ?? '',
    rate_usd: Number(row.rate_usd),
    change_pct: Number(row.weekly_change_pct),
  }));
}

// ----------------------------------------------------------------------------
// Eurasia Routes — 추후 lanes + delay_index_weekly 통합 예정
// 현재는 mock 유지 (실데이터 구조 확인 후 SQL view 또는 join 작성)
// ----------------------------------------------------------------------------
export async function getEurasiaRoutes(): Promise<RailRoute[]> {
  // TODO: 기존 lanes + delay_index_weekly 조인하여 실제 데이터 표시
  //   SELECT l.id, l.name_ko, l.transit_min, l.transit_max,
  //          d.on_time_rate, d.median_delay_d
  //   FROM lanes l
  //   LEFT JOIN LATERAL (
  //     SELECT on_time_rate, median_delay_d
  //     FROM delay_index_weekly d
  //     WHERE d.lane_id = l.id
  //     ORDER BY week_iso DESC LIMIT 1
  //   ) d ON true
  //   WHERE l.id IN (...)  -- featured 노선 결정 필요
  return mock.MOCK_EURASIA_ROUTES;
}

// ----------------------------------------------------------------------------
// Policy Alerts
// ----------------------------------------------------------------------------
export async function getPolicyAlerts(): Promise<PolicyAlert[]> {
  if (!hasSupabase) return mock.MOCK_POLICIES;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('policy_alerts')
    .select('code, title, meta')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error || !data || data.length === 0) {
    if (error) console.error('[getPolicyAlerts]', error);
    return mock.MOCK_POLICIES;
  }

  return data as PolicyAlert[];
}

// ----------------------------------------------------------------------------
// Last Updated
// ----------------------------------------------------------------------------
export async function getLastUpdated(): Promise<string> {
  if (!hasSupabase) return mock.LAST_UPDATED;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('data_updates')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return mock.LAST_UPDATED;
  return formatTimestamp(data.updated_at);
}
