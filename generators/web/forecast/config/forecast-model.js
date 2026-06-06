'use strict';
// 스코어링 모델 상수 — docs/specs/freight-rate-forecast-prompt-v1.4.1.md 와 버전 동기화.
// 분기 보정 시 이 파일 상수만 바꾸고 MODEL_VERSION을 함께 올린다(코드 수술 금지).

const MODEL_VERSION = 'v1.4.1';

// 팩터 가중치 — 합 1.0. 결측 팩터는 composite()에서 재분배.
const WEIGHTS = {
  ocean: { momentum: 0.25, supply: 0.30, demand: 0.25, cost: 0.10, pricing: 0.10 },
  air: { momentum: 0.20, supply: 0.30, demand: 0.30, cost: 0.15, pricing: 0.05 },
};

// composite → 방향/강도/범위(%). classify()가 경계를 명시적으로 적용한다.
const THRESHOLDS = {
  upHigh: { direction: 'up', strength: '상승 가능성 높음', range: [3, 7] },
  upLean: { direction: 'up', strength: '상승 우세', range: [1, 4] },
  flat: { direction: 'flat', strength: '방향성 약함(보합권)', range: null },
  downLean: { direction: 'down', strength: '하락 우세', range: [-4, -1] },
  downHigh: { direction: 'down', strength: '하락 가능성 높음', range: [-7, -3] },
};

// 신선도 임계(일) — 케이던스별. 문서 그대로. (Plan B 입력 조립기에서 신호 최신성 판정에 사용)
const FRESHNESS_DAYS = { weekly: 14, monthly: 45 };
// abstain 기준일 과도 임계(일).
const STALE_DAYS = { weekly: 21, monthly: 60 };
// 결항 신호 만료(일).
const SUPPLY_SIGNAL_MAX_AGE_DAYS = 14;

module.exports = {
  MODEL_VERSION,
  WEIGHTS,
  THRESHOLDS,
  FRESHNESS_DAYS,
  STALE_DAYS,
  SUPPLY_SIGNAL_MAX_AGE_DAYS,
};
