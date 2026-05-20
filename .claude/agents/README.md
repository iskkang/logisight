# Logisight Sub-Agents — 5개 팀 / 15 Agents

이 디렉터리는 Claude Code의 sub-agent 정의 파일들을 담고 있다. 각 `.md` 파일은 Markdown + YAML frontmatter 포맷이며, Claude Code가 자동 위임 또는 명시적 호출로 사용한다.

> 자세한 설계·워크플로우는 [`docs/Logisight_Multi_Agent_Setup.md`](../../docs/Logisight_Multi_Agent_Setup.md) 참조.

---

## 한눈 요약

```
🎯 마케팅팀 (3): Writer → Editor → Publisher 체인
   ├ marketing-writer       블로그/SNS 초안
   ├ marketing-editor       사실·SEO·톤 검수 (거부 권한)
   └ marketing-publisher    채널별 변환 (블로그/X/LinkedIn/카카오)

💼 영업팀 (4)
   ├ sales-lead-analyzer    회원 데이터 → 리드 점수 (0~100)
   ├ sales-proposal-writer  맞춤 제안서 초안 (Top 2~3 강점 매칭)
   ├ sales-proposal-editor  검수 + MTL 시사점 강화
   └ sales-followup-writer  팔로우업 이메일 6 시나리오

🔍 리서치팀 (2)
   ├ research-market-analyst   시장 분석 [현상→원인→전망] 3단
   └ research-lead-profiler    회사 deep-dive (7 영역)

🎨 디자인팀 (3)
   ├ design-ui              UI 컴포넌트 명세 (Tailwind 토큰)
   ├ design-proposal        제안서 PDF/PPT 디자인
   └ design-report          격주 보고서 디자인 (Sea-Intel + Larchive 스타일)

💻 개발팀 (4) ★ Karpathy 가장 엄격
   ├ dev-frontend           React + TS + Vite + Tailwind
   ├ dev-backend            Supabase Edge Functions + RLS
   ├ dev-scraper            Playwright 데이터 수집기 (14 collectors)
   └ dev-code-reviewer      모든 변경 read-only 검수 ★ 자동 호출
```

---

## 협업 패턴 (체인)

### Pattern 1: Writer → Editor → Publisher (마케팅 콘텐츠)

```
사용자: "호르무즈 운임 영향 블로그 글 써줘"
        ↓
marketing-writer
  → drafts/2026-MM-DD-{slug}.md (초안)
        ↓
marketing-editor
  → 검수 PASS / REVISE / REJECT
  → PASS 시 Front-matter status: "ready_to_publish"
        ↓
marketing-publisher
  → 4채널 파일 (블로그.md, x.txt, linkedin.md, kakao.txt)
  → meta.json
```

### Pattern 2: Lead → Research → Proposal → Edit → Design (영업)

```
신규 회원 가입
  ↓
sales-lead-analyzer (점수 0~100)
  ↓ Score ≥ 60
research-lead-profiler (deep-dive)
  ↓
sales-proposal-writer (초안)
  ↓
sales-proposal-editor (시사점 강화)
  ↓
design-proposal (PDF 명세)
  ↓
dev-frontend (PDF 변환)
  ↓
영업 담당자 검토 → 발송
```

### Pattern 3: Auto Bi-Weekly Report (격주 보고서)

```
일요일 18:00 KST → GitHub Actions
  ↓
dev-scraper (14 collectors → Supabase report_snapshots)
  ↓
research-market-analyst (4섹션 분석)
  ↓
marketing-editor (보고서 검수)
  ↓
design-report (PDF 디자인 명세)
  ↓
dev-frontend (Puppeteer/React PDF 변환)
  ↓
월요일 오전 영업팀 → MTL 시사점 추가 → 발송
```

### Pattern 4: 개발 (Karpathy 강제)

```
사용자 요청
  ↓
dev-frontend / dev-backend / dev-scraper
  ↓ 항상
dev-code-reviewer (read-only 검수)
  ↓ PASS
사용자 검토 → merge
```

---

## 모델 선택 (model 필드)

```
sonnet  : 대부분 agent (균형)
opus    : research-* (정확도 최우선) — 비용 약간 높음, 호출 빈도 낮으니 OK
haiku   : marketing-publisher, sales-followup-writer (반복 패턴) — 속도/비용
```

각 agent의 frontmatter `model:` 필드에서 변경 가능. 기본값은 모두 `sonnet`.

---

## 도구 권한 (tools 필드)

