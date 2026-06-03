# Monthly Report Standard Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce editorial/structural/pipeline standards for all Logisight monthly PDF reports (지시서 2026-06-03), fixing 2026-06 draft and hardening the pipeline for future issues.

**Architecture:** (1) Fix data pipeline (index-factsheet.js, kita-report.js) so null rows and wrong currency are never generated again. (2) Update MONTHLY_REPORT_STYLE.md (= "SKILL.md") as permanent writing standard. (3) Surgical edits to assembled draft monthly-analysis-2026-06.md. (4) Redesign PDF renderer (KPI cards, back cover, NEWS pages, stripCitations). (5) Add structural injection to assemble script.

**Tech Stack:** Node.js, Markdown, Puppeteer/Chrome PDF, CSS, marked.js

---

## File Map

| File | What Changes |
|------|--------------|
| `generators/report/lib/index-factsheet.js:139-141` | Skip null-value rows (no "데이터 미수집") |
| `generators/report/lib/kita-report.js:183,188` | Air caption/factText: "USD" → "KRW(원/kg)" |
| `generators/report/MONTHLY_REPORT_STYLE.md` | Remove anti-patterns §10.3 + §7; add intelligence rules section |
| `content/drafts/monthly-analysis-2026-06.md` | 10+ surgical fixes to assembled draft |
| `generators/report/monthly-report-pdf.js` | KPI card DOM/CSS, stripCitations regex, back cover, NEWS renderer |
| `generators/report/assemble-monthly-report.js` | Section header injection + 05-N numbering |

---

## Task 1: Fix `lib/index-factsheet.js` — skip null rows

**Files:**
- Modify: `generators/report/lib/index-factsheet.js:139-141`

- [ ] **Step 1: Open and read the current logic**

Current code at lines 138-142 in `buildIndexTable`:
```js
  for (const r of rows) {
    if (r.value == null) {
      lines.push(`| ${LABEL[r.code] || r.code} | 데이터 미수집 | — | — | — |`);
      continue;
    }
```

- [ ] **Step 2: Replace with skip logic**

```js
  for (const r of rows) {
    if (r.value == null) continue; // 값 없는 지수는 행 삭제 (A-1b)
```

