# 주간 글로벌 물류 시황 리포트 생성기 — 설계 스펙

- 작성일: 2026-06-16
- 상태: 설계 합의 (구현 대기)
- 프로토타입: `content/drafts/weekly-report-2026-W24.md` (포맷 승인 완료)

## 1. 목표

월간 리포트(`generators/report/`)와 동일한 위상의 **주간 임원 보고용 리포트**를 자동 생성·게재한다.
승인된 프로토타입 포맷(두괄식 + 표 + 신호등 + 배경/분석/시사점)을 기준으로,
매주 초안을 생성하고 사람 검토 후 **PDF + 웹**으로 발행한다.

기존 "주간 브리핑"(`generators/web/lib/weekly-briefing.lib.js`, 헤드라인 3개)과는 **별개 시스템**이다.

## 2. 접근법 (확정: B)

**결정적 데이터 주입 + 단일 LLM 생성.**

- 수치·표는 **코드가 결정적으로 생성**한다(freight_indices DB·캐시에서 직접). LLM은 숫자를 창작하지 않는다.
- 산문(결론·배경/분석/시사점·뉴스 선별 근거)은 **DeepSeek 1회 호출**로 작성한다.
- 신호등은 **LLM이 판단**한다(고정 임계값 대신 기준 가이드 제공).

근거: 프롬프트의 "모든 수치에 출처" 규칙은 표를 코드로 주입해야 안전하다. 주간은 4–5p로 작아 단일 생성이 깔끔하며, 월간 데이터 라이브러리를 재사용한다.

## 3. 데이터 흐름

```
collectors(기존) ─→ freight_indices(DB) + 캐시(iata-cargo·blank-sailings·port-congestion) + latest-news.json
        │
        ▼
[1] lib/weekly-data.js   수치·표·섹션별 뉴스후보를 결정적으로 조립
        │
        ▼
[2] generate-weekly-report.js
        │   DeepSeek 1회: 주입(표·후보뉴스·문체규칙·신호등 기준) → 산문·신호등·뉴스선별
        ▼
content/weekly-report/YYYY-Www.md  (frontmatter: status: draft)
        │   ── 사람 검토·수정·승인 (status: approved) ──
        ├─→ [3] weekly-report-pdf.js → content/published/weekly-report-YYYY-Www.pdf
        └─→ [4] publish-weekly-report.js → weekly_reports(DB) + Storage(PDF) → 웹
```

## 4. 모듈 구성 (신규 `generators/weekly-report/`)

| 파일 | 역할 | 의존 |
|---|---|---|
| `sections.config.js` | 5섹션 정의(id·제목·뉴스 키워드·표 종류) | — |
| `WEEKLY_REPORT_STYLE.md` | 문체 규칙(명사형 종결·신호등·용어/한자 금지) | — |
| `lib/weekly-data.js` | freight_indices·IATA·blank·port·뉴스 → `{tables, factText, newsCandidates}` | `report/lib/index-factsheet.js` 재사용, supabase, 캐시 |
| `lib/week.js` | ISO 주차·보고기간(전주 월~일) 계산 | — |
| `generate-weekly-report.js` | 오케스트레이터: 데이터→DeepSeek→초안 MD 작성 | `generators/lib/deepseek`, weekly-data |
| `weekly-report-pdf.js` | 승인 MD → A4 PDF | `report/monthly-report-pdf.js` 패턴 재사용 |
| `publish-weekly-report.js` | 승인 MD → `weekly_reports` 테이블 + Storage PDF | supabase |

각 모듈은 단일 책임을 가지며, weekly-data는 순수 데이터 조립(LLM·발행 무관), generate는 생성, publish는 발행으로 분리한다.

## 5. 섹션 구성 (승인 포맷 고정)

표지 → Executive Summary(표, 섹션당 1행 + 신호등) → 본문 1~5.

| # | 섹션 | 표(코드 주입) | 뉴스 키워드 |
|---|---|---|---|
| 1 | 종합 시황 | 핵심 지수 요약 | 주간 top 이벤트 |
| 2 | 해상 | SCFI(+서안/동안/유럽)·KCCI·CCFI·WCI·BDI, 블랭크세일링 | 운임·수급·선사 |
| 3 | 항공 | IATA 권역 CTK/ACTK/CLF | 항공 수요·캐파 |
| 4 | 물류 사업 | (표 없음) | 선사·포워더 M&A·디지털 |
| 5 | 무역 | (표 없음, 항만혼잡 옵션) | 정책·지정학·관세 |

각 본문 섹션: **결론(신호등) → INDEX 표 → 배경/분석/시사점(명사형) → 결론 뒷받침 뉴스 3건 → `➔` 한국 화주 So-what.**

- **철도**: 공개 운임지수(ERAI) 수집 시 자동 포함, 미수집 시 자동 생략(조건부 섹션).

## 6. 신호등 — LLM 판단

