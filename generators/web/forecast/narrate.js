'use strict';
// v1.4.1 전망 산문 생성 — LLM은 statement/impact_note만. 방향·수치·watch_points는 코드(verdict).
// 기준: docs/specs/freight-rate-forecast-prompt-v1.4.1.md (style_rules 5문장 구조, H1~H13, 한국발 중국변수 우선).
// narration_validation 7종: 1)enum 누설 2)결측 단정 3)방향 일치 4)단위 5)분량 6)기준 월 명시 7)관측1건 추세동사.

const { flagsFor } = require('./flags');

const ENUM_LEAK = /(stable|expanding|easing|mixed|proxy|tracker|up_[23]|down_[23])/i;

// 검증 어휘는 언어별로 나눈다. 한국어 어휘로 일본어 산문을 검사하면 전부 통과해
// 가드가 있으나 마나가 된다 — 「必ず」는 '반드시' 목록에 걸리지 않는다.
const GUARD = {
  ko: {
    forbidden: ['확실', '반드시', '틀림없', '분명히', '할 것이다'],
    // 결측 팩터 '가설 표지' — 일반 헤지('가능성' 등)가 아니라, 결측을 확인 포인트로 전환하는 특정 표지만.
    hypothesis: ['원인 후보', '여부', '확인', '판별', '가설', '후보'],
    // 결측 팩터를 현재 사실로 단정하면 실패(가설 표지 동반 시 허용).
    missingKeywords: {
      cost: ['유가', '벙커', '연료'],
      pricing: ['GRI', 'PSS', '할증', '인하'],
      demand: ['수출', '모멘텀', '계절', '성수기'],
      supply: ['결항', '선복'],
      momentum: [],
    },
    currency: '달러',
    vaguePeriod: /최근\s*월/,
    oneObsTrend: /결항.{0,40}(유지|지속|이어졌|이어지)/,
  },
  ja: {
    forbidden: ['確実', '必ず', '間違いな', '明らかに', 'するだろう', 'に違いな'],
    hypothesis: ['要因の候補', 'かどうか', '確認', '判別', '仮説', '候補'],
    missingKeywords: {
      cost: ['燃料', 'バンカー', '油価'],
      pricing: ['GRI', 'PSS', '割増', '値下げ'],
      demand: ['輸出', 'モメンタム', '季節', '繁忙期'],
      supply: ['欠航', 'スペース', '船腹'],
      momentum: [],
    },
    currency: 'ドル',
    vaguePeriod: /直近の?月/,
    oneObsTrend: /欠航.{0,40}(維持|継続|続いて)/,
    // 한국어 낱말을 음차한 비단어. 프롬프트 키를 일본어로 바꿔 원인은 없앴지만,
    // 다시 새면 화면에 그대로 나가므로 가드로 막는다. 「結航率」「結測」은 일본어에 없다.
    nonWords: ['結航', '結測', '欠測率', '船腹量'],
  },
};

const FORBIDDEN = GUARD.ko.forbidden; // 기존 호출부 호환

function isRateMetric(metricRef) {
  return typeof metricRef === 'string' && metricRef.startsWith('kita_sea_rates');
}

/**
 * @param {'ko'|'ja'} [lang='ko'] 출력 언어. validateProse도 같은 값을 받아야 한다.
 */
