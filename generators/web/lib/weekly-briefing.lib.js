// generators/web/lib/weekly-briefing.lib.js
// 주간 브리핑 생성 보조 — 순수 함수만 (I/O·DeepSeek 호출 없음)
'use strict';

// 슬롯 정의: 프론트 계약 (agent_type 리터럴 + 한글 라벨 + 순서)
const SLOTS = [
  { key: 'shipping', category: '시황', order: 1 },
  { key: 'corp', category: '기업', order: 2 },
  { key: 'brief', category: '글로벌', order: 3 },
];

// 어려운/모호한 한자 약물 → 한글 강제 치환. LLM이 프롬프트 금지를 안 지켜도 결정론적으로 제거.
// 출처 표기 '發'(발신지)은 KSG 관용이라 유지하되, 뒤에 한글이 붙으면 가독성 위해 공백을 넣는다.
// 例) "亞發美서안 … 성수기前倒" → "아시아發 미서안 … 성수기앞당김"
const HANJA_MAP = [
  ['前倒', '앞당김'], ['脫出', '탈출'], // 2자 약물 먼저
  ['脫', '탈'], ['亞', '아시아'], ['美', '미'], ['弗', '달러'], ['億', '억'], ['對', '대'], ['比', '대비'],
  ['歐', '유럽'], ['獨', '독'], ['佛', '프랑스'], ['露', '러시아'], ['印', '인도'],
  ['中', '중'], ['日', '일'], ['英', '영'], ['北', '북'], ['南', '남'], ['東', '동'], ['西', '서'],
];
function sanitizeHanja(text) {
  if (!text) return text;
  let s = String(text);
  for (const [h, k] of HANJA_MAP) s = s.split(h).join(k);
  s = s.replace(/發(?=[가-힣])/g, '發 '); // 發 뒤 한글이면 공백(아시아發미서안 → 아시아發 미서안)
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}

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
function buildSelectionMessages(articles, promptFocus) {
  const list = articles
    .map((a, i) => `${i + 1}. [${a.category || ''}] ${a.title || ''} — ${a.summary || ''}`)
    .join('\n');
  const focusBlock = promptFocus ? `\n권역 분석 지침: ${promptFocus}` : '';
  const content = `당신은 한국 해운·물류 전문 매체의 주간 브리핑 편집장이다.${focusBlock}
아래는 지난 7일간 발행된 기사 목록이다. 세 주제별로 가장 중요한 기사 1건씩을 고르고,
각 기사를 KSG(코리아쉬핑가제트) 스타일 헤드라인(명사형 종결, 25~40자)으로 다시 써라. 숫자·단위·국가는 한글(달러·억·대비·미국·아시아)로 쓰고, 어려운 한자 약물(弗·億·比·美·亞·北·前倒 등)은 쓰지 않는다. 한자 바로 뒤에 또 다른 한자를 붙이지 마라(예: 亞發美 금지 → "아시아發 미"). 기호는 %·↑·↓만 쓴다.

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

// 권역 모드(v2): briefType(news/policy/trade)별 그룹 페이로드 → type별 블록 큐레이션.
// focus = cfg.promptFocus + SHARED_TYPE_RULES (호출측에서 결합). 빈 type 블록은 생략 지시.
function buildRegionSelectionMessages(articles, focus) {
  const byType = { news: [], policy: [], trade: [] };
  for (const a of articles) (byType[a.briefType] || byType.news).push(a);
  const block = (label, items) => items.length
    ? `\n[${label}] (${items.length}건)\n` +
      items.map((a, i) => `${i + 1}. ${a.title || ''} — ${a.summary || ''}`).join('\n')
    : '';
  const payload = block('news', byType.news) + block('policy', byType.policy) + block('trade', byType.trade);
  const content = `당신은 권역 물류 주간 브리핑 편집장이다. 해당 권역의 사안을 그 자체로 다룬다. 한국은 실제 연관될 때만 언급하고, 연관이 없으면 한국을 아예 쓰지 않는다(없다고도 쓰지 않음).
${focus || ''}
아래는 권역 필터를 통과한 기사를 briefType별로 묶은 목록이다. 항목이 있는 type만 작성하고 없는 type은 생략한다(억지 생성 금지).
숫자·단위·국가는 한글(달러·억·대비·미국·아시아)로 쓰고 어려운 한자 약물(弗·億·比·美·亞 등)은 쓰지 않는다.
~입니다·~합니다는 쓰지 말고 ~기록했다·~밝혔다·~전망했다 어미를 사용한다.
반드시 아래 JSON으로만 응답하라(빈 type은 ""):
{"news":"운영 동향 요약 또는 \\"\\"","policy":"정책/거시 함의(해당 권역 중심) 또는 \\"\\"","trade":"무역량 동향(기사에 보고된 수치만) 또는 \\"\\"","content":"권역 주간 분석 본문 600~1,000자. 3~5개 단락으로 나누고 단락 사이는 빈 줄(\\n\\n)로 구분. 첫 단락=이번 주 핵심 요약, 중간 단락=이슈별 분석(이슈마다 한 단락), 마지막 단락=해당 권역 전망. 한국은 실제 연관될 때만 언급하고 연관 없으면 아예 미언급(없다고도 쓰지 않음). 각 단락 2~4문장"}

기사 목록:${payload}`;
  return [{ role: 'user', content }];
}

// 선정 JSON → weekly_briefing_points 행 배열 (빈 슬롯 제외)
function toPoints(briefingId, selection) {
  const out = [];
  for (const slot of SLOTS) {
    const headline = sanitizeHanja((selection && selection[slot.key] ? String(selection[slot.key]) : '').trim());
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

module.exports = { mondayOf, subtitleFor, buildSelectionMessages, buildRegionSelectionMessages, toPoints, sanitizeHanja, SLOTS };
