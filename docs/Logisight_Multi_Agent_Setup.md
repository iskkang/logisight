# Logisight Multi-Agent Team Setup

**버전**: v1.0
**작성일**: 2026-05-10
**대상**: Cursor + Claude Code 사용자 (개인 또는 MTL 팀)
**목적**: Logisight 프로젝트를 개발/운영하는 5개 가상 팀(15개 sub-agent)의 정의와 협업 워크플로우

---

## 0. 한 페이지 요약

```
┌────────────────────────────────────────────────────────────────────┐
│  Cursor (IDE)                          Claude Code (CLI)            │
│  ────────────                          ────────────────             │
│  .cursor/rules/karpathy-guidelines.mdc CLAUDE.md (Karpathy +        │
│  (alwaysApply: true)                    Logisight 규칙)              │
│                                        .claude/agents/ (15 agents)   │
│                                                                       │
│  → 코드 작성 시 4원칙 자동 적용         → 작업별 전문 sub-agent 위임 │
└────────────────────────────────────────────────────────────────────┘

[5개 팀 / 15 agents]
─────────────────────────────────────────────────────────────────────
🎯 마케팅팀 (3): writer  → editor   → publisher        ← Writer/Editor/Publisher 패턴
💼 영업팀   (3): lead-analyzer / proposal-writer → proposal-editor
                 followup-writer
🔍 리서치팀 (2): market-analyst / lead-profiler
🎨 디자인팀 (3): ui / proposal-design / report-design
💻 개발팀   (4): frontend / backend / scraper / code-reviewer

[공통 규칙: Karpathy 4원칙]
─────────────────────────────────────────────────────────────────────
1. Think Before Coding   — 가정 명시, 불확실시 질문, 단순한 접근 제시
2. Simplicity First       — 최소 코드, 추측 X, 200줄→50줄 가능시 재작성
3. Surgical Changes       — 필요한 것만, 인접 코드 개선 X, 기존 스타일 유지
4. Goal-Driven Execution  — 검증 가능한 성공 기준, 다단계 plan 명시
```

---

## 1. 왜 멀티 에이전트인가 — Karpathy 관점에서

```
[흔한 실수]                    [멀티 에이전트로 해결]
──────────────                 ────────────────────
컨텍스트 윈도우 폭주             각 agent 분리 컨텍스트 → 토큰 절약
하나의 큰 프롬프트로 모든 일      역할별 분리 → 출력 품질 향상
"개선" 압박으로 코드 변경 폭주    역할 제한 → surgical change 자연스럽게 강제
검수 단계 누락                   editor agent가 강제 검수 (Writer→Editor)
일관성 없는 톤                   각 agent의 system prompt가 톤 고정
```

**Karpathy의 4원칙은 sub-agent 시스템과 자연스럽게 어울린다**: 각 agent는 좁은 책임 → 가정 명시·단순함 유지가 쉽고, 다른 agent의 영역을 침범하지 않으니 surgical changes가 강제됨.

---

## 2. 디렉터리 구조 (전체)

