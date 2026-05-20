# CLAUDE.md — Logisight Project Memory

이 파일은 Claude Code가 Logisight 프로젝트에서 작업할 때 매 세션 자동으로 읽는다.
Karpathy 4원칙 + Logisight 프로젝트 규칙을 통합한다.

---

## Part 1: Karpathy Behavioral Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## Part 2: Logisight Project Context

### 2.1 프로젝트 개요

```
Logisight = MTL Shipping Agency가 운영하는 외부 공개 logistics intelligence 사이트
포지션  : 한국·CIS·중앙아시아 특화 인텔리전스 + 컨테이너 트래킹 + AI 어시스턴트
타겟    : 한국 화주, 포워더, MTL 영업 리드 채널
도메인  : logisight.mtlship.com (또는 별도 .com)
백엔드  : Supabase (별도 프로젝트, MTL Link와 분리)
```

### 2.2 기술 스택 (변경 시 사용자 확인 필수)

```
Frontend  : React 18 + TypeScript + Vite
Styling   : Tailwind CSS (또는 MTL Link 호환 CSS 변수)
i18n      : react-i18next (ko/en/zh/ru/uz/ja 6개국어)
Backend   : Supabase (PostgreSQL + Edge Functions Deno)
DB Vector : pgvector (HS-Code·뉴스 의미 검색)
Scraping  : Playwright on Vercel Functions
AI        : Claude Sonnet (Anthropic SDK) + OpenAI Embeddings
Charts    : Recharts (또는 ECharts)
Maps      : Leaflet (또는 Mapbox)
Deploy    : Vercel (frontend) + Supabase (backend)
Cron      : GitHub Actions
```

새로운 라이브러리 추가 전에는 **반드시** 사용자에게 확인. (Karpathy 1번 원칙)

### 2.3 9대 모듈 (PRD v1.1 기준)

```
1. HS-Code 글로벌 비교 검색 (5개국)
2. 해상 컨테이너 통합 트래킹 (10대 선사)
3. 항공 화물 트래킹 (AWB)
4. Market Intelligence Hub (KCCI/SCFI/WCI/FBX/MBCI/Bunker)
5. TCR/TSR Land Bridge Hub ★ MTL 차별화
6. AI Assistant + Auto Bi-Weekly Report Generator ★ 핵심
7. Blank Sailing & Capacity Tracker
8. Geopolitical & Risk Heatmap
9. Trade Policy & Regulation Watch
```

### 2.4 1단계 vs 2단계 구분

```
1단계 (현재 개발 대상): 외부 비용 ZERO, 6개월 내 자체 개발
  → 공공데이터 + 무료 공개 + 웹 스크래핑 + Claude API

2단계 (현재 미진행): 1단계 출시 후 매출 발생 시점에만
  → Sea-Intelligence 구독, ShipsGo API, 자체 ML 모델 등

★ 2단계 기능을 1단계에서 미리 구현하지 말 것 (Karpathy 2번)
```

---

## Part 3: 프로젝트 코드 규칙

### 3.1 디렉터리 구조 (확정)

```
logisight/
├── src/                    # React frontend
│   ├── pages/              # 페이지별 컴포넌트
│   ├── components/         # 재사용 컴포넌트
│   ├── hooks/
│   ├── lib/                # supabase client, util
│   └── locales/            # i18n
├── workers/                # 데이터 수집기 (TS, Vercel Functions)
│   └── collectors/
├── supabase/
│   ├── migrations/         # SQL 마이그레이션
│   └── functions/          # Edge Functions (Deno)
├── .claude/agents/         # 본 문서가 참조하는 sub-agent 정의
├── .cursor/rules/          # Cursor 규칙
└── docs/                   # PRD, 지시문, 가이드
```

### 3.2 명명 규칙

```
파일명     : kebab-case (hs-code-search.ts)
컴포넌트   : PascalCase (HsCodeSearch.tsx)
함수·변수  : camelCase
DB 테이블  : snake_case (hs_master, report_snapshots)
Edge Func  : kebab-case (ai-report-draft, container-track)
```

### 3.3 변경 가능 vs 불가능 영역