코드는 신호등을 강제하지 않는다. DeepSeek가 주입된 수치·뉴스를 근거로 섹션별·종합 신호등을 판단한다.
프롬프트에 **판단 기준 가이드**를 제공한다:
- 🟢 안정/우호 — 운임·물동량 안정, 리스크 낮음
- 🟡 관망/혼조 — 변동성 확대, 방향성 불확실
- 🔴 주의/경보 — 급등락·공급망 차질·정책 리스크 높음
- ※ 신호등은 리스크 수준이며 가격 등락색과 무관. 이모지(🟢🟡🔴)로만 표기.

## 7. LLM 생성 규칙

DeepSeek에 주입할 항목:
1. **승인된 작성 프롬프트** (역할·구조·두괄식·출처 표기·하지 말 것).
2. **결정적 데이터**: 섹션별 INDEX 표(마크다운, 출처·기준일 포함), factText, 섹션별 뉴스후보 목록(제목·출처·요약).
3. **문체 규칙** (`WEEKLY_REPORT_STYLE.md`):
   - 명사형 종결 필수 (예: "변동성 확대 예상", "단기 과열 구간 진입"). `~된다/~하다/~이다/~우세하다` 금지.
   - 어려운 한자 약물(弗·比·美·亞·北·前倒·脫出) 금지, 한글(달러·대비·미국). `[[article-no-obscure-hanja]]` 메모리와 일치.
   - 불분명 외래어(헤지 등) 금지.
   - 모든 수치 뒤 출처 또는 `[ASSUMPTION]`.
4. **신호등 기준 가이드** (§6).

LLM은 표를 다시 그리지 않고 주입된 표를 그대로 쓰며, 뉴스는 각 섹션 결론을 **뒷받침하는 것만 3건 선별**한다.

## 8. 출력·발행

### 8.1 초안 (Markdown)
- 경로: `content/weekly-report/YYYY-Www.md`
- frontmatter: `status: draft | approved`, `period`, `generated_at`.

### 8.2 검토 게이트
- 사람이 초안 검토·수정 후 `status: approved`로 변경. 발행 스크립트는 approved만 처리(월간 패턴).

### 8.3 PDF
- `weekly-report-pdf.js`가 승인 MD → `content/published/weekly-report-YYYY-Www.pdf`. 월간 PDF 디자인 토큰 재사용.

### 8.4 웹
- 신규 마이그레이션 `weekly_reports` 테이블: `week_id(YYYY-Www) PK, period_start, period_end, title, summary_json(신호등·핵심수치), body_md, pdf_url, published_at`. RLS: anon read / service_role write.
- `publish-weekly-report.js`가 approved MD를 파싱해 upsert + PDF를 Supabase Storage(`reports/` 버킷)에 업로드.
- 웹 서빙: 기존 `supabase/functions/reports/index.ts`(현재 placeholder)를 `weekly_reports` 조회로 교체하거나 신규 함수 추가. (프론트 라우트 `/weekly-report/:week`는 프론트 레포 작업 — 본 스펙 범위 밖, 데이터 계약만 정의)

## 9. 스케줄·워크플로

- `.github/workflows/weekly-report.yml`
- 트리거: `schedule: cron '0 5 * * 0'` (일요일 14:00 KST = 일요일 05:00 UTC) + `workflow_dispatch`.
- 단계: checkout → npm ci → `generate-weekly-report.js` → 초안 커밋(또는 아티팩트). 발행은 승인 후 별도 수동/디스패치.

## 10. 주차·보고기간

- `lib/week.js`: ISO 8601 주차(`YYYY-Www`).
- 보고기간 = **생성일(일요일)이 속한 주의 월~일** (그 주에 SCFI(금)·KCCI(월)·WCI(목)이 모두 발표됐으므로 완료 주로 간주). 예: 일요일 06/14 생성 → 보고기간 06/08~06/14 (24주차).

## 11. 테스트 전략

- `lib/week.js`·`lib/weekly-data.js`·`sections.config.js`는 순수 함수 → 단위 테스트(주차 계산, 표 조립, 신호등 기준 파싱, 뉴스 필터).
- `generate-weekly-report.js`는 DeepSeek 모킹으로 주입 데이터·출력 구조 검증.
- 회귀 기준: 승인된 프로토타입(W24)을 골든 샘플로 포맷 일치 확인.

## 12. 범위 밖 (차후)

- 프론트엔드 라우트/페이지 UI (별도 레포·작업).
- 월간 리포트 웹 서빙 정식화 (현재 placeholder, 본 작업으로 패턴만 확립).
- 차트 이미지 임베드(주간은 표 중심, 차트는 향후).

## 13. 미해결/확인 항목

- Supabase Storage `reports/` 버킷 존재 여부 — 없으면 마이그레이션/생성 필요.
- DeepSeek 단일 호출의 5섹션 일관성 — 구현 후 토큰·품질 점검(필요 시 섹션 묶음 2회 분할로 폴백).