- [ ] **Step 3: Verify no other "데이터 미수집" row patterns exist in lib/**

Run: `grep -rn "데이터 미수집" generators/report/lib/`
Expected: 0 results after the fix.

- [ ] **Step 4: Commit**

```bash
git add generators/report/lib/index-factsheet.js
git commit -m "fix(report): skip null-value index rows instead of showing 데이터 미수집"
```

---

## Task 2: Fix `lib/kita-report.js` — air currency KRW

**Files:**
- Modify: `generators/report/lib/kita-report.js:183,188`

- [ ] **Step 1: Read current air table header generation**

Current line 183:
```js
const table = '*KITA 항공 참고운임 (인천 출발, USD), 기준 ' + asOf + '*\n\n' +
```

Current line 188:
```js
factLines.push('기준월 ' + asOf + ', 단위 USD. +100/+300/+500kg 중량 구간별 참고운임.');
```

- [ ] **Step 2: Replace both lines**

Line 183 becomes:
```js
const table = '*KITA 항공 참고운임 (인천 출발, KRW(원/kg)), 기준 ' + asOf + '*\n\n' +
```

Line 188 becomes:
```js
factLines.push('기준월 ' + asOf + ', 단위 KRW(원/kg). +100/+300/+500kg 중량 구간별 참고운임.');
```

- [ ] **Step 3: Commit**

```bash
git add generators/report/lib/kita-report.js
git commit -m "fix(report): KITA air table caption/factText USD -> KRW(원/kg)"
```

---

## Task 3: Update `MONTHLY_REPORT_STYLE.md` — remove anti-patterns, add intelligence rules

**Files:**
- Modify: `generators/report/MONTHLY_REPORT_STYLE.md`

- [ ] **Step 1: Update section 10 (환각 방지 규칙)**

Find section 10.3:
```
3. **"데이터 미수집" 처리**: 기사 요약에 근거 없는 항목은 `데이터 미수집` 표기.
```

Replace with:
```
3. **데이터 없는 섹션·행 처리**: 데이터가 없는 섹션·행은 '미수집/수집 실패/대체 분석' 등 운영 로그성 문구를 외부 리포트에 절대 노출하지 않는다. 해당 행·섹션을 생략하거나, 운임·용선·벙커·통관 등 가용 선행지표를 종합한 '방법론 리드' 문장으로 자연스럽게 대체 서술한다.
```

- [ ] **Step 2: Update section 7 (인용 및 출처 표기)**

Find:
```
- 모든 사실·수치에 출처 필수: `(Freightos, 2026-05-07)`, `(JOC, 2026-05-12)`
```

Replace with:
```
- 모든 사실·수치에 출처 필수. **PDF 월간 리포트**에서는 표 하단 `※ YYYY-MM-DD 기준. 출처: 기관명.` 노트 라인 + 본문 내 자연 귀속("Drewry에 따르면", "Linerlytica 분석에 따르면")으로 표기. 괄호형 `(출처: 기관, YYYY.MM.DD)` 는 PDF 렌더링 시 자동 제거되므로 사용하지 않는다.
- 추정·전망 수치: `(추정)` / `(전망)` 명시.
```

- [ ] **Step 3: Add new `### 월간 PDF 리포트 인텔리전스 규칙` section**

At the end of the file (after section 12), append:

```markdown
---

## 13. 월간 PDF 리포트 인텔리전스 규칙

> 이 규칙은 월간 시장 분석 PDF 발행본에 전용으로 적용된다. 모든 항목은 매호 QA 체크리스트로 검증.

### 13-1. 단락 Bold 카피 리드 필수 (A-2)
모든 분석 단락은 **굵은 한 문장 헤드라인**으로 시작한다. 헤드라인은 수치가 아니라 *의미/주장*을 담는다.
- ✅ 좋은 예: **"WCI 단독 하락은 시장 역행이 아니라 산출구조 차이."**
- ❌ 나쁜 예: "WCI 종합은 2,712달러로 ▼3.1% 하락했다." (수치 재진술)

### 13-2. 해운 지수(02-x) 분석 의무 (A-3)
각 지수 페이지는 다음 3요소를 반드시 포함한다. 표를 말로 옮기는 서술 금지.
1. **Bold 리드** — 그 지수가 말하는 핵심 의미
2. **동인/메커니즘** — 현물 vs 계약 시차, 톤-마일, 벙커 전가(BAF/EBS), 선복 전배, 블랭크세일링=공급레버, 벌크-컨테이너 전용 등
3. **교차연결 + 전망 + So-what**

교차연결(cross-index linkage): 지표를 다른 지수·항로·모드와 연결해 해석(예: BDI↑를 컨테이너 선복 부족 선행신호로).

### 13-3. KITA 참고운임 표준 (A-4)
- **부산발(해상)**: "공시운임 = 계약운임의 후행 그림자" 프레임. 지수와의 시차, 도착지·헤드홀/백홀 분해, 역설 해석. 화주 협상 타이밍 So-what 필수.
- **인천발(항공)**: 통화 **KRW(원/kg)** 고정. 단거리·중동 상승폭 > 장거리(모달 시프트의 거리 비대칭) 인사이트.
- 공통: "KITA 공시 참고운임이며 실제 계약 운임과 구분" 노트 필수.

### 13-4. 통화·단위 고정 (A-5)
| 지표 | 단위 |
|------|------|
| KITA 항공(인천발) | KRW(원/kg) |
| KITA 해상(부산발) | USD(TEU/FEU) |
| WCI | USD/FEU |
| TAC/BAI | USD/kg |
보합값은 ▲/▼ 없이 표기(예: `0.0%`).

### 13-5. 거시·지정학(06) 프레이밍 (A-6)
- 운영 문구 금지. 방법론 리드로 시작: **"본 장은 운임·용선·벙커·통관 선행지표를 종합해 거시·지정학 환경의 구조적 영향을 진단함."**
- 각 06-x 분석은 `➔` 한 줄 결론으로 마무리.
- 이모지(⚠️·📌·국기🇺🇸🇨🇳) PDF에서 사용 금지.
```

- [ ] **Step 4: Commit**

```bash
git add generators/report/MONTHLY_REPORT_STYLE.md
git commit -m "standard(report): update MONTHLY_REPORT_STYLE anti-patterns + add PDF intelligence rules section"
```

---

## Task 4: Edit `monthly-analysis-2026-06.md` — structural fixes

**Files:**
- Modify: `content/drafts/monthly-analysis-2026-06.md`

All edits are surgical. Read the file before editing.

- [ ] **Step 1: Fix page title typo**

Find (line ~11):
```markdown
## 5월 수치치
```
Replace with:
```markdown
## 5월 핵심 지표
```

- [ ] **Step 2: Remove FBX and HRCI null rows**

Find and delete these two rows from the KPI table:
```
| FBX 글로벌 | 데이터 미수집 | — | — | — |
```
```
| HRCI | 데이터 미수집 | — | — | — |
```

- [ ] **Step 3: Add `## 03. 항공 화물` divider**

Find the transition from ocean section to air section. It looks like:
```markdown
---

## 03-1. IATA 권역별 공급·수요·적재율
```

Replace with:
```markdown
---

## 03. 항공 화물

### 03-1. IATA 권역별 공급·수요·적재율
```

Wait — `## 03-1.` is already H2. The parent `## 03.` is what's missing. Insert it:
```markdown
---

## 03. 항공 화물

## 03-1. IATA 권역별 공급·수요·적재율
```

- [ ] **Step 4: Add 05-N. numbers to 지역별 이슈 subheadings**

In section 05, replace the `### Title` H3 headings with numbered `## 05-N. Title` H2 headings:

Find: `### 독일·북유럽 철도 혼란 심화…이른 성수기 수요 대란으로 확전`
Replace: `## 05-1. 독일·북유럽 철도 혼란 심화…이른 성수기 수요 대란으로 확전`

Find: `### 캐나다, 전방위 공급망 개혁 입법 추진…서부 터미널 경쟁 구도 재편 조짐`
Replace: `## 05-2. 캐나다, 전방위 공급망 개혁 입법 추진…서부 터미널 경쟁 구도 재편 조짐`

Find: `### 중동·중앙아시아: 해상 불확실성이 밀어 올린 육상 운송 수요 급증`
Replace: `## 05-3. 중동·중앙아시아: 해상 불확실성이 밀어 올린 육상 운송 수요 급증`

Find: `### 러시아: 흑해 부상·발트 위축…우호국 중심 물류 루트 재편 뚜렷`
Replace: `## 05-4. 러시아: 흑해 부상·발트 위축…우호국 중심 물류 루트 재편 뚜렷`

- [ ] **Step 5: Remove ⚠️ 데이터 미수집 blockquote in 06-1, replace with method lead**

Find:
```markdown
> ⚠️ **이번 회차 항만 물동량 데이터 미수집** — RWI-ISL·ISL 수집 실패. 운임 데이터로 대체 분석.
```

Replace with:
```markdown
**본 장은 운임·용선·벙커·통관 선행지표를 종합해 거시·지정학 환경의 구조적 영향을 진단함.**
```

- [ ] **Step 6: Fix KITA 인천발 table caption currency**

Find:
```
*KITA 항공 참고운임 (인천 출발, USD), 기준 2026-05*
```

Replace with:
```
*KITA 항공 참고운임 (인천 출발, KRW(원/kg)), 기준 2026-05*
```

Also update body text that refers to "달러" for air KITA values. Find in 03-2 section:
```
KITA 인천발 참고운임은 5월 대표 노선 전반에서 상승. +100kg 구간 기준 도쿄는 전월 대비 ▲1,853달러,
```
Replace "달러" with "원/kg" throughout the 03-2 analysis paragraph. The corrected paragraph:
```
KITA 인천발 참고운임은 5월 대표 노선 전반에서 상승. +100kg 구간 기준 도쿄는 전월 대비 ▲1,853원/kg, 홍콩은 ▲1,810원/kg, 두바이는 ▲1,773원/kg, 상하이는 ▲1,708원/kg 상승. 아시아 역내와 중동 노선의 상승 폭이 북미·유럽 대표 노선보다 크게 나타난 흐름. KITA 수치는 공개 참고운임이며 실제 계약 운임과 구분.
```

- [ ] **Step 7: Remove `## 참고자료` block at end**

The `## 참고자료` section at lines ~425-440 contains numbered URL citations that will be stripped anyway by `stripCitations`. Remove the entire block from `## 참고자료` to `---` before the disclaimer.

Find and delete:
```markdown
## 참고자료

[1] Freightos, ...
...
[7] JOC, ...
---
```

- [ ] **Step 8: Commit structural fixes**

```bash
git add content/drafts/monthly-analysis-2026-06.md
git commit -m "fix(2026-06): structural fixes - header typo, null rows, 03 divider, 05-N numbers, KRW currency, method lead"
```

---

## Task 5: Edit `monthly-analysis-2026-06.md` — add bold leads

**Files:**
- Modify: `content/drafts/monthly-analysis-2026-06.md`

Each analysis section's first paragraph should start with a **bold lead sentence** expressing the key finding, not a number.

- [ ] **Step 1: Add bold lead to 02-1 KCCI**

Current first line of analysis:
```
한국형 컨테이너 운임지수(KCCI) 종합은 2,478로...
```
Prepend bold lead:
```
**원양 전 항로 두 자릿수 반등, 역내는 보합 — KCCI가 포착한 이분화 시장.**

한국형 컨테이너 운임지수(KCCI) 종합은 2,478로...
```

- [ ] **Step 2: Add bold lead to 02-2 SCFI**

Current:
```
상하이 컨테이너운임지수(SCFI) 종합은 2,572로...
```
Prepend:
```
**호르무즈발 벙커 충격이 SCFI를 현물 시장의 전쟁터로 만들었다.**

상하이 컨테이너운임지수(SCFI) 종합은 2,572로...
```

- [ ] **Step 3: Add bold lead to 02-3 CCFI**

Current:
```
중국 컨테이너운임지수(CCFI) 종합은 1,367로...
```
Prepend:
```
**CCFI의 완만한 상승은 현물 충격이 계약 운임으로 전이되는 경로를 보여준다.**

중국 컨테이너운임지수(CCFI) 종합은 1,367로...
```

- [ ] **Step 4: Add bold lead to 02-4 WCI**

Current:
```
드류리 세계 컨테이너 운임지수(WCI) 종합은 2,712달러로...
```
Prepend:
```
**WCI 단독 하락은 시장 역행이 아니라 산출구조와 항로 혼합 차이.**

드류리 세계 컨테이너 운임지수(WCI) 종합은 2,712달러로...
```

- [ ] **Step 5: Add bold lead to 02-5 BDI**

Current:
```
발틱건화물운임지수(BDI) 종합은 3,226으로...
```
Prepend:
```
**BDI 급등은 컨테이너 선복 부족의 선행 신호이자 벌크-컨테이너 전용(轉用)이라는 이례적 시장 압력의 증거.**

발틱건화물운임지수(BDI) 종합은 3,226으로...
```

- [ ] **Step 6: Add bold lead to 02-6 블랭크 세일링**

Current (starts with table, then text):
```
Drewry 집계 기준 향후 5주간...
```
Prepend:
```
**6.6% 결항률은 성수기 유효 선복을 압박하는 공급 관리 레버로 작동 중.**

Drewry 집계 기준 향후 5주간...
```

- [ ] **Step 7: Add bold lead to 02-7 역내 운임**

Current:
```
한국발 역내 항로 중 일본 238...
```
Prepend:
```
**원양 급등과 역내 보합 — KCCI가 보여주는 탈동조화는 선복 과잉과 수요 사이클 비동기화의 결과.**

한국발 역내 항로 중 일본 238...
```

- [ ] **Step 8: Add bold lead to 02-8 벙커유**

Current:
```
호르무즈 해협의 기능적 폐쇄가 장기화되면서...
```
Prepend:
```
**벙커유 가격 상승은 SCFI·WCI 단기 변동을 설명하는 비용 변수이자 7월 운임 조정의 배경.**

호르무즈 해협의 기능적 폐쇄가 장기화되면서...
```

- [ ] **Step 9: Add bold lead to 02-9 KITA 부산발**

Current:
```
KITA 부산발 참고운임은 항로별 방향 차이가 뚜렷.
```
Already concise enough to serve as a lead; bold it:
```
**KITA 부산발 참고운임은 항로별 방향 차이가 뚜렷 — 글로벌 지수 단일 해석의 한계를 보완하는 한국발 나침반.**

KITA 부산발 참고운임은 항로별 방향 차이가 뚜렷...
```

- [ ] **Step 10: Add bold lead to 03-1 IATA**

Current:
```
IATA 5월 데이터 기준 글로벌 항공 화물 수요는...
```
Prepend:
```
**수요 ▲4% vs 공급 ▼0.4% — 역방향 수급이 항공 화물 시장 전체의 적재율을 밀어 올리는 중.**

IATA 5월 데이터 기준 글로벌 항공 화물 수요는...
```

- [ ] **Step 11: Add bold lead to 03-3 TAC/BAI**

Current:
```
TAC Index 4월 실측 데이터 기준...
```
Prepend:
```
**홍콩발 북미행 ▲35.8% MoM — 아시아 출발 노선의 항공 운임이 선제 재고 확충 수요와 반도체 물량에 의해 견인되는 구조.**

TAC Index 4월 실측 데이터 기준...
```

- [ ] **Step 12: Add bold lead to 04-1 TCR**

Current:
```
중국-유럽 화물열차의 운행량이...
```
Prepend:
```
**중국-유럽 화물열차 6,000편 돌파 — 해상 불확실성을 흡수하는 대안 회랑으로의 구조 전환이 가속화.**

중국-유럽 화물열차의 운행량이...
```

- [ ] **Step 13: Add bold lead to 04-2 TSR**

Current:
```
러시아-중앙아시아-유럽을 잇는 광역 철도망에서...
```
Prepend:
```
**러시아-카자흐 수출 화물 ▲20% YoY 사상 최고 — 우크라이나 전후 교역 재편이 동방 철도 물류 블록으로 본격 고착화.**

러시아-중앙아시아-유럽을 잇는 광역 철도망에서...
```

- [ ] **Step 14: Commit bold leads**

```bash
git add content/drafts/monthly-analysis-2026-06.md
git commit -m "feat(2026-06): add bold copy leads to all analysis sections (A-2 standard)"
```

---

## Task 6: Update `monthly-report-pdf.js` — KPI cards, stripCitations, back cover, NEWS

**Files:**
- Modify: `generators/report/monthly-report-pdf.js`

- [ ] **Step 1: Fix `stripCitations` to protect OGIMG/NEWS tokens (C-2)**

Current line (approx 60):
```js
.replace(/^[^\n]*https?:\/\/[^\s)]+[^\n]*$/gm, '')
```

Replace with:
```js
.replace(/^(?!.*\[\[(?:OGIMG|NEWS):)[^\n]*https?:\/\/[^\s)]+[^\n]*$/gm, '')
```

This negative lookahead prevents removal of lines containing `[[OGIMG:` or `[[NEWS:` tokens.

- [ ] **Step 2: Redesign KPI stat cards to label-top (C-3)**

In `main()`, find the STATS card DOM generation (approx lines 506-515):
```js
return (
  '<div class="stat-card"><div class="stat-val' +
  cls +
  '">' +
  val +
  '</div><div class="stat-lab">' +
  lab +
  "</div></div>"
);
```

Replace with label-on-top layout:
```js
return (
  '<div class="stat-card"><div class="stat-lab">' +
  lab +
  '</div><div class="stat-val' +
  cls +
  '">' +
  val +
  '</div></div>'
);
```

- [ ] **Step 3: Replace `.stat-*` CSS block (C-3)**

In `buildHtml`, find the stat CSS block:
```css
/* 숫자 콜아웃 카드 = design.md §5-5 : 박스필 + 블루 상단보더 */
.stat-wrap{margin:4mm 0 5mm;break-inside:avoid}
.stat-strip{display:flex;gap:3.5mm}
.stat-card{flex:1;background:var(--c-box-fill);border:1px solid var(--c-band-gray);
  border-top:2.5px solid var(--c-primary);border-radius:0 0 4px 4px;padding:3.5mm 3mm 3mm}