```
logisight/                                    ← 프로젝트 루트
├── CLAUDE.md                                 ← Claude Code 메모리 파일
│                                              (Karpathy + Logisight 규칙 통합)
│
├── .cursor/
│   └── rules/
│       └── karpathy-guidelines.mdc           ← Cursor 자동 적용 규칙
│
├── .claude/
│   ├── agents/                               ← 15개 sub-agent
│   │   ├── README.md                          ← 팀 구조 안내
│   │   │
│   │   ├── # 마케팅팀 (Writer→Editor→Publisher)
│   │   ├── marketing-writer.md
│   │   ├── marketing-editor.md
│   │   ├── marketing-publisher.md
│   │   │
│   │   ├── # 영업팀
│   │   ├── sales-lead-analyzer.md
│   │   ├── sales-proposal-writer.md
│   │   ├── sales-proposal-editor.md
│   │   ├── sales-followup-writer.md
│   │   │
│   │   ├── # 리서치팀
│   │   ├── research-market-analyst.md
│   │   ├── research-lead-profiler.md
│   │   │
│   │   ├── # 디자인팀
│   │   ├── design-ui.md
│   │   ├── design-proposal.md
│   │   ├── design-report.md
│   │   │
│   │   └── # 개발팀
│   │       ├── dev-frontend.md
│   │       ├── dev-backend.md
│   │       ├── dev-scraper.md
│   │       └── dev-code-reviewer.md
│   │
│   └── settings.json                         ← (선택) MCP 서버 등록
│
├── docs/
│   ├── Logisight_PRD_v1_1.md                 ← 이미 만든 PRD
│   ├── Codex_Auto_Drafter_Instructions.md    ← 이미 만든 Auto-Drafter 지시문
│   └── Logisight_Multi_Agent_Setup.md        ← 본 문서
│
├── src/                                       ← 실제 코드
├── workers/                                   ← 데이터 수집기
├── supabase/
│   ├── migrations/
│   └── functions/
└── ... (기타 프로젝트 파일)
```

---

## 3. 15개 Agent 한눈 요약

### 3.1 🎯 마케팅팀 — Writer → Editor → Publisher 체인

```
┌──────────────────────────────────────────────────────────────────┐
│  marketing-writer                                                  │
│  └ 키워드 리서치 → 블로그/SNS 초안 작성                            │
│  └ 출력: Markdown 초안, Front-matter 포함                          │
│  └ 트리거: "물류 트렌드 블로그 써줘"                               │
│                          ↓ (작성 완료 후 자동 호출)                │
│  marketing-editor                                                  │
│  └ 사실 확인 + SEO + 톤 검수                                       │
│  └ 출력: 수정안 + 변경 사유 (diff 형태)                            │
│  └ 거부 권한 있음: "팩트 부족, writer 재작성 필요"                 │
│                          ↓ (검수 통과 후)                          │
│  marketing-publisher                                               │
│  └ 발행 준비: SEO meta, OG image, 카테고리 태깅                    │
│  └ 출력: 발행 직전 최종 파일                                        │
│  └ 채널별 변환: 블로그 / X(트위터) / LinkedIn / 카카오톡 채널       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 💼 영업팀

```
sales-lead-analyzer       → Logisight 회원 데이터 → 리드 점수
sales-proposal-writer     → 맞춤 제안서 초안 (writer 역할)
sales-proposal-editor     → 검수 + MTL 시사점 추가 (editor 역할)
sales-followup-writer     → 팔로우업 이메일 자동 작성
```

### 3.3 🔍 리서치팀

```
research-market-analyst   → 운임/항만/규제 트렌드 분석
research-lead-profiler    → 특정 회사 deep-dive (회사·산업·물류 패턴)
```

### 3.4 🎨 디자인팀

```
design-ui                 → React/Tailwind 컴포넌트 (개발팀과 협업)
design-proposal           → 제안서 PPT/PDF 레이아웃
design-report             → Sea-Intelligence·Larchive 스타일 보고서
```

### 3.5 💻 개발팀 (Karpathy 규칙 가장 엄격 적용)

```
dev-frontend              → React + TS + Vite (Logisight 프론트)
dev-backend               → Supabase Edge Functions + DB 스키마
dev-scraper               → Playwright 데이터 수집기 (Auto-Drafter STEP 1)
dev-code-reviewer         → 모든 PR 검토 (read-only)
```

---

## 4. 협업 워크플로우 (Writer → Editor → Publisher)

### 4.1 마케팅 콘텐츠 발행 워크플로우 (사용자 요청 패턴)

```
[사용자 입력]
"호르무즈 해협 운임 영향 블로그 글 써줘. 1500자 정도, SEO 키워드 포함"
                                    ↓
