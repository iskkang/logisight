// Mock data for Logisight v1 development.
// TODO: Replace with Supabase queries in lib/supabase/queries.ts

import type {
  NewsArticle, IndexBarItem, RailRoute, PolicyAlert,
  WeeklyBriefingPoint, FreightRate
} from './types';

export const MOCK_INDICES: IndexBarItem[] = [
  { name: 'WCI',   value: '$2,286',   change_pct: 3.1,  change_sign: 'up',   source: 'Drewry WCI' },
  { name: 'FBX',   value: '$2,140',   change_pct: -1.2, change_sign: 'down', source: 'Freightos FBX' },
  { name: 'BAI',   value: '—',        change_pct: null, change_sign: 'flat', source: 'Baltic Exchange' },
  { name: 'VLSFO', value: '$812',     change_pct: null, change_sign: 'flat', source: 'Ship & Bunker' },
  { name: 'SCFI',  value: '—',        change_pct: null, change_sign: 'flat', source: 'SSE' },
  { name: 'KCCI',  value: '—',        change_pct: null, change_sign: 'flat', source: 'KOBC' },
];

export const MOCK_HERO_STATS = [
  { label: 'WCI',    value: '$2,286', change: '+3.1% w/w',   sign: 'up' as const,   source: 'Drewry' },
  { label: 'SCFI',   value: '—',      change: '수집 예정',   sign: 'flat' as const, source: 'SSE' },
  { label: '부산항', value: '2.4M',   change: 'TEU · 4월',  sign: 'flat' as const, source: '해수부' },
  { label: '블랭크', value: '43편',   change: '미주 W20-24', sign: 'down' as const, source: 'EconDB' },
];

// 편집부 톤 헤드라인 (인과 연결 없이 각자 독립)
export const MOCK_WEEKLY_BRIEFING: WeeklyBriefingPoint[] = [
  {
    category: '시황',
    agent: 'shipping',
    headline: '중남미 동안 운임 9개월 만에 4,000弗 돌파',
  },
  {
    category: '기업',
    agent: 'corp',
    headline: 'DSV, 쉥커 통합 효과로 1분기 매출 69%↑',
  },
  {
    category: '글로벌',
    agent: 'brief',
    headline: 'TCR 부산-알마티 18일대 진입… 통관 개선',
  },
];

export const MOCK_HERO_NEWS: NewsArticle = {
  id: '1',
  title: '중남미항로 동안 운임 9개월 만에 4000弗 돌파',
  summary: '상하이발 산투스행이 TEU당 4,256달러를 기록하며 전주 대비 29% 급등했다. 브라질 농산물 수출 성수기 진입과 블랭크 세일링 확대가 동시에 운임을 끌어올리고 있다.',
  category: '해상',
  agent_type: 'shipping',
  source_name: '코리아쉬핑가제트',
  published_at: '2026-05-28',
};

export const MOCK_NEWS_GRID: NewsArticle[] = [
  {
    id: '2',
    title: '에어차이나카고, A350F 화물기 4대 추가 발주',
    category: '항공',
    agent_type: 'corp',
    source_name: 'AirCargoNews',
    published_at: '2026-05-27',
  },
  {
    id: '3',
    title: 'TCR Q1 사상 최고 5,460편 운행',
    category: '철도',
    agent_type: 'brief',
    source_name: 'RailFreight',
    published_at: '2026-05-27',
  },
  {
    id: '4',
    title: 'EU ETS 100% 전환 완료, TEU당 €28 부담',
    category: '무역',
    agent_type: 'brief',
    source_name: 'Supply Chain Dive',
    published_at: '2026-05-26',
  },
  {
    id: '5',
    title: 'DSV, 쉥커 인수 효과로 1분기 매출 69% 급증',
    category: '물류',
    agent_type: 'corp',
    source_name: 'FreightWaves',
    published_at: '2026-05-26',
  },
];

export const MOCK_KOREA_ROUTES: Pick<FreightRate, 'pol_name' | 'pod_name' | 'rate_usd'>[] & { change_pct: number }[] = [
  { pol_name: '부산', pod_name: 'LA',      rate_usd: 2890, change_pct: -2 } as any,
  { pol_name: '부산', pod_name: '함부르크', rate_usd: 2340, change_pct: 1 } as any,
  { pol_name: '부산', pod_name: '닝보',     rate_usd: 420,  change_pct: 5 } as any,
  { pol_name: '인천', pod_name: '호치민',   rate_usd: 680,  change_pct: -1 } as any,
];

export const MOCK_EURASIA_ROUTES: RailRoute[] = [
  { route_type: 'TCR', origin: '부산', destination: '알마티',  via: '의주 경유',   transit_days: 18, status: '정상' },
  { route_type: 'TSR', origin: '부산', destination: '모스크바', via: '블라디 경유', transit_days: 24, status: '지연주의' },
  { route_type: 'TCR', origin: '부산', destination: '타슈켄트', via: '중앙아 연계', transit_days: 20, status: '정상' },
];

export const MOCK_POLICIES: PolicyAlert[] = [
  { code: 'CBAM',   title: '철강·시멘트 7월 본격 적용, 신고 의무화',       meta: 'D-30 · 한국 철강 화주 직접 영향' },
  { code: 'EU ETS', title: '해운 배출권 100% 적용, 부가비용 발생',         meta: '시행 중 · TEU당 €28 부담' },
  { code: '제재',   title: '대러 18차 제재 발표, 중앙아 우회 경로 점검',   meta: '5/27 발표 · 카자흐 경유 주의' },
];

export const MOCK_INDUSTRIES = [
  { name: '배터리',     stat: 'UN 38.3 강화, IATA DGR 개정 영향 분석', icon: 'bolt' },
  { name: '자동차·부품', stat: '멕시코 IMMEX, USMCA 원산지 모니터링',    icon: 'car' },
  { name: '이커머스',   stat: 'DDP·DDU, de minimis 규제 동향',           icon: 'shopping-cart' },
  { name: '콜드체인',   stat: '신선식품 정기선 스케줄과 온도 관리',       icon: 'snowflake' },
];

export const LAST_UPDATED = '2026.05.28 09:00';
