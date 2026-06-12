// generators/web/lib/weekly-briefing.lib.js
// 주간 브리핑 생성 보조 — 순수 함수만 (I/O·DeepSeek 호출 없음)
'use strict';

// 슬롯 정의: 프론트 계약 (agent_type 리터럴 + 한글 라벨 + 순서)
const SLOTS = [
  { key: 'shipping', category: '시황', order: 1 },
  { key: 'corp', category: '기업', order: 2 },
  { key: 'brief', category: '글로벌', order: 3 },
];

// KST(UTC+9) 기준 그 주 월요일을 "YYYY-MM-DD"로
function mondayOf(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const dow = kst.getUTCDay(); // 0=일 … 1=월
  const diff = (dow + 6) % 7;  // 월요일까지 거슬러 갈 일수
  const monday = new Date(kst.getTime() - diff * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

// "YYYY년 M월 W주 · 시황 · 기업 · 글로벌"  (W = 그 달의 몇째 주, day 1~7=1주)
function subtitleFor(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const week = Math.floor((d - 1) / 7) + 1;
  return `${y}년 ${m}월 ${week}주 · 시황 · 기업 · 글로벌`;
}

// 지난 7일 brief 기사 목록 → DeepSeek messages 1개
function buildSelectionMessages(articles) {
  const list = articles
    .map((a, i) => `${i + 1}. [${a.category || ''}] ${a.title || ''} — ${a.summary || ''}`)
    .join('\n');
  const content = `당신은 한국 해운·물류 전문 매체의 주간 브리핑 편집장이다.
아래는 지난 7일간 발행된 기사 목록이다. 세 주제별로 가장 중요한 기사 1건씩을 고르고,
각 기사를 KSG(코리아쉬핑가제트) 스타일 헤드라인(명사형 종결, 25~40자, 수치·한자기호 弗·億·%·↑↓ 적극 활용)으로 다시 써라.

주제 정의:
- shipping(시황): 해상·항공·철도 운임/시황 동향
- corp(기업): 선사·포워더·물류기업(Maersk·MSC·HMM·DSV·DHL·FedEx 등) 동향·실적·M&A
- brief(글로벌): 무역·정책·공급망·지정학

또한 위 3건을 엮은 주간 시황 분석 본문(content)을 KSG 문체로 600~1,000자, 평문 산문으로 작성하라.
~입니다·~합니다는 쓰지 말고 ~기록했다·~밝혔다·~전망했다 어미를 사용한다.

해당 주제에 적합한 기사가 없으면 그 값은 빈 문자열("")로 둔다.
반드시 아래 JSON 형식으로만 응답하라:
{"shipping":"헤드라인 또는 \\"\\"","corp":"...","brief":"...","content":"주간 분석 본문"}

기사 목록:
${list}`;
  return [{ role: 'user', content }];
}

// 선정 JSON → weekly_briefing_points 행 배열 (빈 슬롯 제외)
function toPoints(briefingId, selection) {
  const out = [];
  for (const slot of SLOTS) {
    const headline = (selection && selection[slot.key] ? String(selection[slot.key]) : '').trim();
    if (!headline) continue;
    out.push({
      briefing_id: briefingId,
      agent_type: slot.key,
      category: slot.category,
      headline,
      display_order: slot.order,
    });
  }
  return out;
}

module.exports = { mondayOf, subtitleFor, buildSelectionMessages, toPoints, SLOTS };
