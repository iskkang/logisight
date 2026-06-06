'use strict';
// T1-2: IATA Jet Fuel Price Monitor — 항공 cost 팩터 입력.
// 출처: https://www.iata.org/en/publications/economics/fuel-monitor/
// 데이터 제공: S&P Global Platts (IATA-Platts 공동 발표, 무료 공개).
//
// 페이지 구조(실제 HTML 확인, 2026-06-07):
//   <h3 class="iataElement-Title3">Fuel Price Analysis</h3>
//   <p>The global average jet fuel price ... last week fell 11.4% ...  to $141.64/bbl.</p>
//
// 주의(fuel.js 선례 준수):
//   - 이 페이지는 WoW(전주 대비) 변화율만 제공한다. 월간 MoM이 아니다.
//   - 21일 미만 구간을 MoM으로 위장 금지(fuel.js 원칙) → span_label:'weekly'로 표기.
//   - scorer는 fuel_mom_pct 키를 기대하지만, 항공 cost 팩터는 별도 score 확장 시까지 참고용.
//   - 기록: fuel_wow_pct(WoW%), price_usd_bbl, as_of, span_label='weekly'.

const { buildFuel } = require('./fuel');

const IATA_URL = 'https://www.iata.org/en/publications/economics/fuel-monitor/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SOURCE_ATTRIBUTION = 'IATA / S&P Global Platts Jet Fuel Price Monitor';

// HTML에서 헤드라인 파싱 — 실제 페이지 구조 기반.
// 대상 문장(Fuel Price Analysis 섹션 하단 <p>):
//   "The global average jet fuel price last week [rose|fell] X% compared to the week before to $Y.YY/bbl."
// 또는 변형: "... rose X% ... to $Y/bbl"
// 주의: 실제 페이지는 "last week" 이후 텍스트가 별도 <span>에 감싸임 → 태그를 먼저 제거.
function parseIataHeadline(html) {
  if (!html || typeof html !== 'string') return null;
  // 태그 제거 후 공백 정규화
  const clean = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // 헤드라인 문장 탐색: "last week" + (rose|fell|unchanged) + price
  const sentenceM = clean.match(
    /The global average jet fuel price\s+(last week.+?)\$([0-9]+(?:\.[0-9]+)?)\/bbl/i,
  );
  if (!sentenceM) return null;

  const segment = sentenceM[1]; // "last week fell 11.4% compared to the week before to "

  // 가격 ($/bbl)
  const priceUsd = parseFloat(sentenceM[2]);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  // 변화율 — 방향(rose/fell) + 숫자
  let wowPct = null;
  const upM = segment.match(/rose\s+([0-9]+(?:\.[0-9]+)?)\s*%/i);
  const dnM = segment.match(/fell\s+([0-9]+(?:\.[0-9]+)?)\s*%/i);
  const unchangedM = /unchanged/i.test(segment);
  if (upM) wowPct = parseFloat(upM[1]);
  else if (dnM) wowPct = -parseFloat(dnM[1]);
  else if (unchangedM) wowPct = 0;
  // 변화율을 파싱하지 못했어도 가격은 반환(wowPct null → scorer가 결측 처리)

  if (!Number.isFinite(wowPct) && wowPct !== 0) wowPct = null;

  return {
    price_usd_bbl: Math.round(priceUsd * 100) / 100,
    fuel_wow_pct: wowPct != null ? Math.round(wowPct * 10) / 10 : null,
    span_label: 'weekly',    // 절대로 'monthly' 아님 — 위장 방지
    source: SOURCE_ATTRIBUTION,
    url: IATA_URL,
  };
}

// 페이지 fetch + 파싱
async function fetchIataHeadline() {
  try {
    const r = await fetch(IATA_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const parsed = parseIataHeadline(html);
    if (!parsed || parsed.price_usd_bbl == null) {
      console.warn('  iata-jet-fuel: 헤드라인 파싱 실패 (구조 변경 가능)');
      return null;
    }
    console.log(
      `  iata-jet-fuel: OK — $${parsed.price_usd_bbl}/bbl, WoW ${parsed.fuel_wow_pct != null ? `${parsed.fuel_wow_pct > 0 ? '+' : ''}${parsed.fuel_wow_pct}%` : 'n/a'}`,
    );
    return parsed;
  } catch (e) {
    console.warn('  iata-jet-fuel: 실패 —', e.message);
    return null;
  }
}

// Supabase upsert — iata_jet_fuel_weekly 테이블 (as_of 기준 upsert).
// 수집 실패 시 null 반환(더미 대체 금지).
async function persistIataReading(supabase) {
  const h = await fetchIataHeadline();
  if (!h) return { ok: false, reason: 'IATA 헤드라인 미수집' };
  const as_of = new Date().toISOString().slice(0, 10); // 수집일 = 발행일 근사
  const row = {
    as_of,
    price_usd_bbl: h.price_usd_bbl,
    fuel_wow_pct: h.fuel_wow_pct,
    span_label: h.span_label,
    source: h.source,
    fetched_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('iata_jet_fuel_weekly')
    .upsert(row, { onConflict: 'as_of' });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, as_of, price_usd_bbl: h.price_usd_bbl, fuel_wow_pct: h.fuel_wow_pct };
}

// 항공 cost 조립(결정 2): 새 의미체계 없이 fuel.js 누적 패턴 재사용.
// 주간 적재분이 4~5주 쌓여 ≥21일 구간이 되면 fuel_mom_pct 산출(≥28일 정상 / 21~27일 approx / 미만 결측).
// 그 전까지 fuel_mom_pct=null(항공 cost 결측). 현재 WoW는 채점 미반영 — note(서사·참고)로만, span 명시.
function buildIataFuel(rows, asof = new Date()) {
  const valid = (rows || [])
    .filter((r) => r.price_usd_bbl != null)
    .sort((a, b) => (a.as_of < b.as_of ? 1 : -1));
  if (!valid.length) return null;
  const latest = valid[0];
  const mom = buildFuel(valid.map((r) => ({ price_usd: r.price_usd_bbl, obs_date: r.as_of })), asof);
  const wowNote =
    latest.fuel_wow_pct != null
      ? `IATA 제트유 WoW ${latest.fuel_wow_pct > 0 ? '+' : ''}${latest.fuel_wow_pct}% ($${latest.price_usd_bbl}/bbl, ${latest.span_label || 'weekly'})`
      : null;
  return {
    fuel_mom_pct: mom ? mom.fuel_mom_pct : null, // 4~5주 누적 전엔 결측(채점 미반영)
    fuel_obs_lag_weeks: mom ? mom.fuel_obs_lag_weeks : null,
    obs_span_days: mom ? mom.obs_span_days : null,
    approx: mom ? !!mom.approx : false,
    price_usd_bbl: latest.price_usd_bbl,
    fuel_wow_pct: latest.fuel_wow_pct ?? null,
    span_label: latest.span_label || 'weekly',
    source: latest.source || SOURCE_ATTRIBUTION,
    as_of: latest.as_of,
    note: wowNote, // 채점 아님 — 서사·참고용
  };
}

async function fetchIataFuel(supabase, asof = new Date()) {
  const { data } = await supabase
    .from('iata_jet_fuel_weekly')
    .select('as_of,price_usd_bbl,fuel_wow_pct,span_label,source')
    .order('as_of', { ascending: false })
    .limit(8);
  return buildIataFuel(data || [], asof);
}

module.exports = {
  parseIataHeadline,
  fetchIataHeadline,
  persistIataReading,
  buildIataFuel,
  fetchIataFuel,
  SOURCE_ATTRIBUTION,
  IATA_URL,
};
