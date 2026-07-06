# Monthly Report 9점 체계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 파생 지표 4종(독점 인사이트), 전망 스코어카드(책임제), publish 후 교차모델 최종 검증(QA)을 구축해 monthly report를 9점 체계로 격상.

**Architecture:** 파생 지표는 순수 계산(TDD) + DB 로더 분리. 스코어카드는 `forecasts.json`(repo 저장, 월별)을 다음 호가 실측 판정. 검증은 기계 린트 + Claude(교차모델) 적대 검증을 `verify-report.js`로 묶어 publish 워크플로 마지막 스텝에서 실행, Critical 시 job 실패(발행은 유지).

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase `freight_indices`, DeepSeek(생성)/Claude(검증), GitHub Actions.

## Global Constraints
- 테스트: `node:test`+`node:assert/strict`, 콜로케이트 `*.test.js`, `node --test <경로>`.
- 모든 파생 지표는 **결정론적 계산** — LLM 개입 금지. 데이터 없으면 해당 블록 생략(운영 문구 금지, 계약 §0-⑥).
- 권고 금지(계약 §5): 파생 지표 factText도 사실·수치만, "~필요/~권고" 문구 금지.
- 발행월 데이터 배제: 모든 조회는 `weekEnd`(직전월 말일) 상한 준수 — 기존 `series-delta`/`loadGroup` 패턴 재사용.
- 커밋 말미 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 기존 스타일 준수, 무관 리팩터 금지.

---

### Task 1: 파생 지표 순수 계산 (`lib/derived-metrics.js`)

**Files:** Create `generators/report/lib/derived-metrics.js`, `generators/report/lib/derived-metrics.test.js`

**Interfaces (Produces):**
- `laneSpread(kcciSeries, scfiSeries)` → `{ latest: {kcci, scfi, spread, week}, spread4wAgo, spreadChange }` | null
  - series 형식: `[{week:'YYYY-MM-DD', v:Number}]` 최신순(ocean-indices loadGroup 출력과 동일).
  - spread = kcci.v − scfi.v (동일 주 기준 — 두 시리즈의 공통 최신주 사용, 공통주 없으면 각자 최신주·주차 병기).
  - spread4wAgo: `prevAtOrBefore`(series-delta, 28일)로 각 시리즈의 4주 전 값 → 그 시점 spread.
- `contractSpotGap(ccfiSeries, scfiSeries, { weeks = 26 } = {})` → `{ ratioLatest, ratio4wAgo, lagWeeks, corrAtLag }` | null
  - ratio = ccfi/scfi (동일 주 매칭, 최근 weeks주).
  - lagWeeks: k=0..8 중 corr( SCFI(t−k), CCFI(t) ) 최대인 k (피어슨, 매칭 주 8개 미만이면 null).
- `congestionRateSignal(congestionRows, scfiWow)` → `{ quadrant, label, detail }` | null
  - congestionRows: port-congestion payload rows `[{port, median_wait_days, wow_pct}]`. 대표값 = wow_pct 중앙값.
  - 4분면: 운임↑혼잡↑="수요 견인 신호", 운임↑혼잡↓="공급 조절 주도", 운임↓혼잡↑="병목 속 수요 둔화", 운임↓혼잡↓="완화 국면". (판정 임계 ±1%p)
- `kitaKcciGap(kitaLanes, kcciByCode)` → `[{lane, kita, kcci, gapPct, week, kitaMonth}]` | null
  - 매핑: 롱비치→KCCI_USWC, 뉴욕→KCCI_USEC, 로테르담→KCCI_NEU (FEU 기준). gapPct = (kita−kcci)/kcci×100.
- 각 함수는 입력 부족 시 null (throw 금지).

**Steps:**
- [ ] 테스트 먼저(RED): 각 함수당 정상 케이스 1 + 갭/결측 케이스 1 + null 케이스 1 (총 ~12 테스트). 교차상관 테스트는 합성 시리즈(SCFI를 2주 선행시킨 CCFI)로 lagWeeks=2 검증.
- [ ] 구현(GREEN) → `node --test` 통과.
- [ ] 커밋 `feat(monthly): 파생 지표 계산 4종 (한중 스프레드·계약-스팟 갭·혼잡-운임·공시-실측)`

