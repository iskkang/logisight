'use strict';
// T0-2: 현물(SCFI/KCCI) vs 계약(CCFI) 관계 + 8주 지속 플래그. 점수 아님 → context_events·H3 입력.
// 주의: SCFI·CCFI는 기준연도가 달라 절대 레벨 직접 비교가 무의미 → 두 지수의 비율(현물/계약) 추이로
// "현물이 계약 대비 강세 N주 지속"을 판별한다(H3: 현물 강세 지속 → 계약가 상방 압력).

// spotPoints/contractPoints: [{value, date}] (date 'YYYY-MM-DD').
function buildSpread(spotPoints, contractPoints) {
  const cMap = new Map((contractPoints || []).map((p) => [String(p.date), p.value]));
  const aligned = (spotPoints || [])
    .filter((p) => p.value != null && cMap.has(String(p.date)) && cMap.get(String(p.date)))
    .map((p) => ({ date: String(p.date), ratio: p.value / cMap.get(String(p.date)) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // 최신순
  if (aligned.length < 8) return { available: false, weeks: aligned.length };

  let gaining = 0;
  for (let i = 0; i < aligned.length - 1; i++) {
    if (aligned[i].ratio > aligned[i + 1].ratio) gaining++;
    else break;
  }
  let losing = 0;
  for (let i = 0; i < aligned.length - 1; i++) {
    if (aligned[i].ratio < aligned[i + 1].ratio) losing++;
    else break;
  }
  const latest = aligned[0].ratio;
  const prev = aligned[1].ratio;
  let direction = 'flat';
  if (latest > prev * 1.001) direction = 'spot_gaining';
  else if (latest < prev * 0.999) direction = 'spot_losing';
  return {
    available: true,
    ratio: Math.round(latest * 1000) / 1000,
    spread_chg_pct: Math.round(((latest - prev) / prev) * 1000) / 10,
    gaining_weeks: gaining,
    losing_weeks: losing,
    persistent_8w: gaining >= 8 || losing >= 8,
    direction,
  };
}

// context_events용 서사 문자열(없으면 null).
function spreadContextEvent(spread) {
  if (!spread || !spread.available) return null;
  if (spread.gaining_weeks >= 8) return `현물-계약(SCFI/CCFI) 스프레드: 현물 ${spread.gaining_weeks}주 연속 강세(H3 — 계약가 상방 압력)`;
  if (spread.losing_weeks >= 8) return `현물-계약(SCFI/CCFI) 스프레드: 현물 ${spread.losing_weeks}주 연속 약세(H3 — 계약가 하방 압력)`;
  return null;
}

async function fetchSpread(supabase, spotCode = 'SCFI', contractCode = 'CCFI') {
  const read = async (code) => {
    const { data } = await supabase
      .from('freight_indices')
      .select('value,week_date')
      .eq('index_code', code)
      .order('week_date', { ascending: false })
      .limit(20);
    return (data || []).map((r) => ({ value: r.value, date: r.week_date }));
  };
  const [spot, contract] = await Promise.all([read(spotCode), read(contractCode)]);
  return buildSpread(spot, contract);
}

module.exports = { buildSpread, spreadContextEvent, fetchSpread };