.stat-val{font-family:var(--font-title);font-size:17pt;font-weight:800;color:var(--c-ink);line-height:1}
.stat-val.up{color:var(--c-up)}.stat-val.down{color:var(--c-down)}
.stat-lab{font-size:7.5pt;color:var(--c-body-soft);margin-top:1.5mm;line-height:1.3}
.stat-cap{font-size:7pt;color:var(--c-caption);margin-top:2mm;text-align:right}
```

Replace with label-top variant:
```css
/* KPI 카드 = 라벨 상단형 (label-top tile) */
.stat-wrap{margin:5mm 0 5mm;break-inside:avoid}
.stat-strip{display:flex;gap:4mm}
.stat-card{flex:1;background:#fff;border:1px solid var(--c-band-gray);
  border-left:3px solid var(--c-primary);border-radius:0;padding:4mm 4.5mm 4mm;
  display:flex;flex-direction:column;justify-content:space-between}
.stat-lab{font-size:8.4pt;color:var(--c-body-soft);font-weight:600;line-height:1.35;min-height:21pt;margin-bottom:3mm}
.stat-val{font-family:var(--font-title);font-size:21pt;font-weight:800;color:var(--c-ink);line-height:1}
.stat-val.up{color:var(--c-up)}.stat-val.down{color:var(--c-down)}
.stat-cap{font-size:7.5pt;color:var(--c-caption);margin-top:2.5mm;text-align:left}
```

- [ ] **Step 4: Add `[[NEWS:...]]` token rendering (B-4, C-2)**

In `main()`, after the `[[OGIMG:]]` processing block, add NEWS token handling. The token format is:
`[[NEWS: URL :: 헤드라인 :: 요약 :: 출처·날짜]]`

Add this after ogJobs processing (around line 574):

```js
// [[NEWS: url :: headline :: summary :: source]] → news card
const newsRe = /<p>\s*\[\[NEWS:\s*([\s\S]*?)\]\]\s*<\/p>|\[\[NEWS:\s*([\s\S]*?)\]\]/g;
bodyHtml = bodyHtml.replace(newsRe, (_m, a, b) => {
  const inner = (a || b || '').replace(/<[^>]+>/g, '').trim();
  const parts = inner.split('::').map(s => s.trim());
  const [url, headline, summary, srcDate] = parts;
  if (!url || !headline) return '';
  return (
    '<div class="news-card">' +
    '<div class="news-headline">' + escapeHtml(headline) + '</div>' +
    (summary ? '<p class="news-summary">' + escapeHtml(summary) + '</p>' : '') +
    '<div class="news-meta">' + escapeHtml(srcDate || '') + '</div>' +
    '</div>'
  );
});
```

Add CSS for news cards in `buildHtml` (after `.stat-cap` block):
```css
/* 뉴스 카드 (03-4 / 04-3 기사 페이지) */
.news-card{background:#fff;border:1px solid var(--c-band-gray);border-top:3px solid var(--c-teal);
  padding:5mm 6mm;margin:4mm 0;break-inside:avoid}
