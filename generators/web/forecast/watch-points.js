'use strict';
// watch_points 생성 — data_release_calendar.nextDue 기반. 결측·핵심 팩터를 확인 포인트(due 포함)로.
const { RELEASE_CALENDAR, nextDue } = require('./data-release-calendar');

// input(조립 입력) + asof → [{label, source, due}]. due 산출 가능한 항목만(미확인 요일·biweekly 제외).
function buildWatchPoints(input, asof = new Date()) {
  const out = [];
  const add = (id, label) => {
    const rule = RELEASE_CALENDAR.find((r) => r.id === id);
    if (!rule) return;
    const due = nextDue(rule, asof);
    if (due) out.push({ label, source: rule.source, due });
  };
  if (input.demand) add('kcta_provisional', `한국→${input.demand.region || '전체'} 수출 — 수요 둔화 여부 판별`);
  const bs = input.supply && input.supply.blank_sailing;
  if (bs && bs.source_type !== 'none') add('drewry_blank', '결항 비율 변화 — 공급 조절 확인');
  if (input.china_factor) add('scfi_weekly', 'SCFI — 중국발 수급 선행 신호(약 2주 선행)');
  return out;
}

module.exports = { buildWatchPoints };