[Step 1] marketing-writer 자동 위임
  • 키워드 리서치 (web_search)
  • Logisight Market Intelligence 데이터 조회
  • 1500자 초안 작성
  • 출력: drafts/2026-05-10-hormuz-impact.md
                                    ↓ (완료 신호)
[Step 2] marketing-editor 자동 호출
  • 사실 확인 (출처 cross-check)
  • SEO 점검 (제목/H2/meta description)
  • 톤 점검 (MTL 브랜드 톤)
  • 결과:
    ✅ 통과 → publisher로 패스
    ⚠️ 수정 필요 → writer에게 피드백 (1 cycle)
    ❌ 재작성 필요 → 사용자에게 알림
                                    ↓
[Step 3] marketing-publisher
  • Front-matter 정리 (date, author, category, tags)
  • OG image 명세 작성 (design-ui에 위임 옵션)
  • 채널별 변환:
    - 블로그: 풀 텍스트
    - X: 핵심 1개 + 스레드 3~5개
    - LinkedIn: 한국어 풀 + 영문 요약
    - 카카오톡 채널: 미리보기 + 링크
  • 출력: published/2026-05-10/{블로그.md, x.txt, linkedin.md, kakao.txt}
```

### 4.2 영업 제안서 워크플로우

```
[Logisight 회원 가입] (Supabase 트리거)
        ↓
[Step 1] sales-lead-analyzer
  • 회원 정보 + 즐겨찾기 화물/노선 분석
  • Lead Score 산출 (0~100)
  • 산업 분류 (자동차/전자/화학/...)
  • 출력: leads/{company}/profile.json
        ↓ (Score ≥ 60일 때만)
[Step 2] research-lead-profiler (병렬 호출 가능)
  • 회사 web search (홈페이지/뉴스/IR)
  • 추정 물동량/노선
  • 경쟁 포워더 사용 여부
  • 출력: leads/{company}/research.md
        ↓
[Step 3] sales-proposal-writer
  • 위 두 결과를 입력으로
  • 맞춤 제안서 초안 작성
  • MTL 강점 매칭 (TCR/CIS/Sea&Air 등)
  • 출력: proposals/{company}/draft.md
        ↓
[Step 4] sales-proposal-editor
  • 검수 + 가격/조건 sanity check
  • MTL 시사점 강화 (영업 관점)
  • 거부 권한: "근거 부족"
  • 출력: proposals/{company}/edited.md
        ↓
[Step 5] design-proposal
  • PDF/PPT 레이아웃 적용
  • MTL 브랜드 적용
  • 출력: proposals/{company}/final.pdf
        ↓
[영업 담당자 검토 → 발송]
```

### 4.3 격주 보고서 워크플로우 (Auto-Drafter)

```
[일요일 18:00 KST GitHub Actions 트리거]
        ↓
[Step 1] dev-scraper (실제 코드, agent 아님)
  • 14개 collector 실행 → Supabase report_snapshots
        ↓
[Step 2] research-market-analyst
  • 수집된 데이터 분석
  • [현상→원인→전망] 3단 구조 작성
  • 4섹션 (해운/항공/철도/무역공급망)
  • 출력: reports/draft-{vol}.md
        ↓
[Step 3] marketing-editor (보고서 검수)
  • 출처 표시 점검
  • "데이터 미수집" 솔직성 점검 (Vol.02 패턴)
  • 통과/수정/재작성 판정
        ↓
[Step 4] design-report
  • Sea-Intelligence/Larchive 스타일 PDF 변환
  • 차트 자동 생성 (Recharts)
  • 출력: reports/final-{vol}.pdf
        ↓
[월요일 오전 영업팀 검토 → MTL 시사점 추가 → 발송]
```

### 4.4 개발 워크플로우 (Karpathy 가장 엄격)

```
[사용자 요청]
"HS-Code 검색 페이지에 5개국 비교 기능 추가해줘"
        ↓
