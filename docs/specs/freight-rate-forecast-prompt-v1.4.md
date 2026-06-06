# 운임 방향 예측 프롬프트 — v1.4 SSOT (구현 기준)

이 파일은 forecast 파이프라인의 단일 기준(SSOT)이다. A~E 스코어링·임계값·confidence·abstain·output_schema 기본 골격은 v1.3과 동일(코드: `generators/web/forecast/score.js`, plan: `docs/superpowers/plans/2026-06-06-forecast-*.md`). 아래는 v1.4가 추가/변경한 부분(구현 대상).

## v1.4 델타

### 1. `china_factor` 입력 (신규) — 해상·한국발 전용
부산은 중국발 기간항로의 경유항 → 선복 배정·기항·결항이 중국 물량에 좌우된다. 한국 수출량은 결정 변수가 아니다.
```
"china_factor": {
  "scfi_mom_pct": SCFI 모멘텀(중국발 수급 프록시, 주간 — 2주 누적),
  "scfi_vs_kr_spread": "widening | stable | narrowing"  (SCFI−KCCI 상대 강도),
  "china_export_signal": "surge | normal | slump | null" (해관총서 월간·관세 이벤트·헤드라인 기반),
  "evidence": ["근거 문자열"]
}
```

### 2. B 채점 (b-3) 중국 수급 보정 — score.js
`china_squeeze` 산정:
- `+1`: scfi_mom_pct 강세(2주 누적 +3% 이상) 이고 spread=widening, **또는** china_export_signal=surge
- `−1`: scfi_mom_pct 약세(2주 누적 −3% 이하) 이고 china_export_signal=slump(관세 등 이벤트 동반)
- `0`: 그 외, 또는 china_factor 결측

`B_final = clamp(B + 0.5 × china_squeeze, −2, +2)`. china_squeeze ≠ 0이면 evidence를 factor_scores의 supply 근거에 병기하고 data_quality_flags에 기록.
**보정 계수 0.5와 선행 시차는 초기값** — SCFI→KCCI 교차상관 백테스트로 산정·보정한다.

### 3. analyst_heuristics H11~H13 (서사·Plan C — 채점 불변)
- H11. 부산 등 한국발은 중국발 기간항로의 경유항 — 중국 물량 급증기엔 선복 배정 잠식·기항 생략으로 한국발 스페이스가 먼저 조이고 운임이 오른다(한국 수출이 늘지 않아도).
- H12. 중국 수출 급감(관세·춘절)은 한국발에 선복 여유 → 운임 하방. SCFI 약세가 한국발 지수에 수주 선행(선행 시차는 백테스트 값 사용).
- H13. 결항 결정은 중국 물량이 좌우 — 결항 원인 서술 시 한국 수출이 아니라 중국발 수요·SCFI를 근거로 연결.

### 4. 한국발 원인 서술 규칙 (style_rules — Plan C)
한국발 노선의 수급·결항 원인 서술 시 **중국 변수(SCFI·중국 수출·관세 이벤트)를 우선 점검** — 한국 수출만으로 원인 단정 금지(H11~H13).

### 5. MODEL_VERSION
narrate/생성 산출물의 model_version = **'v1.4'**.

## 변경 이력
- v1.4 (2026-06-07): 한국발 경유항 구조 반영 — china_factor 입력, B (b-3) 중국 수급 보정(clamp ±0.5×squeeze), H11~H13, 한국발 원인 서술 규칙. 계수·선행 시차는 SCFI–KCCI 백테스트로 산정.

> 전문(프롬프트 본문·input_schema·A~E·style_rules·narration_validation)은 대화 기록의 v1.4 메시지 기준. 이 파일은 구현 델타 요약 + SSOT 포인터.
