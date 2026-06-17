# AI 운임 인텔리전스 브리프 — 설계 스펙

- 작성일: 2026-06-17
- 상태: 설계 합의 (구현 대기)
- 배경: 홈 화면 "운임 인텔리전스 브리프"가 현재 `narrate()` 고정 템플릿에 수치만 채우는 방식이라, 지수가 안 변하면 문장이 동일함. 원래 의도(주간 지수 변화를 분석해 작성)대로 **AI가 매주 분석 문장을 생성**하도록 전환한다.

## 1. 목표

매주 운임 지수 변화를 **AI가 분석해 브리프 문장을 작성**하고, 홈 화면이 이를 표시한다. 수치 환각을 막기 위해 **수치는 코드가 계산, 문장은 AI**가 쓰는 하이브리드. 현재 출력 구조(헤드라인 + 해상·글로벌·항공 + 전망)는 유지한다.

## 2. 확정 결정

- **하이브리드**: 백분위·MoM 등 수치는 코드(신호 로직)로 계산해 LLM에 사실로 주입. AI는 그 수치를 근거로 분석·전망 산문만 작성(숫자 창작 금지).
- **구조 유지**: headline + ocean(해상) + global(글로벌) + air(항공) + outlook(전망).
- **아키텍처**: 백엔드 파이프라인(logisight GitHub Actions cron) → `rates_brief` 테이블 → 프론트(logisight-core)가 읽어 표시. **단일 진실원천 = 백엔드**(수치·문장 모두 저장).
- **폴백(C)**: rates_brief 행이 없거나 오래되면(>10일) 프론트가 기존 `narrate()` 통계 템플릿으로 자동 폴백. 브리프는 절대 빈 화면이 되지 않는다.

## 3. 데이터 흐름

```
market-collectors (월·화·금) → freight_indices·kita_air_rates·bunker_prices (DB)  [기존]
        │
        ▼  rates-brief.yml (화 03:00 UTC + 금 07:00 UTC — 수집 ~1시간 후)
generate-rates-brief.js (logisight)
   ① 신호 수치 계산: 해상(KCCI 백분위·WoW) · 글로벌(SCFI/WCI MoM·정합) · 항공(노선 MoM) · 벙커(VLSFO MoM)
   ② 수치를 사실로 DeepSeek에 주입 → 섹션별 분석 문장(JSON)
   ③ rates_brief upsert (signals_json + prose_json)
        │
        ▼
logisight-core RatesBrief: 최신 rates_brief 읽기
   ├ 신선한 행 있음 → AI 문장 + 저장된 수치 표시
   └ 없음/>10일 → 기존 signals.ts + narrate() 폴백
```

## 4. 컴포넌트

### 4.1 백엔드 (logisight) — `generators/web/rates-brief/`

| 파일 | 역할 | 의존 |
|---|---|---|
| `lib/signals.js` | freight_indices·항공·벙커 → 신호 객체 계산. 현 `logisight-core/src/server/signals.ts`의 compute* 로직을 CommonJS로 포팅(순수) | — |
| `lib/prompt.js` | 신호 사실 + 문체 규칙 → DeepSeek `{system, messages}` (순수) | — |
| `generate-rates-brief.js` | 오케스트레이터: 데이터 로드 → signals → `callDeepSeekJson` → rates_brief upsert | `generators/lib/deepseek`, supabase |

신호 계산은 다음을 포팅(현 signals.ts와 **동일 수치** 산출 보장):
- `computeOceanPressureSignal(kcciSeries)` — KCCI 최근 3주 평균의 52주 백분위 + 직전 3주 평균 대비 WoW → state(normal/observe/caution/alert).
- `computeGlobalMomentumSignal(scfiSeries, wciSeries)` — 각 시계열 마지막 두 점 MoM, 부호 정합 → state.
- `computeAirModalShiftSignal(airMoM, route, oceanPct)` — 항공 MoM(아래 4.4 데이터 규칙) + 해상 압력 연계 → state.
- `computeBunkerSignal(vlsfoMoM)` — VLSFO MoM → state.

### 4.2 DB — 마이그레이션 `rates_brief`