function buildNarratePrompt(input, verdict, { news = [], lang = 'ko' } = {}) {
  // 한국발 특례(H11~H13)는 부산 기점 항로에만 성립한다. 일본판 타깃엔 해당 없음.
  const koreaOrigin = lang === 'ko' && input.china_factor != null;

  // 지시서 자체를 출력 언어로 쓴다.
  //
  // 처음에는 한국어 지시서 안에서 몇 줄만 바꿔 일본어를 시켰다. 그러자 모델이
  // 지시서에 있는 한국어 낱말을 음차했다 — '결항'→「結航率」, '결측'→「結測」.
  // 둘 다 일본어에 없는 말이고, 발행분 4건이 전부 그렇게 나가 삭제해야 했다.
  // 사실(facts)의 키·값을 옮기는 것만으로는 부족했다. 지시서에 남은 '결측'을
  // 모델이 계속 집어왔다. 언어를 섞으면 어디선가 반드시 샌다.
  const system = lang === 'ja' ? [
    'あなたは国際物流の海上運賃アナリストである。以下の判定と根拠の数値だけを使って本文を書く。'
    + '入力に無い事実・数値を作らない。本文はすべて日本語(常体・だ/である)で書く。',
    '[statement — 5文以内、アナリストの構成]',
    '1) 現状(圧縮): 「<指標>は<月>基準で<水準>、前月比<変化>」の形で書く。',
    '2) 要因 — 3種類を区別する: ①事実(採点の入力を引用) ②パターン(「通常は」などの条件つき。どの入力から言うのか根拠を添える) '
    + '③仮説(欠測の要因候補は「要因の候補は…であり、前者は<データ・公表時期>で判別できる」の形で、判別方法とともに書く)。',
    '3) 見通し: 基本シナリオ(方向・レンジ・判定日)と、転換条件(「〜が現れれば〜シナリオへ転じる」)を1つ。',
    'impact_note は2文以内(160字): 荷主のコスト・交渉ポジション → 行動トリガーを1つ。信頼度の等級を本文で繰り返さない。',
    '[数値] 運賃は単位を省かない(「FEU あたり 2,300 ドル」)。変化は「前月比 21% 下落(600 ドルの下げ)」の形。'
    + '精密な数値と「約・程度」を併用しない。基準の期間は月名で明示する(「5月基準」)——「直近の月」のような不特定の表現は使わない。',
    '[観測1件の signal] 欠航など方向を算出していない(観測1件)signal に「維持・継続・続いている」といった趨勢の動詞を使わない。'
    + '一点を趨勢に見せかけず、水準だけを述べる(「欠航率は5.5%と平常の水準」)。',
    '[表現] 「〜と推定される」は最大1回。同じ語尾を3回以上続けない。',
    '[曖昧語「圧力」禁止] 「圧力」は上昇の力とも費用負担とも読め、両義的である。文脈ごとに具体化する: '
    + '運賃を押し上げる力=「上昇要因/上昇の勢い」、需要side=「需要の強さ」、原価負担=「負担」。',
    '[enum の日本語化 — 原語をそのまま出さない] stable→横ばい, expanding→拡大, easing→緩和, mixed→まちまち, '
    + 'trade_level_proxy→「基幹航路単位の代替値」, tracker_quoted→「週次トラッカーの集計」。',
    '[禁止] 「確実/必ず/〜するだろう」の断定、根拠のない因果の断定。'
    + '欠測のファクターを現在の事実として断定しない(仮説の標識を伴えば可、むしろ推奨)。',
    '[用語] 欠航(けっこう)・欠測。「結航」「結測」は日本語に無い。',
    '出力は JSON ひとつ: {"statement":"...","impact_note":"...","direction_echo":"up|flat|down"}。'
    + 'direction_echo は与えられた判定の方向をそのまま返す。',
  ].filter(Boolean).join('\n') : [
    '당신은 한국발 국제물류 운임 분석가다. 아래 계산된 판정과 근거 수치만 사용해 산문을 쓴다. 입력에 없는 사실·수치를 만들지 않는다.',
    '[statement — 5문장 이내, 애널리스트 구조]',
    '1) 현상(압축): "[출발지]발 [도착지]향 해상운임은 N월 기준 FEU당 X,XXX달러로 전월 대비 Y%↑/↓(절대값)." 형식.',
    '2) 원인 — 세 종류 구분: ①사실(점수 산정 입력 인용) ②패턴("통상/일반적으로" 조건부, 어떤 입력 때문에 거론하는지 근거 동반) ③가설(결측 원인 후보는 "원인 후보는 …, 전자는 [데이터·발표시점]으로 판별된다" 형태로 판별 방법과 함께).',
    '3) 전망: 기본 시나리오(방향·범위·판정일) + 전환 조건("~가 나타나면 ~시나리오로 전환") 1개.',
    'impact_note는 2문장 이내(160자): 화주 비용·협상 포지션 → 행동 트리거 1개. 신뢰도 등급 산문 반복 금지.',
    '[수치] 운임은 단위 완전체("FEU당 2,300달러"). 변화는 "전월 대비 21%↓(600달러 하락)" 형식. 정밀수치+"가량/약" 병용 금지. 기준 기간은 월 이름으로 명시("5월 기준") — "최근 월" 등 불특정 표현 금지.',
    '[관측 1건 신호] 결항 등 방향 미산출(관측 1건) 신호엔 "유지/지속/이어졌다" 같은 추세 동사 금지 — 한 점을 추세로 위장하지 말고 수준만 서술("결항률 5.5%로 평시 수준").',
    '[번역투 금지] "정합적"→"맞물린다/뒷받침한다"; "관측된다"→"나타났다"; "~로 추정된다"는 최대 1회.',
    '[모호어 "압력" 금지] "압력"은 상승 힘/비용 부담 어느 쪽으로도 읽혀 중의적이다. 쓰지 말고 맥락별로 구체화: 운임이 오르는 힘=「상승 요인/상승 동력/상승 우위」, 수요 측 견인=「수요 강세/수요 견인」, 비용·원가 부담=「부담」.',
    '[enum 한글화 — 원문 노출 금지] stable→안정세, expanding→확대, easing→완화, mixed→엇갈림, trade_level_proxy→"기간항로 단위 대용", tracker_quoted→"주간 트래커 집계".',
    '[금지어] "확실/반드시/~할 것이다"류 단정, 근거 없는 인과 단정. 결측 팩터를 현재 사실로 단정 금지(가설 표지와 함께면 허용·권장).',
    koreaOrigin
      ? '[한국발 핵심 — H11~H13] 부산 등 한국발은 중국발 기간항로의 경유항이다. 수급·결항 원인을 쓸 때 중국 변수(SCFI·중국 수출)를 우선 점검하고, 한국 수출만으로 원인을 단정하지 마라. 중국 물량 급증기엔 선복 잠식·기항 생략으로 한국발 스페이스가 먼저 조인다(한국 수출이 늘지 않아도). SCFI는 한국발 지수에 약 2주 선행한다(백테스트).'
      : '',
    '출력은 JSON 하나: {"statement":"...","impact_note":"...","direction_echo":"up|flat|down"}. direction_echo는 주어진 판정 방향 그대로.',
  ].filter(Boolean).join('\n');

  const bs = input.supply && input.supply.blank_sailing;
  // 사실의 키 이름도 출력 언어로 맞춘다. 한국어 키를 그대로 주면 모델이 음차한다 —
  // '결항'을 받은 모델이 「結航率」(일본어에 없는 말)을 쓰고, '결측'은 「結測」이 됐다.
  // 올바른 일본어는 欠航·欠測이다.
  const facts = lang === 'ja' ? {
    指標: input.metric_ref, ラベル: input.label, 頻度: input.cadence, horizon: input.horizon_date,
    判定: { 方向: verdict.direction, 強さ: verdict.strength, 想定レンジ: verdict.expected_range_pct, 信頼度: verdict.confidence },
    運賃: input.rate_series && { 基準月: input.rate_series.period_label, 直近: input.rate_series.latest, 単位: input.rate_series.unit, 前月比: input.rate_series.mom_pct, 傾向: input.rate_series.trend_3p },
    供給_欠航: bs && { 出典: bs.source_type, 欠航率: bs.ratio_pct, 方向: bs.direction, 実効船腹: bs.effective_capacity_chg_pct },
    china_factor: input.china_factor || null,
    需要: input.demand && { 輸出モメンタムYoY: input.demand.export_momentum_yoy_pct, 傾向: input.demand.momentum_trend, 季節性: input.demand.seasonality_flag, 地域: input.demand.region },
    コスト_燃料油MoM: input.cost && input.cost.fuel_mom_pct,
    価格動向: input.pricing_actions,
    context_events: input.context_events || [],
    // 플래그 '값'도 한국어다. 그대로 주면 모델이 '결측'을 「結測」으로 음차한다.
    欠測・フラグ: flagsFor(verdict.data_quality_flags, 'ja'),
  } : {
    지표: input.metric_ref, 라벨: input.label, 케이던스: input.cadence, horizon: input.horizon_date,
    판정: { 방향: verdict.direction, 강도: verdict.strength, 예상범위: verdict.expected_range_pct, 신뢰도: verdict.confidence },
    운임: input.rate_series && { 기준월: input.rate_series.period_label, 최신: input.rate_series.latest, 단위: input.rate_series.unit, 전월대비: input.rate_series.mom_pct, 추세: input.rate_series.trend_3p },
    공급_결항: bs && { 출처: bs.source_type, 비율: bs.ratio_pct, 방향: bs.direction, 유효선복: bs.effective_capacity_chg_pct },
    china_factor: input.china_factor || null,
    수요: input.demand && { 수출모멘텀YoY: input.demand.export_momentum_yoy_pct, 추세: input.demand.momentum_trend, 계절: input.demand.seasonality_flag, 권역: input.demand.region },
    비용_유가MoM: input.cost && input.cost.fuel_mom_pct,
    가격행동: input.pricing_actions,
    context_events: input.context_events || [],
    결측·플래그: verdict.data_quality_flags || [],
  };
  // 사용자 메시지도 출력 언어로 쓴다. 여기만 한국어로 남겨도 그 낱말이 본문에 새어 나온다.
  const ja = lang === 'ja';
  const newsHead = ja
    ? '\n\n[最近の関連ニュース — 記述に引用してよいのはこの一覧に限る]\n'
    : '\n\n[최근 관련 뉴스 — 서사 인용은 이 목록에 한정]\n';
  const newsBlock = news && news.length
    ? `${newsHead}${news.slice(0, 10).map((n, i) => `${i + 1}. ${n.title}${n.summary ? ` — ${n.summary}` : ''}`).join('\n')}`
    : '';
  const ask = ja
    ? '次の判定と根拠から見通しの本文を書け(JSON のみ)。'
    : '다음 판정과 근거로 전망 산문을 작성하라(JSON만).';
  const user = `${ask}\n${JSON.stringify(facts, null, 2)}${newsBlock}`;
  return { system, user };
}