---

### Task 2: 파생 지표 로더+주입 배선

**Files:** Modify `generators/report/lib/derived-metrics.js`(로더 추가), `generators/report/lib/ocean-indices.js`, `generators/report/run-section.js`, `generators/report/sections.config.js`

**Interfaces:**
- Consumes: Task 1 순수 함수, `loadGroup`(ocean-indices — export 추가 필요), `buildPortCongestion` payload, `buildKitaSeaReport` bundle.
- Produces: `buildDerivedMetrics({ weekEnd, congestion, kitaSea })` → `{ spreadBlock, gapBlock, congestionSignalText, kitaGapBlock }` (각 `{table?, factText}` | null).
  - ocean: spreadBlock→02-1/02-2 factText에 합류(oceanFactText 뒤에 `## 한중발 스프레드` 섹션 추가), gapBlock→02-3, kitaGapBlock→02-9 (기존 oceanBlocks factText 방식과 동일하게 buildOceanIndices factText에 병합).
  - macro: congestionSignalText → run-section의 portThroughputFactText 뒤에 이어붙임(06-3 프롬프트 입력).
- factText는 사실 서술만: 예 `한중발 스프레드(미주서안): KCCI 5,969 − SCFI 6,067 = −98 (4주 전 −412 → 축소)`.
- sections.config: 02-3 focus에 '계약-스팟 갭·전이 시차 수치가 주입되면 그 수치로 전이 속도를 서술(창작 금지)' 1줄, 06-3 focus에 '혼잡-운임 교차 신호 판정이 주입되면 이를 수급 판정의 1차 근거로 사용' 1줄 추가.

**Steps:**
- [ ] loadGroup export + buildDerivedMetrics 로더 구현(조회는 weekEnd 상한).
- [ ] 라이브 검증: `weekEnd=2026-06-30`으로 4개 블록 생성 → 각 factText 출력 확인(수치 존재, 운영 문구 없음).
- [ ] run-section/ocean-indices 배선 + sections.config 2줄.
- [ ] `node --check` 전부 + lib 회귀 전체 통과 → 커밋.

---

### Task 3: 전망 추출 (`extract-forecasts.js`)

**Files:** Create `generators/report/extract-forecasts.js`, `generators/report/lib/forecast-store.js`(+test)

**Interfaces:**
- forecast-store: `saveForecasts(month, claims)` → `content/monthly-report/<month>/forecasts.json` 기록, `loadForecasts(month)` → claims|null. claims 스키마:
  `[{ section, claim, metric: 'SCFI'|'KCCI'|'CCFI'|'WCI'|'BDI'|null, direction: 'up'|'down'|'flat'|null, horizon: 'M+1' }]`
- extract-forecasts.js CLI: `--month=YYYY-MM` — 해당 월 섹션 md들의 [전망] 성격 문장을 DeepSeek로 구조화 추출(문장 원문 보존), metric 매핑 불가면 metric:null(정성). 섹션당 최대 3건.
- run-section.js --all 완료 후 자동 호출(생성 실패해도 리포트 생성은 성공 유지 — try/catch).

**Steps:**
- [ ] forecast-store TDD(save/load 라운드트립, 없는 월 null).
- [ ] extract-forecasts 구현(프롬프트: 문장 그대로+방향+지표 JSON), 7월호로 라이브 1회 실행해 forecasts.json 생성 확인.
- [ ] run-section 훅 + 커밋.

---

### Task 4: 스코어카드 판정·주입

**Files:** Create `generators/report/lib/forecast-scorecard.js`(+test), Modify `run-section.js`, `sections.config.js`(index focus)

**Interfaces:**
- `judgeClaims(claims, indexSeriesByMetric)` → `[{...claim, verdict: 'hit'|'miss'|'qualitative', actual}]`
  - metric 있는 claim: 전월 말 대비 최신(weekEnd 상한) 방향 실측과 대조. flat은 ±1% 밴드.
