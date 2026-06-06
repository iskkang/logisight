# 운임 방향 예측 프롬프트 v1.4.1 — 해상·항공 공통 (SSOT)

이 파일이 forecast 파이프라인의 단일 기준(SSOT)이다. 구현은 이 파일을 따른다.
A~E 스코어링·composite·confidence·abstain은 `generators/web/forecast/score.js`에 구현돼 있고(v1.3=v1.4 동일), v1.4가 추가한 것은 `china_factor` 입력 + B (b-3) 보정 + H11~H13 + 한국발 서술 규칙 + narration_validation.

## input_schema (v1.4 추가분 표시)
```
{
  "lane","mode","asof","horizon_weeks",
  "rate_series": { latest, unit, wow_pct, mom_pct, trend_3p, percentile_52w, vs_normal_band },
  "supply": {
    "blank_sailing": { source_type, ratio_pct, direction, magnitude_class, independent_sources, geo_scope, evidence[], signal_age_days },
    "effective_capacity_chg_pct",          // 우회·혼잡·신규 투입
    "capacity_chg_yoy_pct","airspace_constraint","notes[]"   // 항공
  },
  "china_factor": {                         // ★ v1.4 신규 — 해상·한국발 전용
    "scfi_mom_pct": SCFI 2주 누적 모멘텀(중국발 수급 프록시),
    "scfi_vs_kr_spread": "widening|stable|narrowing" (SCFI−KCCI 상대 강도),
    "china_export_signal": "surge|normal|slump|null" (해관총서·관세·헤드라인),
    "evidence": []
  },
  "demand": { export_momentum_yoy_pct, momentum_trend, seasonality_flag, frontloading_flag, modal_shift_trigger },
  "cost": { fuel_mom_pct, fuel_obs_lag_weeks, surcharge_events[] },
  "pricing_actions": { announcements[{type,effective,magnitude}], historical_success_rate },
  "context_events": [],
  "context_headlines": [{title,source,published}],   // maritime_news 14일, 서사 인용은 이 목록에 한정
  "data_freshness": {}
}
```

## scoring_rules_ocean (가중치 공급0.30/모멘텀0.25/수요0.25/비용0.10/가격0.10)
A 모멘텀 / B 공급 / C 수요 / D 비용 / E 가격 — v1.3과 동일(score.js). v1.4 추가:
**(b-3) 한국발 중국 수급 보정** — 한국발 노선의 선복 배정·기항 생략·결항은 중국 물량이 좌우하며 한국 수출량은 결정 변수가 아니다.
- china_squeeze `+1`: scfi_mom_pct 2주 +3%↑ 이고 spread=widening, **또는** china_export_signal=surge
- china_squeeze `−1`: scfi_mom_pct 2주 −3%↓ 이고 china_export_signal=slump(관세 등 이벤트 동반)
- `0`: 그 외 또는 china_factor 결측
- `B_final = clamp(B + 0.5 × china_squeeze, −2, +2)`. squeeze≠0이면 evidence를 supply factor_scores 근거에 병기.
- 계수 0.5·선행 시차는 초기값 — SCFI→KCCI 교차상관 백테스트로 보정(실측: lag 2주, corr 0.787 / `scfi-kcci-backtest.js`).

composite·임계값·예상범위·confidence·abstain·output_schema(watch_points 포함)는 v1.3과 동일.

## style_rules (v1.4 — narrate가 따름)
[구조 — statement는 **5문장 이내**, 애널리스트 구조]
1. **현상(압축 표기)**: "[출발지]발 [도착지]향 해상운임은 N월 기준 FEU당 X,XXX달러로 전월 대비 Y%↑/↓(절대값)." 형식 고정.
2. **원인 분석 — 세 종류 구분**: ① 사실(점수 산정된 입력 인용) ② 패턴(analyst_heuristics, "통상/일반적으로" 조건부 필수) ③ 가설(결측 원인 후보 — "원인 후보는 ①·② … 전자는 [데이터·발표시점]으로 판별된다" 형태, 판별 방법 동반).
3. **전망**: 기본 시나리오(방향·범위·판정일) + 전환 조건("~가 나타나면 ~시나리오로 전환") 1개.
impact_note는 2문장 이내: 화주 비용·협상 포지션 → 행동 트리거 1개("~를 부킹 판단의 트리거로"). 신뢰도 등급 산문 반복 금지(UI 배지가 대신) — 불확실성은 시나리오 분기·확인 포인트로.

[수치 표기] 운임 단위 완전체("FEU당 2,300달러", 항공 "kg당 3.85달러(원본 USD/kg)"). '포인트'는 지수만. 변화는 "전월 대비 21%↓(600달러 하락)" 형식, "직전 대비" 금지. 정밀수치+'가량/약' 병용 금지.
**[v1.4.1] 기준 기간은 월 이름으로 명시**: "5월 기준" — "최근 월 기준" 같은 불특정 표현 금지(격식 미완성).

[번역투 금지 변환표] "정합적"→"맞물린다/뒷받침한다"; "시점 정합성"→"기준 시점 차이"; "~의 시계에서"→"앞으로 N주간/M월 D일까지"; "관측된다"→"나타났다/기록했다"; "~로 추정된다"는 statement 전체 최대 1회(대신 "무게를 둔다/가능성이 크다"); "근거의 두께"→"근거가 제한적".
[enum 한글화 — 원문 노출 금지] stable→안정세, expanding→확대, easing→완화, mixed→엇갈림, trade_level_proxy→"기간항로 단위 자료를 대용", tracker_quoted→"주간 트래커 집계".