```
Read 전용 (검수자):
  - dev-code-reviewer        (Read, Glob, Grep, Bash read-only)
  - marketing-editor          (Read, Edit, Glob, Grep)
  - sales-proposal-editor     (Read, Edit, Glob, Grep)

Write 가능 (콘텐츠·문서):
  - marketing-writer          (Read, Write, Edit, Glob, Grep, WebSearch, WebFetch)
  - sales-proposal-writer     (Read, Write, Edit, Glob, Grep)
  - sales-followup-writer
  - research-*                (+ WebSearch, WebFetch)
  - design-*                  (Read, Write, Edit, Glob, Grep)

전체 (개발자):
  - dev-frontend              (Read, Write, Edit, Glob, Grep, Bash)
  - dev-backend
  - dev-scraper
```

---

## 자주 쓰는 호출 패턴

```bash
# 자동 위임 (description 매칭)
> 이번 주 SCFI 분석 블로그 글 써줘
   → marketing-writer 자동 호출

# 명시적 호출
> Use the dev-code-reviewer subagent on src/pages/HsDetail.tsx

# 체인 명시
> Have marketing-writer draft about TCR Q1 record,
  then marketing-editor review,
  then marketing-publisher prepare for blog/X/LinkedIn

# 병렬 호출
> In parallel:
  1. research-market-analyst on shipping section for vol 4
  2. research-market-analyst on rail section for vol 4
  3. research-market-analyst on trade section for vol 4

# 영업 워크플로우
> Analyze new lead 'kia-motors-export' and prepare proposal if score >= 60
   → sales-lead-analyzer 자동 호출
   → score 72 → research-lead-profiler + sales-proposal-writer 자동 체인
```

---

## Agent 추가/수정 가이드

### 새 agent 추가 시

```
1. .claude/agents/{name}.md 파일 생성
2. YAML frontmatter 작성:
   ---
   name: agent-name
   description: 자동 위임 트리거 명확히 (가장 중요)
   tools: Read, Write, Edit, ...
   model: sonnet
   color: blue | yellow | green | cyan | purple | pink | red | orange
   ---
3. 시스템 프롬프트 본문 (역할·프로세스·금기)
4. README.md (이 파일)에 1줄 추가
5. Claude Code 세션 재시작 또는 /agents 로 즉시 적용
```

### Agent 수정 시 (Karpathy 3번 적용)

```
✅ 해야 할 것:
  • 변경 이유 commit message에 명시
  • 의존하는 다른 agent 영향 검토

❌ 하지 말아야 할 것:
  • 다른 agent 임의 수정
  • 톤·스타일 한꺼번에 통일 시도
  • 사용 중인 description 변경 (자동 위임 깨짐)
```

---

## 운영 모니터링

```
[1주 후 점검]
- 어떤 agent가 가장 많이 호출됐나? (활용도)
- 어떤 agent는 한 번도 호출 안 됐나? (제거 후보)
- writer→editor→publisher 체인이 자연스럽게 작동하나?

[1개월 후 점검 — Simplicity First]
- 사용 빈도 < 3회/월인 agent 제거 검토
- 두 agent 역할이 겹치면 통합
- description 명확도 개선 (자동 위임 정확도 향상)
```

---

## 트러블슈팅

```
[증상 1] 자동 위임이 안 됨
─────────────────────────────────
원인: description 모호
해결: description 첫 줄을 "X를 한다" 형식으로 명확히
      트리거 단어 (블로그, 제안서, 컴포넌트 등) 포함

[증상 2] 체인이 끊어짐
─────────────────────────────────
원인: writer 출력 마지막에 핸드오프 누락
해결: 모든 agent 출력 마지막에 다음 형식 포함
      "→ 다음 단계: {agent-name} 호출 권장"

[증상 3] dev-code-reviewer 호출 안 됨
─────────────────────────────────
원인: dev-frontend/backend 가 핸드오프 안 함
해결: CLAUDE.md Part 4.4 명시 + agent 본문에 "→ dev-code-reviewer 필수" 강조

[증상 4] 토큰 비용 폭주
─────────────────────────────────
원인: 한 sub-agent에 너무 큰 입력
해결: research-market-analyst 같은 agent는 한 번에 한 섹션만
      (4섹션 동시 X)
```

---

## 변경 이력

```
v1.0 (2026-05-10) — 초기 생성
  - 5개 팀 / 15 agents 정의
  - Writer→Editor→Publisher 패턴
  - Karpathy 4원칙 통합
```