.news-headline{font-family:var(--font-title);font-size:13pt;font-weight:800;color:var(--c-ink);
  margin-bottom:3mm;line-height:1.3}
.news-summary{font-size:9.5pt;color:var(--c-body);margin:0 0 3mm;line-height:1.6}
.news-meta{font-size:8pt;color:var(--c-caption);font-weight:600;letter-spacing:1px}
```

- [ ] **Step 5: Add back cover HTML/CSS (B-5, C-2)**

In `buildHtml`, the current HTML template ends with:
```js
<main class="flow">
${transformed.html}
</main>
${chartScript}
</body></html>
```

Replace with:
```js
<main class="flow">
${transformed.html}
</main>

<section class="backcover">
  <div class="bc-brand">LOGISIGHT</div>
  <div class="bc-rule"></div>
  <div class="bc-statement">Global Logistics &amp; Market Intelligence<br>해운·항공·철도 운임과 공급망 동향 종합 분석</div>
  <div class="bc-disclaimer">본 리포트는 공개 출처 기반 분석이며, 수치는 Logisight 지표 대시보드를 참조 바람. 무단 전재·재배포 금지.</div>
  <div class="bc-contact">contact@logisight.com · www.logisight.com</div>
  <div class="bc-copy">© ${Number(YY)} Logisight / MTL Shipping Agency. All rights reserved.</div>