- `buildScorecardBlock(judged, prevMonth)` → 총론 주입용 마크다운 표 `| 전월 전망 | 실측 | 판정 |` + factText. 정성 claim은 판정 '—(정성)'.
- run-section: index 섹션 생성 시 `loadForecasts(prevMonthOf(MONTH))` → 판정 → synthesis 블록에 스코어카드 추가. 전월 파일 없으면 조용히 생략.
- index focus: '스코어카드가 주입되면 "지난달 전망 점검" 소제목으로 표와 1문단 해설(적중·빗나감 모두 서술, 변명 금지)' 추가.

**Steps:**
- [ ] judgeClaims/buildScorecardBlock TDD(hit/miss/flat/정성 4케이스).
- [ ] 배선 + 라이브 스모크(7월 forecasts.json → 8월 가정 판정 dry-run).
- [ ] 커밋.

---

### Task 5: 최종 검증기 (`verify-report.js`)

**Files:** Create `generators/report/verify-report.js`, `generators/report/lib/report-lint.js`(+test)

**Interfaces:**
- report-lint(순수): `lintReport(md, injectedNumbers)` → `{ findings: [{rule, severity: 'critical'|'warn', excerpt}] }`
  - 규칙: ①금지패턴(➔/☞, 미수집|수집 실패|접속 실패, ~입니다/~했다, `▲ 0.0%`) ②본문 수치 대조 — md의 표 밖 본문에서 `[\d,]+(\.\d+)?%?` 추출, 주입 수치 집합(±반올림 허용)에 없고 연도/날짜/페이지 아닌 수치 → warn(과탐 감안), 금지패턴은 critical.
- verify-report.js CLI: `--month=YYYY-MM` —
  1) 조립본+주입 factText 로드 → lintReport
  2) Claude 적대 검증(ANTHROPIC_API_KEY): 조립본을 주고 "각 사실 주장 중 근거(주입 표·명시 출처)와 모순되거나 근거 없는 것"을 findings JSON으로 — 모델 `claude-sonnet-5`, 시스템 프롬프트에 품질 계약 12조 포함
  3) `content/monthly-report/<month>/qa-report.md` 작성(판정 요약表 + findings) 
  4) exit 0(clean/warn) | exit 1(critical 존재)
- ANTHROPIC 키 없으면 기계 린트만 수행하고 그 결과로 판정(경고 로그).

**Steps:**
- [ ] report-lint TDD(금지패턴 4종 + 수치 대조 hit/miss).
- [ ] verify-report 구현 → **7월호로 라이브 실행**해 qa-report.md 실물 생성(이게 첫 QA 리포트).
- [ ] 커밋.

---

### Task 6: publish 워크플로 QA 스텝

**Files:** Modify `.github/workflows/monthly-report-publish.yml`

**Steps:**
- [ ] publish 스텝 뒤에 추가:
  ```yaml
  - name: 최종 검증 (QA — 교차모델)
    if: always()   # 발행이 됐으면 검증은 항상
    env:
      MONTH: ${{ steps.m.outputs.month }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    run: |
      node generators/report/verify-report.js --month="$MONTH" || VERIFY_FAILED=1
      git config user.name "github-actions"; git config user.email "actions@github.com"
      git add content/monthly-report/*/qa-report.md || true
      git commit -m "chore(monthly): QA report $MONTH" || echo "no changes"
      for i in 1 2 3; do
        if git pull --rebase --autostash origin main && git push; then break; fi
        echo "push attempt $i failed"; sleep 5
      done
      [ -n "$VERIFY_FAILED" ] && { echo "::error::QA Critical 결함 — qa-report.md 확인 후 핫픽스·재발행 필요"; exit 1; }
      exit 0
  ```
- [ ] YAML 검증 + 커밋.

## Self-Review 체크
- 스펙 커버: 파생4종(T1-2), 스코어카드(T3-4), publish후 검증+job실패(T5-6) ✅
- CADI 미포함 ✅, 검증=Claude 교차 ✅, Critical=job실패+리포트커밋(발행 유지) ✅
- 시그니처 일관성: series 형식 `{week,v}`(loadGroup), `prevAtOrBefore` 재사용, `prevMonthOf` 재사용 ✅