[Step 1] dev-frontend (자동 위임)
  • Karpathy 1번 적용: 가정 명시
    "기존 HSSearch 컴포넌트에 새 props 추가하는 게 맞나요?
     아니면 새 페이지를 만드나요?"
  • 사용자 답변 후 진행
  • 최소 변경으로 구현
        ↓ (완료)
[Step 2] dev-code-reviewer (자동 호출)
  • Karpathy 3번 점검: 인접 코드 변경 여부
  • Karpathy 2번 점검: 200줄→50줄 가능 여부
  • 테스트 작성 여부 (Karpathy 4번)
  • 결과:
    ✅ 통과 → 사용자에게 보고
    ⚠️ 수정 권고 → frontend에 피드백 1회
        ↓
[Step 3] 사용자 검토 → merge
```

---

## 5. Cursor + Claude Code 동시 사용 가이드

### 5.1 Cursor에서 일할 때

```
.cursor/rules/karpathy-guidelines.mdc 가 alwaysApply: true 이므로
모든 코드 편집 시 Karpathy 4원칙이 자동 적용된다.

추가로 필요한 경우:
@karpathy-guidelines  ← 명시적 호출 (rule을 강조)
```

Cursor에서는 sub-agent 기능이 없으므로, 위 워크플로우를 자동화하려면 Claude Code 터미널을 별도로 열어 사용한다.

### 5.2 Claude Code에서 일할 때

```bash
# 프로젝트 루트에서
$ claude

# 자동 위임 (description 매칭)
> 호르무즈 해협 운임 블로그 글 써줘
   → marketing-writer 자동 호출됨

# 명시적 호출
> Use the marketing-writer subagent to draft a blog about Hormuz strait
> Use the dev-code-reviewer subagent on the latest commit
> Use the design-report subagent to format report Vol.04

# 체인 호출 (사용자가 명시적으로)
> Have marketing-writer draft a blog about TCR Q1 record-breaking,
  then have marketing-editor review it,
  then marketing-publisher prepare it for blog/X/LinkedIn

# 병렬 호출
> In parallel:
  1. Have research-market-analyst analyze SCFI 4-week trend
  2. Have research-lead-profiler look up 'Samsung SDI battery exports'
```

### 5.3 두 도구의 책임 분담

```
[Cursor 가 더 적합한 작업]
─────────────────────────────────────────────
  • 코드 1~2 파일 즉시 편집
  • 인라인 자동 완성
  • Tab으로 빠른 코드 작성
  • Karpathy 규칙은 alwaysApply 로 보호됨

[Claude Code 가 더 적합한 작업]
─────────────────────────────────────────────
  • 멀티 파일 변경 (sub-agent 위임)
  • Writer→Editor→Publisher 체인
  • 비-코드 작업 (블로그/제안서/리서치)
  • CI/CD 자동화 (Cron + Claude Code SDK)
```

---

## 6. Agent 운영 원칙 (Karpathy 응용)

### 6.1 모든 agent에 공통 적용되는 규칙

```
[CLAUDE.md 파일 안에 정의됨 — 모든 agent가 상속]

규칙 1: 추측 금지
  - "아마도", "보통은", "일반적으로" 같은 모호한 표현 X
  - 출처 없으면 web_search 또는 사용자 확인 후 진행

규칙 2: 한국어 우선
  - 외부 영문 출처 인용 시 한국어 번역 + 원문 병기
  - 변수명·코드 주석은 영어 (개발팀 한정)

규칙 3: 출처 표기
  - 모든 사실 주장은 출처 표시
  - 형식: (출처: 기관명, YYYY.MM.DD)

규칙 4: 데이터 미수집 솔직성 (MTL Vol.02 패턴 계승)
  - 모르는 건 "데이터 미수집"이라고 명기
  - 추정으로 채워 넣지 않음

규칙 5: 협업 시 다음 agent에게 명확한 핸드오프
  - 출력 마지막에 "→ 다음 단계: {agent-name} 호출 권장"
  - 또는 "✅ 작업 완료, 사용자 검토 권장"