</section>

${chartScript}
</body></html>
```

Add back cover CSS in `buildHtml` style block (after `.chart-box.no-data` block):
```css
/* 뒷표지 */
.backcover{width:210mm;height:296mm;position:relative;overflow:hidden;break-before:page;
  background:linear-gradient(160deg,#4D4D4D 0%,#363636 100%);
  color:#fff;padding:32mm 24mm;display:flex;flex-direction:column;justify-content:flex-end;gap:0}
.bc-brand{font-family:var(--font-title);font-size:22pt;font-weight:800;letter-spacing:3px;color:#fff;margin-bottom:6mm}
.bc-rule{width:24mm;height:3px;background:var(--c-primary);margin-bottom:8mm}
.bc-statement{font-size:11pt;color:rgba(255,255,255,.8);line-height:1.7;margin-bottom:auto;padding-bottom:20mm}
.bc-disclaimer{font-size:8pt;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:4mm}
.bc-contact{font-size:8.5pt;color:rgba(255,255,255,.65);margin-bottom:2mm}
.bc-copy{font-size:7.5pt;color:rgba(255,255,255,.4)}
```

- [ ] **Step 6: Add `.backcover` to bleed page rule**

Find:
```css
.cover,.divider,.toc{page:bleed}
```

Replace with:
```css
.cover,.divider,.toc,.backcover{page:bleed}
```

- [ ] **Step 7: Remove trailing disclaimer from `assemble-monthly-report.js`**

The footer in `assemble-monthly-report.js`:
```js
const footer = [
  '',
  '---',
  '*본 리포트는 공개 출처 기반 분석이며, 운임 구체 수치는 Logisight 지표 대시보드를 참조 바람. 무단 전재 금지.*',
  '',
].join('\n');
```

This disclaimer is now in the back cover. Remove it from assemble to avoid duplication.
Replace footer with empty string:
```js
const footer = '\n';
```

- [ ] **Step 8: Commit PDF generator changes**

```bash
git add generators/report/monthly-report-pdf.js generators/report/assemble-monthly-report.js
git commit -m "feat(pdf): label-top KPI cards, back cover, NEWS renderer, OGIMG-safe stripCitations"
```

---

## Task 7: Update `assemble-monthly-report.js` — section header injection, 05-N numbering

**Files:**
- Modify: `generators/report/assemble-monthly-report.js`

- [ ] **Step 1: Add section header injection**

In `main()`, the body assembly is currently:
```js
const body = approved.map(s => s.body).join('\n\n---\n\n');
```

Replace with logic that:
1. Prepends `## ${sec.title}\n\n` if the section body doesn't already start with the parent heading
2. Applies 05-N. numbering for the region section

```js
function injectSectionHeader(sec, body) {
  // Inject parent heading if missing (e.g., "## 03. 항공 화물")
  const titleHeading = `## ${sec.title}`;
  if (!body.startsWith('## ' + sec.title.slice(0, 4)) && sec.title.match(/^\d{2}\./)) {
    body = titleHeading + '\n\n' + body;
  }
  return body;
}

function numberRegionSubheadings(body) {
  let n = 0;
  return body.replace(/^### (.+)$/gm, (_m, title) => {
    n++;
    return `## 05-${n}. ${title}`;
  });
}

const bodyParts = approved.map(s => {
  let b = s.body;
  b = injectSectionHeader(s, b);
  if (s.id === 'region') b = numberRegionSubheadings(b);
  return b;
});

const body = bodyParts.join('\n\n---\n\n');
```

- [ ] **Step 2: Commit**

```bash
git add generators/report/assemble-monthly-report.js
git commit -m "feat(assemble): inject section parent headers + 05-N auto-numbering for region section"
```

---

## Task 8: Generate PDF and run QA checklist

- [ ] **Step 1: Generate PDF for 2026-06**

```bash
node generators/report/monthly-report-pdf.js --month=2026-06
```

Expected output: `content/published/monthly-analysis-2026-06.pdf`

- [ ] **Step 2: Run QA against D checklist**

Open PDF and verify each item:
- [ ] "데이터 미수집/수집 실패/대체 분석" 문구 0건. ⚠️·국기 이모지 0건.
- [ ] 핵심 지표 표에 FBX/HRCI 빈 행 없음.
- [ ] 모든 분석 단락이 Bold 카피 리드로 시작.
- [ ] 02-1~02-9 각 페이지에 동인·교차연결·전망 포함.
- [ ] 02-9 부산발: So-what 포함. 03-2 인천발: KRW(원/kg) 표기.
- [ ] 01~06 디바이더·TOC 완결. 03 항공 디바이더 존재. 05-N 번호 부여.
- [ ] 05 각 페이지 = 제목 + 소제목 + 이미지 + 인사이트.
- [ ] KPI 카드 = 라벨 상단형.
- [ ] 03-4/04-3 기사 페이지: 적격 기사 없어 미생성 (정상).
- [ ] 뒷표지 존재. 본문 말미 중복 디스클레이머 삭제됨.
- [ ] 출처는 노트 라인/자연 귀속(괄호형 미사용).
- [ ] 페이지 오버플로우·빈 페이지 없음.

- [ ] **Step 3: Final commit**

```bash
git add content/published/monthly-analysis-2026-06.pdf
git status
git add -A
git commit -m "standard(report): enforce intelligence/format standard for all monthly issues (skill anti-patterns removed, KPI cards, regional format, news pages, back cover, KRW)"
```

---

## Self-Review

**Spec coverage check:**
- A-1a (데이터 미수집 금지) → Task 1 (index-factsheet.js) + Task 4 Step 5
- A-1b ('-' 행 금지) → Task 1 (skip null rows)
- A-1c (출처 표기 규칙) → Task 3 Step 2 + Task 3 Step 3 (§7 update)
- A-2 (Bold 리드) → Task 3 Step 3 (§13-1) + Task 5
- A-3 (해운 지수 분석 의무) → Task 3 Step 3 (§13-2) — content already exists in draft
- A-4 (KITA 표준) → Task 2 + Task 3 Step 3 (§13-3) + Task 4 Step 6
- A-5 (통화·단위) → Task 2 + Task 3 Step 3 (§13-4) + Task 4 Step 6
- A-6 (06 프레이밍) → Task 3 Step 3 (§13-5) + Task 4 Step 5
- A-7 (SKILL.md 영구 규칙) → Task 3 Steps 1-3
- B-1 (섹션 번호 완결성) → Task 4 Steps 1,3,4 + Task 7
- B-2 (지역별 이슈 포맷) → Task 4 Step 4 + Task 7
- B-3 (KPI 카드 라벨 상단) → Task 6 Steps 2-3
- B-4 (뉴스 페이지) → Task 6 Step 4; no qualifying articles for 2026-06, so page not generated
- B-5 (뒷표지) → Task 6 Steps 5-6
- C-1 (assemble fixes) → Task 1 + Task 2 + Task 7
- C-2 (pdf stripCitations + NEWS + 뒷표지) → Task 6
- C-3 (KPI 카드 DOM/CSS) → Task 6 Steps 2-3

**Gaps identified:**
- `sections.config.js` still has "데이터 미수집 시 생략" text — this is acceptable (it means skip the whole block, not output the text)
- `run-section.js` warning `'⚠️ 항공 데이터 미수집 — notice 표시'` is a console.warn, not output text — acceptable
- OGIMG tokens in region section: existing STATS tokens have `[[STATS:...]]` not OGIMG — the stripCitations fix ensures OGIMG tokens are protected when they do appear

**No placeholders present in plan.**
