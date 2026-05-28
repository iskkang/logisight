// lib/supabase/insert-news.ts
// 저널리스트 에이전트가 생성한 기사를 maritime_news에 삽입한다.
// 반드시 서버사이드(Edge Function, 스크립트)에서만 사용.
// SUPABASE_SERVICE_ROLE_KEY가 없으면 클라이언트 코드에 포함 금지.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export interface NewsInsert {
  title: string;
  summary?: string;
  url: string;
  source?: string;
  lang: string;
  category: string;
  agent_type: 'shipping' | 'corp' | 'brief';
  published_at?: string;
  tags?: string[];
  image_url?: string;
  is_hero?: boolean;
}

// 자동 카테고리 분류 (brief 에이전트 기본값)
const CLASSIFY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /선박|해운|컨테이너|운임|선사|TEU|항로|해상|선적|물동량/i, category: '해상' },
  { pattern: /항공|화물기|공항|air cargo|flight|AWB/i,                   category: '항공' },
  { pattern: /철도|TCR|TSR|열차|rail|train|유라시아|코리도/i,             category: '철도' },
  { pattern: /포워더|창고|3PL|공급망|SCM|logistics/i,                     category: '물류' },
  { pattern: /관세|수출|수입|FTA|무역|통관|HS코드|CBAM|ETS|제재/i,         category: '무역' },
];

export function classifyCategory(title: string, summary?: string): string {
  const text = `${title} ${summary ?? ''}`;
  for (const rule of CLASSIFY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return '물류';
}

export async function insertNewsArticle(article: NewsInsert): Promise<string | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn('[insertNewsArticle] Supabase 환경변수 없음 — 스킵');
    return null;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const row = {
    title: article.title,
    summary: article.summary ?? null,
    url: article.url,
    source: article.source ?? 'Logisight',
    lang: article.lang,
    category: article.category,
    agent_type: article.agent_type,
    published_at: article.published_at ?? new Date().toISOString(),
    tags: article.tags ?? null,
    image_url: article.image_url ?? null,
    is_hero: article.is_hero ?? false,
    fetched_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('maritime_news')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: false })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[insertNewsArticle]', error.message);
    return null;
  }

  return data?.id != null ? String(data.id) : null;
}