```

### 6.2 팀별 특수 규칙

```
[마케팅팀]
  • 톤: 전문적이지만 접근 가능한 (Logisight = 인텔리전스 + 친근)
  • 길이: 블로그 1500~2500자, X 280자, LinkedIn 800자
  • 금기: 경쟁사 비방, 검증 안 된 수치

[영업팀]
  • 톤: 신뢰감 + 구체적 수치
  • 가격 명시 X (영업 담당자 권한)
  • 출력에 항상 "MTL 영업 담당자 검토 후 발송" 명기

[리서치팀]
  • 추정과 사실 명확히 분리
  • 모든 데이터 출처·날짜 표기
  • 의견은 명시적으로 "[분석] {내용}" 표기

[디자인팀]
  • Logisight 디자인 토큰 강제 (var(--brand) 등)
  • 접근성 (WCAG AA) 준수
  • 6개국어 지원 고려

[개발팀]
  • Karpathy 4원칙 가장 엄격 적용
  • 테스트 없는 코드는 dev-code-reviewer 가 거부
  • Supabase RLS 정책 누락 시 거부
```

---

## 7. 첫 사용 시나리오 (Quick Start)

### 시나리오 A: 블로그 한 편 발행하기

```bash
$ claude

> 이번 주 SCFI 동향 블로그 글 써줘. 한국 화주 대상, 1800자, SEO 최적화

# Claude Code가 자동으로:
# 1. marketing-writer 호출 → drafts/2026-05-10-scfi-week-19.md 생성
# 2. marketing-editor 호출 → 검수 (이번 회차 통과)
# 3. marketing-publisher 호출 → published/ 디렉터리에 4개 채널 파일 생성

# 사용자 확인 후
> Show me the X version

# X(트위터)용 텍스트 출력됨
```

### 시나리오 B: 잠재 고객 분석

```bash
$ claude

> Logisight 신규 가입자 'kia-motors-export' 의 리드 분석해줘

# 자동 워크플로우:
# 1. sales-lead-analyzer 호출 → leads/kia-motors-export/profile.json
# 2. research-lead-profiler 자동 호출 → research.md
# 3. (Score ≥ 60이면) sales-proposal-writer 호출 → draft.md
#    아니면 → "Lead score 45, 일반 메일링 리스트 추가 권장"
```

### 시나리오 C: HS-Code 페이지 개발

```bash
$ claude

> HS-Code 검색 결과 페이지에 5개국 관세율 비교 차트 추가해줘. Recharts 사용

# 자동 워크플로우:
# 1. dev-frontend 호출 → 가정 명시 후 사용자 확인 받음
# 2. 코드 작성 → src/pages/HsDetail.tsx 수정
# 3. dev-code-reviewer 자동 호출 → 검수
# 4. 통과 시 사용자에게 diff 요약 보고
```

---

## 8. 비용 / 토큰 관리

```
[기본 모델: Sonnet (대부분 agent)]
─────────────────────────────────────────────
  agent 1회 호출 평균 비용: $0.05~0.30
  일평균 호출 (예상): 50~100회
  월 비용: $75~$900

[Haiku로 강등 가능한 agent (속도/비용 우선)]
─────────────────────────────────────────────
  marketing-publisher (단순 포맷팅)
  sales-followup-writer (반복 패턴)
  → 월 비용 절반 절감 가능

[Opus 권장 (정확도 최우선)]
─────────────────────────────────────────────
  research-lead-profiler (deep-dive)
  research-market-analyst (격주 보고서 분석)
  → 월 8~10회 호출이므로 $20~$50 추가만