function safeParse(raw) {
  try {
    let t = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const s = t.indexOf('{'); const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    return JSON.parse(t);
  } catch (_) { return null; }
}

// narration_validation 5종. opts: { missingFactors:[], isRate:bool, lang:'ko'|'ja' }
function validateProse(parsed, verdict, opts = {}) {
  const g = GUARD[opts.lang] || GUARD.ko;
  const issues = [];
  if (!parsed) return { ok: false, issues: ['파싱 실패'] };
  const s = typeof parsed.statement === 'string' ? parsed.statement.trim() : '';
  const note = typeof parsed.impact_note === 'string' ? parsed.impact_note.trim() : '';
  if (!s) issues.push('statement 비어있음');
  if (!note) issues.push('impact_note 비어있음');
  // 3. 방향 일치
  if (parsed.direction_echo !== verdict.direction) issues.push(`방향 불일치(${parsed.direction_echo}≠${verdict.direction})`);
  // 1. enum 누설
  if (s && ENUM_LEAK.test(s)) issues.push('enum 원문 누설');
  // 단정 금지
  if (s && g.forbidden.some((w) => s.includes(w))) issues.push('단정 표현 포함');
  const bad = (g.nonWords || []).find((w) => `${s}\n${note}`.includes(w));
  if (bad) issues.push(`비단어 사용(${bad})`);
  // 2. 결측 팩터 단정 서술(가설 표지 없을 때)
  const hasHyp = g.hypothesis.some((h) => s.includes(h));
  for (const f of opts.missingFactors || []) {
    const kws = g.missingKeywords[f] || [];
    if (kws.some((k) => s.includes(k)) && !hasHyp) { issues.push(`결측 팩터(${f}) 단정 서술`); break; }
  }
  // 4. 단위
  if (opts.isRate === true && s && !s.includes(g.currency)) issues.push(`운임 metric인데 "${g.currency}" 없음`);
  if (opts.isRate === false && s && s.includes(g.currency)) issues.push(`지수 metric에 "${g.currency}" 사용`);
  // 5. 분량 — 바인딩 규칙은 "5문장 이내". 자수(560)는 폭주 방지용 느슨한 가드.
  //    종결부호 카운트: 소수점(20.7%)·천단위 쉼표를 오인하지 않도록 뒤에 공백/끝이 오는 [.!?。]만.
  if (s) {
    const sentences = (s.match(/[.!?。](?=\s|$)/g) || []).length;
    if (sentences > 5) issues.push(`statement 5문장 초과(${sentences}문장)`);
  }
  if (s.length > 560) issues.push(`statement 분량 초과(${s.length}>560)`);
  if (note.length > 160) issues.push(`impact_note 분량 초과(${note.length}>160)`);
  // 6. [v1.4.1] 기준 월 명시 — 불특정 "최근 월" 금지.
  if (s && g.vaguePeriod.test(s)) issues.push('기준 월 불특정');
  // 7. [v1.4.1] 관측 1건 신호(방향 미산출)에 추세 동사 금지 — 한 점을 추세로 위장.
  const oneObs = (verdict.data_quality_flags || []).some((f) => /방향 미산출/.test(f));
  if (s && oneObs && g.oneObsTrend.test(s)) issues.push('관측 1건 신호에 추세 동사');
  return { ok: issues.length === 0, issues };
}

// callLLM: async ({system,user}) => string. 검증 통과까지 1회 재생성, 실패 시 산문 없는 draft.
async function narrate(callLLM, input, verdict, { maxRetries = 1, news = [], lang = 'ko' } = {}) {
  const prompt = buildNarratePrompt(input, verdict, { news, lang });
  const missingFactors = (verdict.factor_scores || []).filter((f) => f.missing).map((f) => f.factor);
  // 가드는 생성 언어와 같은 언어로 검사해야 한다. 안 그러면 전부 통과한다.
  const opts = { missingFactors, isRate: isRateMetric(input.metric_ref), lang };
  let last = { issues: ['미실행'] };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await callLLM(prompt);
    const parsed = safeParse(raw);
    const v = validateProse(parsed, verdict, opts);
    last = v;
    if (v.ok) return { statement: parsed.statement.trim(), impact_note: parsed.impact_note.trim(), needs_editor: false };
  }
  return { statement: null, impact_note: null, needs_editor: true, validation_issues: last.issues };
}

module.exports = { buildNarratePrompt, validateProse, narrate, safeParse, isRateMetric, FORBIDDEN, ENUM_LEAK, GUARD };
