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
import { HS_CHAPTERS } from '@/lib/hs-chapters';
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
// Freight Indices
//   freight_indices: WCI, FBX, BDI, SCFI, KCCI  (실제 수집)
//   bunker_prices:   VLSFO Singapore              (별도 테이블)
//   BAI:             air_indices DB 미저장 → 항상 '—'
// ----------------------------------------------------------------------------
const FREIGHT_CODES = ['SCFI', 'CCFI', 'KCCI'];

export async function getIndices(): Promise<IndexBarItem[]> {
  if (!hasSupabase) return mock.MOCK_INDICES;

  const supabase = createServerClient();

  const [freightRes, bunkerRes] = await Promise.all([
    supabase
      .from('freight_indices')
      .select('index_code, value, change_pct, week_date, source')
      .in('index_code', FREIGHT_CODES)
      .order('week_date', { ascending: false })
      .limit(25),
    supabase
      .from('bunker_prices')
      .select('price_usd, obs_date, source')
      .eq('grade', 'VLSFO')
      .eq('port', 'Singapore')
      .order('obs_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (freightRes.error) console.error('[getIndices freight]', freightRes.error);
  if (bunkerRes.error)  console.error('[getIndices bunker]',  bunkerRes.error);

  // 코드별 최신 행
  const latestByCode = new Map<string, {
    value: number | null; change_pct: number | null;
    week_date: string | null; source: string | null;
  }>();
  for (const row of freightRes.data ?? []) {
    if (!latestByCode.has(row.index_code)) latestByCode.set(row.index_code, row);
  }

  function fromFreight(code: string): IndexBarItem {
    const row = latestByCode.get(code);
    if (row && row.value !== null) {
      const chg = Number(row.change_pct) || 0;
      return {
        name: code,
        value: formatIndexValue(code, Number(row.value)),
        change_pct: chg,
        change_sign: chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat',
        source: row.source ?? undefined,
        week_date: row.week_date ?? undefined,
      };
    }
    return { name: code, value: '—', change_pct: null, change_sign: 'flat' };
  }

  const bunker = bunkerRes.data;
  const vlsfoItem: IndexBarItem = bunker
    ? {
        name: 'VLSFO',
        value: formatIndexValue('VLSFO', Number(bunker.price_usd)),
        change_pct: null,
        change_sign: 'flat',
        source: bunker.source ?? 'Ship & Bunker',
        week_date: bunker.obs_date ?? undefined,
      }
    : { name: 'VLSFO', value: '—', change_pct: null, change_sign: 'flat', source: 'Ship & Bunker' };

  return [
    fromFreight('SCFI'),
    fromFreight('CCFI'),
    fromFreight('KCCI'),
    vlsfoItem,
  ];
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
    slug: row.slug ?? undefined,
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
    .select('id, title, summary, url, source, lang, category, agent_type, is_hero, image_url, tags, published_at, slug')
    .or('is_hero.is.null,is_hero.eq.false')
    .eq('lang', 'ko')
    .not('category', 'is', null)
    .neq('agent_type', 'daily_card')
    .neq('agent_type', 'external')
    .not('content', 'is', null)
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
// Eurasia Routes — lanes + delay_index_weekly 조인
// ----------------------------------------------------------------------------
function mapLaneToRailRoute(lane: any, delay: any | null): RailRoute {
  const id: string = lane.id;
  const bp: string[] = lane.border_points ?? [];

  const origin = id.startsWith('KR') ? '부산' : '중국';
  const destination = lane.name_ko
    .replace(/^(KR|CN)-/, '')
    .replace(/\s*\(.+\)$/, '')
    .trim();

  const via = bp.includes('Kashi') ? '카시 경유'
    : bp.includes('Khorgos') ? '코르고스 경유'
    : bp.includes('Dostyk') ? '도스틱 경유'
    : bp.includes('Vladivostok') ? '블라디 경유'
    : undefined;

  const routeType: 'TCR' | 'TSR' = bp.includes('Vladivostok') ? 'TSR' : 'TCR';

  let status: '정상' | '지연주의' | '운휴' = '정상';
  if (delay?.on_time_rate !== null && delay?.on_time_rate !== undefined) {
    const otr = Number(delay.on_time_rate);
    if (otr < 0.70) status = '운휴';
    else if (otr < 0.85) status = '지연주의';
  }

  return {
    route_type: routeType,
    origin,
    destination,
    via,
    transit_days: lane.transit_min,
    status,
  };
}

export async function getEurasiaRoutes(): Promise<RailRoute[]> {
  if (!hasSupabase) return mock.MOCK_EURASIA_ROUTES;

  const supabase = createServerClient();
  const { data: lanes, error } = await supabase
    .from('lanes')
    .select('id, name_ko, transit_min, transit_max, border_points')
    .eq('is_featured', true)
    .order('display_order', { ascending: true })
    .limit(3);

  if (error || !lanes || lanes.length === 0) {
    if (error) console.error('[getEurasiaRoutes]', error);
    return mock.MOCK_EURASIA_ROUTES;
  }

  const laneIds = lanes.map((l: any) => l.id);
  const { data: delays } = await supabase
    .from('delay_index_weekly')
    .select('lane_id, on_time_rate, median_delay_d, week_iso')
    .in('lane_id', laneIds)
    .order('week_iso', { ascending: false });

  const latestDelay = new Map<string, any>();
  for (const d of delays ?? []) {
    if (!latestDelay.has(d.lane_id)) latestDelay.set(d.lane_id, d);
  }

  return lanes.map((lane: any) => mapLaneToRailRoute(lane, latestDelay.get(lane.id) ?? null));
}

// ----------------------------------------------------------------------------
// All Lanes — /eurasia 페이지용 전체 목록
// ----------------------------------------------------------------------------
export interface LaneRow {
  id: string;
  name_ko: string;
  name_en: string;
  transit_min: number;
  transit_max: number;
  border_points: string[];
  is_featured: boolean;
  on_time_rate: number | null;
  median_delay_d: number | null;
}

export async function getLanesAll(): Promise<LaneRow[]> {
  if (!hasSupabase) return [];

  const supabase = createServerClient();
  const { data: lanes, error } = await supabase
    .from('lanes')
    .select('id, name_ko, name_en, transit_min, transit_max, border_points, is_featured')
    .like('id', 'KR-%')
    .order('is_featured', { ascending: false });

  if (error || !lanes) {
    if (error) console.error('[getLanesAll]', error);
    return [];
  }

  const laneIds = lanes.map((l: any) => l.id);
  const { data: delays } = await supabase
    .from('delay_index_weekly')
    .select('lane_id, on_time_rate, median_delay_d, week_iso')
    .in('lane_id', laneIds)
    .order('week_iso', { ascending: false });

  const latestDelay = new Map<string, any>();
  for (const d of delays ?? []) {
    if (!latestDelay.has(d.lane_id)) latestDelay.set(d.lane_id, d);
  }

  return lanes.map((l: any) => ({
    id: l.id,
    name_ko: l.name_ko,
    name_en: l.name_en,
    transit_min: l.transit_min,
    transit_max: l.transit_max,
    border_points: l.border_points ?? [],
    is_featured: l.is_featured ?? false,
    on_time_rate: latestDelay.get(l.id)?.on_time_rate ?? null,
    median_delay_d: latestDelay.get(l.id)?.median_delay_d ?? null,
  }));
}

// ----------------------------------------------------------------------------
// Delay History — /eurasia 차트용 (최근 12주)
// ----------------------------------------------------------------------------
export interface DelayPoint {
  week_iso: string;
  lane_id: string;
  on_time_rate: number;
}

export async function getDelayHistory(): Promise<DelayPoint[]> {
  if (!hasSupabase) return [];

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('delay_index_weekly')
    .select('lane_id, week_iso, on_time_rate')
    .like('lane_id', 'KR-%')
    .order('week_iso', { ascending: true })
    .limit(120); // 최대 12주 × 10개 레인

  if (error || !data) {
    if (error) console.error('[getDelayHistory]', error);
    return [];
  }

  return data
    .filter((d: any) => d.on_time_rate !== null)
    .map((d: any) => ({
      week_iso: d.week_iso,
      lane_id: d.lane_id,
      on_time_rate: Number(d.on_time_rate),
    }));
}

// ----------------------------------------------------------------------------
// Active Disruptions — /eurasia 하단
// ----------------------------------------------------------------------------
export interface DisruptionEvent {
  id: string;
  lane_id: string;
  category: string;
  title_ko: string;
  severity: string;
  started_at: string;
}

export async function getActiveDisruptions(): Promise<DisruptionEvent[]> {
  if (!hasSupabase) return [];

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('disruption_events')
    .select('id, lane_id, category, title_ko, severity, started_at')
    .is('resolved_at', null)
    .order('started_at', { ascending: false })
    .limit(10);

  if (error || !data) {
    if (error) console.error('[getActiveDisruptions]', error);
    return [];
  }

  return data as DisruptionEvent[];
}

// ----------------------------------------------------------------------------
// Blank Sailings Stat — Hero 블랭크 스탯
// ----------------------------------------------------------------------------
export async function getBlankSailingsStat(): Promise<string> {
  if (!hasSupabase) return mock.MOCK_HERO_STATS[3].value;

  const supabase = createServerClient();
  const { data: latest } = await supabase
    .from('blank_sailings')
    .select('week_start')
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) return mock.MOCK_HERO_STATS[3].value;

  const { count } = await supabase
    .from('blank_sailings')
    .select('*', { count: 'exact', head: true })
    .eq('week_start', latest.week_start);

  if (count === null || count === 0) return mock.MOCK_HERO_STATS[3].value;
  return `${count}편`;
}

// ----------------------------------------------------------------------------
// News List — /news 페이지용 (카테고리 + 커서 페이지네이션)
// ----------------------------------------------------------------------------
export interface NewsListResult {
  articles: NewsArticle[];
  hasMore: boolean;
}

export async function getNewsList({
  category,
  before,
  limit = 20,
}: {
  category?: string;
  before?: string;
  limit?: number;
}): Promise<NewsListResult> {
  if (!hasSupabase) {
    return { articles: [...mock.MOCK_NEWS_GRID, ...mock.MOCK_NEWS_GRID], hasMore: false };
  }

  const supabase = createServerClient();
  let query = supabase
    .from('maritime_news')
    .select('id, title, summary, url, source, lang, category, agent_type, image_url, published_at, slug')
    .eq('lang', 'ko')
    .not('category', 'is', null)
    .neq('agent_type', 'daily_card')
    .neq('agent_type', 'external')
    .not('content', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit + 1);

  if (category) query = query.eq('category', category);
  if (before) query = query.lt('published_at', before);

  const { data, error } = await query;

  if (error || !data) {
    if (error) console.error('[getNewsList]', error);
    return { articles: mock.MOCK_NEWS_GRID, hasMore: false };
  }

  const hasMore = data.length > limit;
  const articles = (hasMore ? data.slice(0, limit) : data).map(mapNewsRow);
  return { articles, hasMore };
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

// ----------------------------------------------------------------------------
// Freight Rates All — /rates 페이지
// ----------------------------------------------------------------------------
export interface FreightRateRow {
  pol_code: string;
  pol_name: string;
  pod_code: string;
  pod_name: string;
  container_type: string;
  rate_usd: number | null;
  weekly_change_pct: number | null;
  carrier: string | null;
  data_source: string;
  valid_from: string | null;
}

export async function getRatesAll({
  pol,
  type,
}: {
  pol?: string;
  type?: string;
} = {}): Promise<FreightRateRow[]> {
  if (!hasSupabase) return [];

  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from('freight_rates')
    .select(
      'pol_code, pol_name, pod_code, pod_name, container_type, rate_usd, weekly_change_pct, carrier, data_source, valid_from, valid_until, display_order'
    )
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order('display_order', { ascending: true });

  if (pol) query = (query as any).eq('pol_code', pol);
  if (type) query = (query as any).eq('container_type', type);

  const { data, error } = await query;

  if (error || !data) {
    if (error) console.error('[getRatesAll]', error);
    return [];
  }

  return (data as any[]).map((row) => ({
    pol_code: row.pol_code ?? '',
    pol_name: row.pol_name ?? row.pol_code ?? '',
    pod_code: row.pod_code ?? '',
    pod_name: row.pod_name ?? row.pod_code ?? '',
    container_type: row.container_type ?? '',
    rate_usd: row.rate_usd !== null ? Number(row.rate_usd) : null,
    weekly_change_pct: row.weekly_change_pct !== null ? Number(row.weekly_change_pct) : null,
    carrier: row.carrier ?? null,
    data_source: row.data_source ?? '',
    valid_from: row.valid_from ?? null,
  }));
}

// ----------------------------------------------------------------------------
// Policy News — /policy 페이지
// category='무역' OR tags overlap with policy keywords
// ----------------------------------------------------------------------------
const POLICY_TAGS = ['정책', '규제', '관세', '제재', 'CBAM', 'ETS'];

export async function getPolicyNews(limit = 8): Promise<NewsArticle[]> {
  if (!hasSupabase) return mock.MOCK_NEWS_GRID.slice(0, limit);

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('maritime_news')
    .select('id, title, summary, url, source, lang, category, agent_type, image_url, published_at, slug')
    .eq('lang', 'ko')
    .or(`category.eq.무역,tags.ov.{${POLICY_TAGS.join(',')}}`)
    .neq('agent_type', 'daily_card')
    .neq('agent_type', 'external')
    .not('content', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) console.error('[getPolicyNews]', error);
    return mock.MOCK_NEWS_GRID.slice(0, limit);
  }

  return data.map(mapNewsRow);
}

// ----------------------------------------------------------------------------
// Industries News — /industries 페이지
// 산업별 tags overlap 쿼리를 Promise.all로 병렬 실행
// ----------------------------------------------------------------------------
export interface IndustrySection {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: readonly string[];
  articles: NewsArticle[];
}

const INDUSTRY_DEFS = [
  {
    id: 'battery',
    name: '배터리·전기차',
    description: 'UN 38.3 위험물 규정, IATA DGR 개정 영향과 리튬배터리 화물 동향',
    icon: 'bolt',
    tags: ['배터리', '전기차', 'ESS', '리튬', '양극재', '이차전지', '셀'],
  },
  {
    id: 'auto',
    name: '자동차',
    description: '완성차·부품 USMCA 원산지, 멕시코 IMMEX, 관세 변동 모니터링',
    icon: 'car',
    tags: ['자동차', '완성차', '부품', '현대', '기아', 'GM', '르노', '車'],
  },
  {
    id: 'ecommerce',
    name: '이커머스',
    description: 'DDP·DDU, de minimis 규제 동향, 크로스보더 직구·역직구 물류',
    icon: 'shopping-cart',
    tags: ['이커머스', '직구', '역직구', '알리', '쇼피', '아마존', '크로스보더'],
  },
  {
    id: 'coldchain',
    name: '냉동냉장',
    description: '신선식품 리퍼 컨테이너, 냉장창고 운영, 콜드체인 온도 관리',
    icon: 'snowflake',
    tags: ['냉동', '냉장', '콜드체인', 'reefer', '냉장창고', '저온'],
  },
] as const;

export async function getIndustriesNews(): Promise<IndustrySection[]> {
  if (!hasSupabase) {
    return INDUSTRY_DEFS.map((def) => ({ ...def, articles: [] }));
  }

  const supabase = createServerClient();

  const results = await Promise.all(
    INDUSTRY_DEFS.map(async (def) => {
      const { data, error } = await supabase
        .from('maritime_news')
        .select('id, title, summary, url, source, lang, category, agent_type, image_url, published_at, slug')
        .eq('lang', 'ko')
        .overlaps('tags', def.tags as unknown as string[])
        .neq('agent_type', 'daily_card')
        .neq('agent_type', 'external')
        .not('content', 'is', null)
        .order('published_at', { ascending: false })
        .limit(3);

      if (error) console.error(`[getIndustriesNews:${def.id}]`, error);
      const articles = (data ?? []).map(mapNewsRow);
      return { ...def, articles };
    })
  );

  return results;
}

// ----------------------------------------------------------------------------
// Trade Statistics — /industries 무역통계 블록
// ----------------------------------------------------------------------------
export interface TradeStatRow {
  period:        string;       // 'YYYYMM'
  stat_type:     string;
  hs_code:       string | null;
  hs_name:       string | null;
  country_code:  string | null;
  country_name:  string | null;
  export_usd:    number | null;
  export_weight: number | null;
  import_usd:    number | null;
  import_weight: number | null;
  trade_balance: number | null;
}

// Returns last ~14 months of per-country rows for the given HS codes.
// Industry map uses 4-digit codes (8507), DB stores 6-digit codes (850710) →
// use LIKE prefix matching. aggregateTrade() in the page handles aggregation.
export async function getTradeStatsByIndustry(
  hsCodes: readonly string[],
): Promise<TradeStatRow[]> {
  if (!hasSupabase || hsCodes.length === 0) return [];

  const supabase = createServerClient();
  // e.g. ['8507','8703'] → 'hs_code.like.8507%,hs_code.like.8703%'
  const orFilter = hsCodes.map(c => `hs_code.like.${c}%`).join(',');
  const { data, error } = await supabase
    .from('trade_statistics')
    .select('period, stat_type, hs_code, hs_name, country_code, country_name, export_usd, export_weight, import_usd, import_weight, trade_balance')
    .or(orFilter)
    .eq('stat_type', 'item')
    .order('period', { ascending: false })
    .limit(2000);

  if (error) console.error('[getTradeStatsByIndustry]', error);
  console.log(`[getTradeStatsByIndustry] ${hsCodes.join(',')} → ${(data ?? []).length}행`);
  return (data ?? []) as TradeStatRow[];
}

export async function getTradeTrend(
  hsCodes: readonly string[],
  months = 12,
): Promise<TradeStatRow[]> {
  if (!hasSupabase || hsCodes.length === 0) return [];

  const supabase = createServerClient();
  const orFilter = hsCodes.map(c => `hs_code.like.${c}%`).join(',');
  const { data, error } = await supabase
    .from('trade_statistics')
    .select('period, hs_code, country_code, export_usd, import_usd, trade_balance')
    .or(orFilter)
    .eq('stat_type', 'item')
    .order('period', { ascending: false })
    .limit(months * 20);  // 12개월 × sub-codes × countries 여유분

  if (error) console.error('[getTradeTrend]', error);
  console.log(`[getTradeTrend] ${hsCodes.join(',')} → ${(data ?? []).length}행`);
  return (data ?? []) as TradeStatRow[];
}

// ----------------------------------------------------------------------------
// Article detail — /article/[slug]
// ----------------------------------------------------------------------------
export interface ArticleDetail {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  category: string | null;
  source: string | null;
  source_url: string | null;
  image_url: string | null;
  tags: string[] | null;
  published_at: string;
  slug: string;
}

export async function getArticleBySlug(slug: string): Promise<ArticleDetail | null> {
  if (!hasSupabase) return null;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('maritime_news')
    .select('id, title, summary, content, category, source, url, image_url, tags, published_at, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (error) console.error('[getArticleBySlug]', error);
  if (!data) return null;

  // 브리핑 카드(daily_card)나 외부 링크(external)는 내부 기사 페이지 미지원
  if (data.agent_type === 'daily_card' || data.agent_type === 'external') return null;

  // content가 없거나 너무 짧으면 기사 페이지로 표시하지 않음 (200자 미만)
  if (!data.content || data.content.length < 200) return null;

  return {
    id: String(data.id),
    title: data.title,
    summary: data.summary ?? null,
    content: data.content,
    category: data.category ?? null,
    source: data.source ?? null,
    source_url: data.url ?? null,
    image_url: data.image_url ?? null,
    tags: data.tags ?? null,
    published_at: data.published_at?.slice(0, 10) ?? '',
    slug: data.slug,
  };
}

// ----------------------------------------------------------------------------
// Top Trade Chapters — /industries 교역량 상위 품목 (HS 챕터별 집계)
// ----------------------------------------------------------------------------
export interface TopChapterData {
  chapter: string;
  chapterName: string;
  latestPeriod: string;
  exportUsd: number;
  importUsd: number;
  tradeBalance: number;
  exportYoY: number | null;
  importYoY: number | null;
  trend: Array<{ period: string; export_usd: number; import_usd: number }>;
  topCountries: Array<{ code: string; name: string | null; export_usd: number; import_usd: number }>;
}

export async function getTopTradeChapters(limit = 10): Promise<TopChapterData[]> {
  if (!hasSupabase) return [];

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('trade_statistics')
    .select('period, hs_code, country_code, country_name, export_usd, import_usd')
    .eq('stat_type', 'item')
    .order('period', { ascending: false })
    .limit(12000);

  if (error) {
    console.error('[getTopTradeChapters]', error);
    return [];
  }

  const rows = (data ?? []) as Array<{
    period: string;
    hs_code: string | null;
    country_code: string | null;
    country_name: string | null;
    export_usd: number | null;
    import_usd: number | null;
  }>;
  console.log(`[getTopTradeChapters] raw rows: ${rows.length}`);
  if (!rows.length) return [];

  // Determine global latest period
  let globalLatest = '';
  for (const row of rows) {
    if (row.period > globalLatest) globalLatest = row.period;
  }

  // Group by 2-digit chapter code
  const chapterMap = new Map<string, {
    byPeriod: Map<string, { export_usd: number; import_usd: number }>;
    byCountryLatest: Map<string, { name: string | null; export_usd: number; import_usd: number }>;
    chapterLatest: string;
  }>();

  for (const row of rows) {
    const ch = String(row.hs_code ?? '').replace(/\D/g, '').padStart(4, '0').slice(0, 2);
    if (!ch || ch === '00') continue;

    if (!chapterMap.has(ch)) {
      chapterMap.set(ch, { byPeriod: new Map(), byCountryLatest: new Map(), chapterLatest: '' });
    }
    const entry = chapterMap.get(ch)!;

    if (!entry.byPeriod.has(row.period)) {
      entry.byPeriod.set(row.period, { export_usd: 0, import_usd: 0 });
    }
    const pa = entry.byPeriod.get(row.period)!;
    pa.export_usd += row.export_usd ?? 0;
    pa.import_usd += row.import_usd ?? 0;

    if (row.period > entry.chapterLatest) entry.chapterLatest = row.period;

    if (row.period === globalLatest && row.country_code) {
      if (!entry.byCountryLatest.has(row.country_code)) {
        entry.byCountryLatest.set(row.country_code, { name: row.country_name ?? null, export_usd: 0, import_usd: 0 });
      }
      const ca = entry.byCountryLatest.get(row.country_code)!;
      ca.export_usd += row.export_usd ?? 0;
      ca.import_usd += row.import_usd ?? 0;
    }
  }

  const results: TopChapterData[] = [];
  for (const [ch, entry] of chapterMap) {
    const lp = entry.chapterLatest;
    if (!lp) continue;
    const latest = entry.byPeriod.get(lp) ?? { export_usd: 0, import_usd: 0 };

    const lastYearPeriod = String(Number(lp.slice(0, 4)) - 1) + lp.slice(4);
    const ly = entry.byPeriod.get(lastYearPeriod);
    const exportYoY = ly && ly.export_usd > 0
      ? (latest.export_usd - ly.export_usd) / ly.export_usd * 100 : null;
    const importYoY = ly && ly.import_usd > 0
      ? (latest.import_usd - ly.import_usd) / ly.import_usd * 100 : null;

    const trend = [...entry.byPeriod.keys()].sort().map(p => ({
      period: p,
      export_usd: entry.byPeriod.get(p)!.export_usd,
      import_usd: entry.byPeriod.get(p)!.import_usd,
    }));

    const topCountries = [...entry.byCountryLatest.entries()]
      .map(([code, d]) => ({ code, name: d.name, export_usd: d.export_usd, import_usd: d.import_usd }))
      .sort((a, b) => b.export_usd - a.export_usd)
      .slice(0, 5);

    results.push({
      chapter: ch,
      chapterName: HS_CHAPTERS[ch] ?? `HS ${ch}`,
      latestPeriod: lp,
      exportUsd: latest.export_usd,
      importUsd: latest.import_usd,
      tradeBalance: latest.export_usd - latest.import_usd,
      exportYoY,
      importYoY,
      trend,
      topCountries,
    });
  }

  results.sort((a, b) => (b.exportUsd + b.importUsd) - (a.exportUsd + a.importUsd));
  return results.slice(0, limit);
}