```

---

## 9. 관리·확장 가이드

### 9.1 agent 추가 시

```
1. .claude/agents/{new-agent}.md 파일 생성
2. YAML frontmatter 작성 (name, description, tools, model)
3. system prompt 작성 — 다음 항목 포함:
   - 역할 정체성 (1줄)
   - 호출 시점 (When to invoke)
   - 입력/출력 명세
   - 금기 사항 (Don'ts)
   - 핸드오프 규칙
4. .claude/agents/README.md 에 1줄 추가
5. Claude Code 세션 재시작 (또는 /agents 로 즉시 적용)
```

### 9.2 agent 수정 시 (Karpathy 3번 적용)

```
✅ 해야 할 것:
  • 변경 이유 명시 (커밋 메시지)
  • 의존하는 다른 agent 영향 검토

❌ 하지 말아야 할 것:
  • 다른 agent의 영역 침범
  • "더 좋아 보여서" 추가 변경
  • 기존 agent의 톤·스타일 임의 변경
```

### 9.3 협업 패턴 디버깅

```
문제: writer→editor→publisher 체인이 끊어짐
─────────────────────────────────────────────
체크 1: writer의 출력 마지막에 "→ marketing-editor" 핸드오프 있는지
체크 2: editor의 description에 "Reviews drafts from marketing-writer"
체크 3: publisher의 description에 "Publishes content approved by editor"

→ description이 명확할수록 자동 위임 정확도↑
```

---

## 10. 다음 액션

```
1. ⬜ 본 문서를 docs/ 에 커밋
2. ⬜ CLAUDE.md (제공된 파일)을 프로젝트 루트에 배치
3. ⬜ .cursor/rules/karpathy-guidelines.mdc 배치
4. ⬜ .claude/agents/ 15개 파일 모두 배치
5. ⬜ Claude Code에서 /agents 로 등록 확인
6. ⬜ 시나리오 A (블로그 발행) 테스트
7. ⬜ 시나리오 C (HS-Code 개발) 테스트
8. ⬜ 1주 운영 후 사용 안 되는 agent 식별 → 제거 (Simplicity First)
```

---

## 부록 A. 모든 Agent의 description 한 페이지 비교

| Agent | description (자동 위임 트리거) |
|-------|------------------------------|
| marketing-writer | 블로그·SNS·콘텐츠 초안 작성 (키워드 리서치 포함) |
| marketing-editor | marketing-writer 또는 보고서의 사실·SEO·톤 검수 |
| marketing-publisher | 검수된 콘텐츠를 채널별(블로그·X·LinkedIn·카카오) 변환 |
| sales-lead-analyzer | Logisight 신규 회원·문의 → 리드 점수·산업 분류 |
| sales-proposal-writer | 분석된 리드 → 맞춤 제안서 초안 작성 |
| sales-proposal-editor | 제안서 검수 + MTL 시사점 강화 |
| sales-followup-writer | 미응답 리드용 팔로우업 이메일 자동 작성 |
| research-market-analyst | 운임·항만·규제 트렌드 분석 ([현상→원인→전망]) |
| research-lead-profiler | 특정 회사 deep-dive (산업·물동량·경쟁구도) |
| design-ui | React/Tailwind UI 컴포넌트 (Logisight 토큰 적용) |
| design-proposal | 제안서 PPT·PDF 레이아웃 |
| design-report | 격주 시장 보고서 PDF 디자인 (Sea-Intel·Larchive 스타일) |
| dev-frontend | React + TypeScript + Vite 프론트 개발 |
| dev-backend | Supabase Edge Functions·DB 스키마 |
| dev-scraper | Playwright 데이터 수집기 (Auto-Drafter STEP 1) |
| dev-code-reviewer | 모든 코드 변경 read-only 검수 (Karpathy 4원칙 강제) |

---

*본 문서는 Cursor + Claude Code 환경에서 Logisight 프로젝트를 5개 가상 팀(15 sub-agent)으로 운영하기 위한 종합 가이드입니다. Karpathy 4원칙은 모든 agent가 상속하며, 마케팅·영업·보고서 발행은 명시적인 Writer→Editor→Publisher 체인으로 운영됩니다. 단순함을 유지하기 위해 agent 수를 15개로 제한했으며, 사용 빈도가 낮은 agent는 1개월 운영 후 제거를 권장합니다.*