```
[변경 가능 — agent 자유롭게]
  src/pages/{새 페이지}      ← 신규 페이지
  src/components/{새 컴포넌트}  ← 신규 컴포넌트
  workers/collectors/{새 collector}  ← 신규 수집기
  supabase/functions/{새 function}    ← 신규 함수
  .claude/agents/*.md         ← agent 정의

[변경 시 사용자 확인 필수]
  src/lib/supabase.ts        ← Supabase 클라이언트 설정
  src/locales/*               ← 번역 (브랜드·법적 문구)
  supabase/migrations/*       ← 기존 마이그레이션 수정 X (새로 추가만)
  package.json                ← 새 의존성
  .env.local                  ← 환경변수
  CLAUDE.md (이 파일)         ← 프로젝트 규칙 자체

[변경 금지]
  MTL Link 프로젝트의 어떤 파일도 X
  타 회사 IP·로고·디자인 차용 X
```

### 3.4 Supabase 사용 규칙

```
1. 모든 테이블에 RLS 정책 필수
2. Service role key는 Edge Function 안에서만 사용
3. Frontend는 anon key만 사용
4. RLS 우회 금지 (security definer function 신중히)
5. 마이그레이션은 새 파일로만 추가 (기존 수정 X)
6. Logisight DB와 MTL Link DB는 완전 분리
```

### 3.5 외부 데이터 사용 규칙 (저작권·라이선스)

```
✅ 허용:
  • 한국 공공데이터 (관세청·해양수산부·인천공항)
  • 무료 공개 헤드라인 (Drewry WCI, OneKSA, KOBC)
  • 정부 공식 RSS (USTR, EU CBAM, IMO)
  • OFAC SDN List (무료)

⚠️ 출처 표시 필수:
  • 모든 외부 데이터는 (출처: 기관명, YYYY.MM.DD) 형식
  • 데이터 표시 옆에 "원문 보기" 링크

❌ 금지:
  • Sea-Intelligence Sunday Spotlight 본문 인용 (구독 전)
  • Drewry 유료 보고서 본문 인용
  • Xeneta 데이터 직접 사용
  • 선사 robots.txt 위반 스크래핑
  • 자동화 명시적 금지 사이트 스크래핑
```

---

## Part 4: Sub-Agent 사용 가이드

### 4.1 .claude/agents/ 에 등록된 15개 agent

```
🎯 마케팅팀 (3): marketing-writer / marketing-editor / marketing-publisher
💼 영업팀   (4): sales-lead-analyzer / sales-proposal-writer
                  sales-proposal-editor / sales-followup-writer
🔍 리서치팀 (2): research-market-analyst / research-lead-profiler
🎨 디자인팀 (3): design-ui / design-proposal / design-report
💻 개발팀   (4): dev-frontend / dev-backend / dev-scraper / dev-code-reviewer (★)

(★) dev-code-reviewer는 모든 코드 변경 후 자동 호출 권장
```

### 4.2 자동 위임 vs 명시적 호출

```
[자동 위임이 정확히 작동하는 경우]
  사용자: "블로그 글 써줘"
    → marketing-writer 자동 호출 (description 매칭)

[명시적 호출이 필요한 경우]
  사용자: "Use the dev-code-reviewer subagent on src/pages/HsDetail.tsx"
    → 명시적으로 review 요청
```

### 4.3 Writer → Editor → Publisher 체인 강제 호출

```
마케팅·영업 콘텐츠는 항상 3단계 거쳐야 함:
  • marketing-writer → marketing-editor → marketing-publisher
  • sales-proposal-writer → sales-proposal-editor → (사용자 검토)

Claude Code는 writer 작성 완료 시 다음 핸드오프 표기:
  "✅ 초안 완료. → 다음 단계: marketing-editor 호출 권장"
```

### 4.4 모든 코드 변경 후 dev-code-reviewer 호출

```
dev-frontend / dev-backend / dev-scraper 가 작업 완료 시:
  마지막 줄에 항상 "→ dev-code-reviewer 호출 권장"

이는 Karpathy 4번 원칙 (Goal-Driven Execution)의 verify 단계에 해당.
```

---

## Part 5: 한국어 / 다국어 규칙