[어휘] 허용: "가능성 높음/우세/제한적/보합권/무게를 둔다/~로 판별된다/~를 트리거로". 금지: "확실/반드시/~할 것이다"류 단정·근거 없는 인과 단정.
**한국발 노선의 수급·결항 원인 서술 시 중국 변수(SCFI·중국 수출·관세 이벤트)를 우선 점검 — 한국 수출만으로 원인 단정 금지(H11~H13).**
결측 팩터를 현재 사실로 단정 서술 금지. 단 "원인 후보 + 판별 데이터·발표 시점" 가설 제시는 허용·권장(결측을 확인 포인트로 전환).
**[v1.4.1] 관측 1건 신호의 추세 동사 금지**: 방향 미산출 플래그(관측 1건)가 붙은 신호에는 "유지·지속·이어졌다" 등 추세 동사를 쓰지 않는다 — 한 점을 추세로 위장하는 셈. 수준만 서술한다("결항률 5.5%로 평시 수준").

## analyst_heuristics (서사·시나리오·확인 포인트에만. 채점·방향 불변. "통상/일반적으로" 조건부 + 근거 입력값 명시)
- H1. 운임 월 −15%↓ 급락 시 선사는 통상 2~6주 내 결항으로 선복 죄어 운임 방어 — 결항 증가가 반등 선행 신호.
- H2. 결항 확대 + 수요 약세의 상승은 '공급 주도 취약한 상승' — 수요 회복 없으면 되돌림.
- H3. 현물이 계약 위 8주↑ → 다음 협상 계약가 상방(역도 성립). 윈도우: 유럽 Q4, 미주 1~4월.
- H4. GRI 관철은 적재율 좌우 — 공지 직전 현물 강세·결항 확대 동반 시 관철 확률↑.
- H5. 유럽향은 수에즈/희망봉 우회 비중에 민감 — 우회 확대 = 유효 선복 −10~15%.
- H6. 벙커유는 2~4주 시차 반영, 수요 약세 국면 전가 실패 일반적.
- H7. 미서안–미동안 스프레드 확대는 4~6주 시차로 반대 해안 파급.
- H8. (항공) 해상 차질·리드타임 급증 권역 1~3주 내 긴급 화물 항공 전환.
- H9. (항공) 공역 제한·우회는 유효 공급 즉시 감소 — 전환 수요 결합 시 급등.
- H10. 성수기 선적 직전(미주 6~8월 등) 수요 플래그는 상승 요인 가중.
- **H11.** 부산 등 한국발은 중국발 기간항로 경유항 — 중국 물량 급증기엔 선복 배정 잠식·기항 생략으로 한국발 스페이스가 먼저 조이고 운임이 오른다(한국 수출이 늘지 않아도).
- **H12.** 중국 수출 급감(관세·춘절)은 한국발에 선복 여유 → 운임 하방. SCFI 약세가 한국발 지수에 수주 선행(시차는 백테스트 값=2주).
- **H13.** 결항 결정은 중국 물량이 좌우 — 결항 원인은 한국 수출이 아니라 중국발 수요·SCFI로 연결.

## narration_validation (insert 전 검사. 실패 시 1회 재생성, 재실패 시 산문 없는 draft)
1. **enum 누설**: 한국어 산문에 /(stable|expanding|easing|mixed|proxy|tracker)/i 매칭 시 실패.
2. **동인 검사**: 결측 팩터 키워드(수요/계절/유가 등)를 현재 사실로 단정 서술 시 실패. 단 "원인 후보·여부·확인 필요·~로 판별" 등 가설 표지 동반 시 허용.
3. **방향·수치 일치**: 산문 기본 시나리오 방향·범위가 계산된 direction/range와 일치. 대안 시나리오는 전환 조건("~가 나타나면")과 함께만.
4. **단위 검사**: 운임 metric이면 "달러" 필수, 지수 metric에 "달러" 금지.
5. **분량**: statement **5문장 이내**가 바인딩 규칙(종결부호 카운트, 소수점·천단위 쉼표 제외). 자수는 폭주 방지용 **560자 느슨한 가드**(수치 단위 완전체+원인 3종 구분+전환조건을 5문장에 담으면 한국어로 520~560자가 정상). impact_note 160자 이내. (※ v1.4 원안 "280자(3문장)"은 style_rules의 5문장 구조와 충돌 → 사용자 확정대로 5문장 기준.)
6. **[v1.4.1] 기준 월 명시**: statement에 "최근 월" 등 불특정 기간 표현 매칭 시 실패(월 이름 명시 강제).
7. **[v1.4.1] 관측 1건 추세 동사**: data_quality_flags에 "방향 미산출"(관측 1건)이 있는데 결항 신호에 추세 동사("유지·지속·이어졌다·이어지")를 쓰면 실패.

## MODEL_VERSION
narrate/생성 산출물 model_version = **'v1.4.1'**.

## 변경 이력
- v1.4 (2026-06-07): china_factor 입력, B (b-3) 중국 수급 보정(clamp ±0.5×squeeze), H11~H13, 한국발 원인 서술 규칙. 계수·선행 시차는 SCFI–KCCI 백테스트로 산정(실측 lag 2주, corr 0.787).
- v1.4.1 (2026-06-07): 함부르크 샘플 사람 게이트 결과 반영. style_rules에 ① 기준 월 이름 명시(불특정 "최근 월" 금지) ② 관측 1건 신호의 추세 동사 금지(수준만 서술) 2건 추가. narration_validation에 #6·#7로 자동 검사. (※ narrate를 Sonnet 4.6+temp 0.1로 운영, 분량 #5는 v1.4에서 5문장+560자 가드로 정합.)