```sql
CREATE TABLE IF NOT EXISTS rates_brief (
  week_id      TEXT PRIMARY KEY,        -- 'YYYY-Www' (as_of 기준)
  as_of        DATE NOT NULL,           -- 최신 지수 날짜(KCCI latest)
  signals_json JSONB NOT NULL,          -- [{label,state,basis,asOf,sources,confidence}, ...]
  prose_json   JSONB NOT NULL,          -- {headline,ocean,global,air,outlook}
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rates_brief ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"     ON rates_brief FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON rates_brief FOR ALL   TO service_role USING (true);
```

### 4.3 프론트엔드 (logisight-core)

- `src/lib/api/rates-brief.ts` + `.functions.ts` — `getLatestRatesBrief()` 서버 함수: `rates_brief`에서 `as_of` 최신 1행 조회.
- `HomeRatesBrief` (index.tsx): rates_brief 최신 행을 읽어
  - **신선(generated_at ≤ 10일)**: `prose_json` 문장 + `signals_json` 수치를 `RatesBrief`에 전달해 표시.
  - **없음/stale**: 기존 경로(`computeOceanPressureSignal` 등 + `narrate()`) 그대로 사용.
- `RatesBrief.tsx`: `prose?` prop 추가 — 있으면 AI 문장 표시, 없으면 기존 `narrate()` 렌더(폴백). 레이아웃·신호등·출처 표기는 그대로.

### 4.4 LLM 입출력

주입(사실):
- 해상: KCCI 3주 평균값, 52주 백분위 %, 직전 3주 평균 대비 WoW %, state.
- 글로벌: SCFI MoM %, WCI MoM %, 정합 여부, state.
- 항공: 대표 노선명 + MoM %(`kita_air_rates`의 **kg300 시계열로 계산**, `chg300` 필드는 적재 버그라 미사용; |MoM| > 200%는 데이터 오류로 제외), 해상 압력 연계 여부.
- 벙커: VLSFO MoM %.
- as_of, scope.

출력(JSON):
```json
{
  "headline": "이번 주 ... (명사형 한 문장)",
  "ocean":  "한국발 해상 운임 분석 (백분위·WoW 인용, 명사형)",
  "global": "SCFI·WCI 모멘텀 분석",
  "air":    "대표 노선 항공 운임 분석 + 모달 시사점",
  "outlook":"단기 전망"
}
```
문체: 명사형 종결, 어려운 한자 금지, 화주 관점, 주입된 수치만 인용. (월간/주간 리포트 문체 규칙과 동일 — `[[article-no-obscure-hanja]]`.)

## 5. 스케줄

신규 `.github/workflows/rates-brief.yml`:
- `schedule`: `0 3 * * 2` (화 03:00 UTC) + `0 7 * * 5` (금 07:00 UTC) — market-collectors(화 02:00·금 06:00) 직후. `workflow_dispatch` 포함.
- 단계: checkout → npm ci → `node generators/web/rates-brief/generate-rates-brief.js`. DB만 갱신(커밋 없음).

## 6. 에러 처리

- DeepSeek 실패/빈 응답 → rates_brief 미기록, 프로세스 비치명적 종료(로그). 프론트는 폴백 템플릿 표시.
- signals 계산에 데이터 부족(KCCI < 6주 등) → 해당 신호 null, 가능한 신호만 생성.

## 7. 테스트

- 단위: `lib/signals.js`(포팅) · `lib/prompt.js`(순수) — node:test.
- **골든 대조**: 동일 입력에 대해 포팅 signals 출력이 현 프론트 signals.ts와 **동일 수치**를 내는지 케이스 검증(백분위·MoM·정합·state).
- 스모크: 라이브 `generate-rates-brief.js` 실행 → rates_brief 1행 + 문장 품질(명사형·수치 인용) 확인.

## 8. 범위 밖 (별도)

- **forecast 페이지 AI화·재생성**(C 항목) — 별도 스펙.
- **`kita_air_rates.chg300` 적재 버그** 백엔드 수정 — 별도 follow-up(프론트는 이미 무시).
- 시그널 임계값 튜닝(현 80/70/60 등)은 포팅 그대로 유지.

## 9. 미해결/확인

- rates_brief 신선도 폴백 임계(현 10일) — 운영 보며 조정 가능.
- 항공 대표 노선 선택: 현재 "최대 |MoM| 노선" 유지(필터 적용). 주요 노선 화이트리스트로 바꿀지는 후속.