```
1. 사용자 대화 : 한국어 (사용자가 영어로 시작하면 영어로 응답)
2. 코드 주석   : 영어 (글로벌 기여 가능성)
3. 변수·함수명 : 영어 (camelCase)
4. UI 문자열   : ko 키 + 5개국어 번역 (locales/)
5. DB 데이터   : 원문 그대로 보존 + 한국어 요약 컬럼 별도
6. 에러 메시지 : 사용자용은 한국어, 로그용은 영어
```

---

## Part 6: 컨텍스트 절약 (Karpathy 응용)

```
[큰 작업은 sub-agent로 분리]
  이유: sub-agent는 분리 컨텍스트 → 메인 세션 토큰 절약
  예: 49p 보고서 분석 → research-market-analyst 위임

[큰 파일 읽기 전 사용자 확인]
  10,000 토큰 이상 파일은 읽기 전 의도 확인
  필요한 부분만 grep/glob 으로 좁히기

[에이전트 위임 시 명확한 입력]
  ✅ "research-market-analyst, 2026-W19 SCFI 데이터를 분석해 [현상→원인→전망] 작성"
  ❌ "이거 분석해줘" (입력 불명확)
```

---

## Part 7: 자주 하는 실수 방지

```
실수 1: 새 컴포넌트 만들 때 비슷한 게 이미 있는지 확인 안 함
   → 작업 전 반드시 grep "HsSearch" 또는 글로벌 검색

실수 2: Supabase 함수 안에서 직접 fetch (Edge runtime fetch는 다름)
   → Deno fetch API 사용, Node.js 패턴 X

실수 3: i18n 키 추가 시 5개국어 번역 누락
   → ko 키 추가 시 en/zh/ru/uz/ja 동시 추가 (없으면 ko fallback 명시)

실수 4: 운임 데이터 표시할 때 출처/날짜 누락
   → 모든 운임 데이터 옆에 "(KOBC, 2026.MM.DD)" 형식 필수

실수 5: 컨테이너 트래킹 결과를 Logisight가 직접 만든 것처럼 표시
   → 항상 "Source: 선사명" + "Updated at" + 선사 사이트 링크
```

---

## Part 8: 보안

```
✅ 환경변수만 사용 (하드코딩 X)
   - SUPABASE_URL, SUPABASE_ANON_KEY (frontend OK)
   - SUPABASE_SERVICE_ROLE_KEY (Edge Function only)
   - ANTHROPIC_API_KEY, OPENAI_API_KEY (Edge Function only)

✅ B/L·컨테이너 번호는 30일 후 익명화

✅ RLS 정책으로 회원 데이터 보호

❌ 절대 git에 커밋 금지: .env.local, *.key, secrets/
```

---

## Part 9: 핸드오프 패턴 (Agent 간 협업)

```
모든 agent는 작업 완료 시 마지막에 다음 형식으로 핸드오프 표시:

[작업 완료 시]
─────────────────────────────────────────────
✅ 작업 완료
📁 산출물: {파일 경로}
→ 다음 단계: {다음 agent 이름} 호출 권장
   이유: {간단한 이유}

[중단 시]
─────────────────────────────────────────────
⚠️ 진행 보류
❓ 확인 필요: {질문}
   현재까지 작업: {경로}
   재개 방법: 사용자 답변 후 동일 agent 재호출

[거부 시 (editor agent)]
─────────────────────────────────────────────
❌ 검수 불통과
🔄 재작성 필요
   사유: {3줄 이내 사유}
   → {writer agent}에게 재의뢰
```

---

## Part 10: 이 파일을 수정할 때

```
이 CLAUDE.md 파일 자체를 수정할 때:
  1. 수정 이유를 사용자에게 먼저 제시
  2. diff 형식으로 변경 사항 보여줌
  3. 사용자 승인 후 적용
  4. 수정 후 모든 agent 재시작 권장 (변경 사항 반영)

특히 Part 1 (Karpathy 4원칙)은 수정 금지.
프로젝트 특수 사정으로만 Part 2~9 추가/수정 허용.
```

---

*이 파일은 Logisight 프로젝트 루트(/CLAUDE.md)에 위치하며, Claude Code가 매 세션 자동으로 읽는다. Cursor 사용자는 .cursor/rules/karpathy-guidelines.mdc 가 alwaysApply: true 로 함께 작동한다. 두 도구는 같은 4원칙을 공유한다.*
