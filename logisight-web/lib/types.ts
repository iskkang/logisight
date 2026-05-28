// Logisight v1 TypeScript Types
// Mirrors Supabase schema in supabase/schema.sql

export type NewsCategory = '해상' | '항공' | '철도' | '물류' | '무역';
export type AgentType = 'shipping' | 'corp' | 'brief';

export interface NewsArticle {
  id: string;
  title: string;
  summary?: string;
  category: NewsCategory;
  agent_type?: AgentType;
  source_name?: string;
  source_url?: string;
  slug?: string;
  image_url?: string;
  tags?: string[];
  published_at: string;
}

export interface FreightIndex {
  index_name: string;
  route?: string;
  composite_value: number;
  weekly_change_pct: number;
  week_of: string;
}

export interface FreightRate {
  carrier: string;
  pol_code: string;
  pol_name: string;
  pod_code: string;
  pod_name: string;
  container_type: '20DRY' | '40DRY' | '40HC';
  rate_usd: number;
  is_partner_rate: boolean;
  data_source: string;
}

export interface RailRoute {
  route_type: 'TCR' | 'TSR';
  origin: string;
  destination: string;
  via?: string;
  transit_days: number;
  status: '정상' | '지연주의' | '운휴';
}

export interface PolicyAlert {
  code: 'CBAM' | 'EU ETS' | '제재' | 'EAR' | '전략물자';
  title: string;
  meta: string;
}

export interface WeeklyBriefingPoint {
  category: '시황' | '기업' | '글로벌';
  agent: AgentType;
  headline: string; // 한 줄 헤드라인만, 인과 연결 X
}

export interface IndexBarItem {
  name: string;
  value: string; // 이미 포맷된 값
  change_pct: number | null;
  change_sign: 'up' | 'down' | 'flat';
}
