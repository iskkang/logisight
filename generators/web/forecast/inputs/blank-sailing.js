'use strict';
// supply.blank_sailing 조립.
//  - 1순위 tracker_quoted: blank_sailings 테이블(주간 이력, Drewry). 방향은 전주 대비 blank_pct 변화.
//  - 폴백 news_derived: maritime_news 결항 키워드 태깅 → Stage1 기사별 추출(주입형) → Stage2 집계.
// blank-sailing-news-pipeline.md 규칙: 14일 만료, trade_level_proxy 라벨, 독립 출처 수, 방향 다수결.

function magnitudeClass(ratio) {
  if (ratio == null) return 'unknown';
  if (ratio >= 15) return 'major';
  if (ratio >= 7) return 'moderate';
  return 'minor';
}

const RANK = { major: 3, moderate: 2, minor: 1, unknown: 0 };

// rows: blank_sailings 행. asof: Date. → tracker_quoted(+evidence)
// blank_pct가 채워진 과거/당주 행만 유효(미래 예정 주차·null 비율은 결항 데이터 아님 → 결측).
function buildBlankSailing(rows, asof) {
  const valid = (rows || []).filter((r) => {
    if (r.blank_pct == null) return false;
    const t = new Date(`${r.week_start}T00:00:00Z`).getTime();
    return Number.isFinite(t) && t <= asof.getTime();
  });
  if (!valid.length) return { source_type: 'none' };
  const sorted = valid.sort((a, b) => new Date(b.week_start) - new Date(a.week_start));
  const latest = sorted[0];
  const prev = sorted[1];
  // 관측 1건이면 direction=stable은 기본값(관측 아님). 2건부터 실제 산출.
  let direction = 'stable';
  let direction_observed = false;
  if (prev && latest.blank_pct != null && prev.blank_pct != null) {
    direction_observed = true;
    const delta = latest.blank_pct - prev.blank_pct;
    if (delta > 1) direction = 'expanding';
    else if (delta < -1) direction = 'easing';
  }
  const t = new Date(`${latest.week_start}T00:00:00Z`).getTime();
  const ageDays = Number.isFinite(t) ? Math.round((asof - t) / 86400000) : null;
  return {
    source_type: 'tracker_quoted',
    ratio_pct: latest.blank_pct != null ? latest.blank_pct : null,
    direction,
    direction_observed,
    magnitude_class: magnitudeClass(latest.blank_pct),
    independent_sources: 1,
    geo_scope: 'trade_level_proxy',
    signal_age_days: ageDays,
    evidence: sorted.slice(0, 3).map((r) => ({
      source: r.source || 'Drewry',
      published: r.week_start,
      claim: `East Asia 결항률 ${r.blank_pct != null ? `${r.blank_pct}%` : 'n/a'}`,
    })),
  };
}

// 결항 키워드 태깅 — maritime_news에서 결항 관련 기사만.
const BLANK_KEYWORDS = [/blank sailing/i, /void sailing/i, /cancelled sailing/i, /sailing cancellation/i, /capacity withdrawal/i, /결항/, /임시\s?결항/];
function tagBlankSailingNews(newsRows) {
  return (newsRows || []).filter((n) => {
    const hay = `${n.title || ''} ${n.summary || ''}`;
    return BLANK_KEYWORDS.some((re) => re.test(hay));
  });
}

// Stage 2: Stage1 추출 신호 배열 → news_derived 집계. 14일 만료, 다수결, 독립 출처.
// signals: [{trade, direction, magnitude_class, data_origin, published, claim, source}]
function aggregateNewsDerived(signals, asof) {
  const fresh = (signals || []).filter((s) => {
    if (!s.published) return false;
    const age = (asof - new Date(`${s.published}`).getTime()) / 86400000;
    return age >= 0 && age <= 14;
  });
  if (!fresh.length) return { source_type: 'none' };
  const dirs = fresh.map((s) => s.direction).filter(Boolean);
  const exp = dirs.filter((d) => d === 'expanding').length;
  const eas = dirs.filter((d) => d === 'easing').length;
  let direction = 'stable';
  if (exp && eas) direction = 'mixed';
  else if (exp > eas) direction = 'expanding';
  else if (eas > exp) direction = 'easing';
  const magnitude_class = fresh.reduce((m, s) => (RANK[s.magnitude_class] > RANK[m] ? s.magnitude_class : m), 'unknown');
  const independent_sources = new Set(fresh.map((s) => s.data_origin).filter(Boolean)).size || 1;
  const ages = fresh.map((s) => Math.round((asof - new Date(`${s.published}`).getTime()) / 86400000));
  return {
    source_type: 'news_derived',
    ratio_pct: null,
    direction,
    magnitude_class,
    independent_sources,
    geo_scope: 'trade_level_proxy',
    signal_age_days: Math.min(...ages),
    evidence: fresh.slice(0, 4).map((s) => ({
      source: s.source || s.data_origin || 'news',
      published: s.published,
      claim: s.claim || `${s.trade || ''} ${s.direction}`.trim(),
    })),
  };
}

// 1순위 테이블(신선분), 없으면 뉴스 폴백. extractSignal(article)=>signal (Stage1, 주입형; 없으면 폴백 생략).
async function fetchBlankSailing(supabase, asof = new Date(), { extractSignal } = {}) {
  // Drewry 헤드라인 적재분(region='Drewry East-West')을 비율 소스로 사용.
  // EconDB 'East Asia'(예정 스케줄·null 비율)는 쓰지 않는다. (Wave 1.5)
  const { data } = await supabase
    .from('blank_sailings')
    .select('week_start,region,blank_pct,source')
    .eq('region', 'Drewry East-West')
    .order('week_start', { ascending: false })
    .limit(8);
  const tracker = buildBlankSailing(data || [], asof);
  if (tracker.source_type === 'tracker_quoted' && tracker.signal_age_days != null && tracker.signal_age_days <= 14) {
    return tracker;
  }
  // 테이블이 없거나 14일 초과(stale) → 뉴스 폴백
  if (typeof extractSignal === 'function') {
    const since = new Date(asof.getTime() - 14 * 86400000).toISOString();
    const { data: news } = await supabase
      .from('maritime_news')
      .select('title,summary,source,published_at')
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(60);
    const tagged = tagBlankSailingNews(news || []);
    const signals = [];
    for (const a of tagged) {
      const s = await extractSignal(a);
      if (s) signals.push(s);
    }
    const derived = aggregateNewsDerived(signals, asof);
    if (derived.source_type !== 'none') return derived;
  }
  return tracker.source_type === 'tracker_quoted' ? tracker : { source_type: 'none' };
}

module.exports = {
  buildBlankSailing,
  fetchBlankSailing,
  magnitudeClass,
  tagBlankSailingNews,
  aggregateNewsDerived,
  BLANK_KEYWORDS,
};
