# Logisight — 레포 전체 설계 및 로드맵

**작성일**: 2026-05-11
**현재 상태**: agent 설계도 + PDF 생성 스크립트만 존재
**목표**: 완전한 logistics intelligence 플랫폼

---

## 1. 전체 레포 구조 (최종 목표)

```
logisight/
│
├── .github/
│   └── workflows/
│       ├── daily-news.yml          # 매일 뉴스 수집
│       ├── weekly-report.yml       # 매주 보고서 자동 생성
│       └── deploy.yml              # Vercel 자동 배포
│
├── .claude/
│   ├── agents/                     # 15개 AI agent (완료)
│   └── commands/                   # 슬래시 커맨드
│       ├── blog-polish.md          # (완료)
│       ├── weekly-report.md        # 주간 보고서 생성
│       └── daily-brief.md          # 일일 뉴스 브리핑
│
├── .cursor/
│   └── rules/
│       └── karpathy-guidelines.mdc # (완료)
│
├── src/                            # Phase 3 — React 프론트엔드
│   ├── pages/
│   │   ├── Home.tsx                # 오늘의 시황 한 페이지
│   │   ├── Market.tsx              # 운임 지수 대시보드
│   │   ├── Tracking.tsx            # 컨테이너 트래킹
│   │   ├── HsCode.tsx              # HS-Code 검색
│   │   ├── LandBridge.tsx          # TCR/TSR 허브
│   │   ├── RiskMap.tsx             # 지정학 리스크
│   │   ├── Policy.tsx              # 정책 모니터
│   │   ├── News.tsx                # 뉴스 피드
│   │   ├── Reports.tsx             # 보고서 아카이브
│   │   └── AiAssistant.tsx         # AI 어시스턴트
│   ├── components/
│   │   ├── market/                 # 운임 지수 카드, 차트
│   │   ├── tracking/               # 트래킹 UI
│   │   ├── report/                 # 보고서 뷰어
│   │   └── shared/                 # 공통 컴포넌트
│   ├── hooks/
│   ├── lib/
│   │   └── supabase.ts
│   └── locales/                    # 6개국어 (ko/en/zh/ru/uz/ja)
│
├── supabase/                       # Phase 4 — 백엔드
│   ├── migrations/
│   │   ├── 0001_create_hs_tables.sql
│   │   ├── 0002_create_report_tables.sql
│   │   ├── 0003_create_news_tables.sql
│   │   └── 0004_create_tracking_tables.sql
│   └── functions/
│       ├── hs-search/              # HS-Code 검색 API
│       ├── container-track/        # 컨테이너 트래킹
│       ├── market-snapshot/        # 운임 지수 조회
│       ├── ai-chat/                # AI 어시스턴트
│       └── ai-report-draft/        # 보고서 자동 생성
│
├── workers/                        # Phase 2 — 데이터 수집기
│   └── collectors/
│       ├── index.ts                # 마스터 dispatcher
│       ├── shipping_indices.ts     # KCCI, SCFI, WCI, FBX
│       ├── bunker.ts               # IFO/VLSFO/MGO
│       ├── air_indices.ts          # FAX, BAI, MOPS
│       ├── blank_sailing.ts        # Drewry 결항 트래커
│       ├── fleet.ts                # Alphaliner Top 12
│       ├── rail_tcr.ts             # CR Express + NRA
│       ├── rail_tsr.ts             # RZD / PortNews
│       ├── news_global.ts          # JOC, Loadstar RSS
│       ├── news_korea.ts           # 카고뉴스 RSS
│       ├── news_china.ts           # Landbridge 5 카테고리
│       ├── policy_us.ts            # USTR, CBP RSS
│       ├── policy_eu.ts            # CBAM, ETS
│       ├── policy_imo.ts           # IMO MEPC
│       └── utils/
│           ├── rate_limiter.ts
│           ├── playwright_pool.ts
│           └── snapshot_writer.ts
│
├── content/                        # Phase 1 — 콘텐츠 자동화
│   ├── drafts/                     # AI 초안
│   ├── published/                  # 발행된 콘텐츠
│   └── styles/                     # 참고 스타일 가이드
│       ├── loadstar-style.md
│       └── mtl-house-style.md
│
├── scripts/
│   ├── generate-pdf.js             # (완료) PDF 변환
│   └── send-newsletter.js          # 이메일 발송
│
├── docs/
│   ├── Logisight_PRD_v1_1.md      # PRD (완료)
│   ├── Logisight_Multi_Agent_Setup.md
│   └── Codex_Auto_Drafter_Instructions.md
│
├── CLAUDE.md                       # (완료)
├── .gitignore
├── package.json                    # 루트 패키지
├── vite.config.ts
└── tsconfig.json
```

---

## 2. 단계별 로드맵

### Phase 0 — 레포 기반 세팅 (지금 당장, 1~2일)

```
목표: GitHub 레포에 올바른 뼈대 구조 완성

할 일:
  ✅ GitHub 레포 생성 (완료: github.com/iskkang/logisight)
  ⬜ .gitignore 작성
  ⬜ 루트 package.json 작성
  ⬜ tsconfig.json 작성
  ⬜ vite.config.ts 작성
  ⬜ README.md 작성
  ⬜ 전체 폴더 구조 생성 (빈 폴더 + .gitkeep)
  ⬜ 기존 파일 정리 후 git push

산출물:
  - 올바른 폴더 구조를 가진 깨끗한 레포
  - node_modules, .env 등 제외된 .gitignore
```

### Phase 1 — 콘텐츠 자동화 (1~4주)

```
목표: 블로그/뉴스레터 자동 생성 파이프라인

할 일:
  ⬜ content/styles/ 참고 스타일 가이드 추가
  ⬜ .claude/commands/weekly-report.md 작성
  ⬜ .claude/commands/daily-brief.md 작성
  ⬜ scripts/send-newsletter.js (Resend API)
  ⬜ .github/workflows/weekly-report.yml (매주 일요일)
  ⬜ .github/workflows/daily-news.yml (매일 오전)
  ⬜ Ghost 또는 발행 플랫폼 결정

산출물:
  - 매일 자동 뉴스 브리핑 (이메일)
  - 매주 자동 시장 보고서 PDF
  - 발행 플랫폼 연동

비용: Claude API $10~20/월, Resend 무료(3,000건/월)
```

### Phase 2 — 데이터 수집기 (3~8주)

```
목표: 14개 자동 데이터 수집기 구축

할 일:
  ⬜ workers/collectors/utils/ 3개 파일
  ⬜ 운임 지수 수집기 4개 (shipping/bunker/air/blank_sailing)
  ⬜ 뉴스 수집기 3개 (global/korea/china)
  ⬜ 정책 수집기 3개 (us/eu/imo)
  ⬜ 철도 수집기 2개 (tcr/tsr)
  ⬜ .github/workflows/auto-drafter-collect.yml

산출물:
  - 매주 일요일 18:00 자동 데이터 수집
  - 수집 실패 시 Slack 알림
  - is_complete=false 솔직 표시

비용: GitHub Actions 무료 한도 내
```

### Phase 3 — 프론트엔드 (5~12주)

```
목표: Logisight 웹사이트 구축

할 일:
  ⬜ React + TypeScript + Vite 프로젝트 초기화
  ⬜ Tailwind CSS + 디자인 토큰
  ⬜ 6개국어 i18n 설정
  ⬜ 10개 페이지 구현 (홈/시장/트래킹/HS-Code/...)
  ⬜ Recharts 차트 컴포넌트
  ⬜ Vercel 배포

산출물:
  - logisight.mtlship.com 라이브
  - 운임 대시보드 + 트래킹 + HS-Code

비용: Vercel 무료/Pro $20/월
```

### Phase 4 — 백엔드 (8~16주)

```
목표: Supabase 기반 데이터베이스 + API

할 일:
  ⬜ Supabase 프로젝트 생성 (Logisight 전용)
  ⬜ DB 마이그레이션 4개
  ⬜ Edge Functions 5개
  ⬜ RLS 정책 설정

산출물:
  - HS-Code 5개국 검색 API
  - 컨테이너 트래킹 API
  - 운임 지수 저장/조회 API

비용: Supabase 무료/Pro $25/월
```

### Phase 5 — 완전 자동화 (12~24주)

```
목표: 사람 개입 최소화

할 일:
  ⬜ Auto-Drafter 완성 (수집→생성→검토→발행)
  ⬜ 회원 가입 + 알림 시스템
  ⬜ 영업 리드 자동 분석
  ⬜ Sea-Intelligence 구독 연동 (2단계)

산출물:
  - 격주 보고서 발행 시간 16h → 1.5h
  - 월 구독자 1,000명 목표
```

---

## 3. Phase 0 — 지금 당장 만들 파일 목록

Claude Code에 다음 지시문을 입력하면 됩니다:

```
Phase 0 레포 기반 세팅을 진행해줘.
다음 파일들을 순서대로 만들어줘:

1. .gitignore
2. package.json (루트 — React + Vite)
3. tsconfig.json
4. vite.config.ts
5. README.md
6. 빈 폴더 구조 (.gitkeep 포함):
   - src/pages/
   - src/components/market/
   - src/components/tracking/
   - src/components/report/
   - src/components/shared/
   - src/hooks/
   - src/lib/
   - src/locales/
   - supabase/migrations/
   - supabase/functions/
   - workers/collectors/utils/
   - content/styles/
   - .github/workflows/

완료 후 git add . && git commit -m "chore: repo structure setup" && git push
```

---

## 4. 우선순위 결정 가이드

```
지금 당장 필요한 것:
  → Phase 0 (레포 정리) + Phase 1 (콘텐츠 자동화)
  → 이유: 블로그/뉴스레터가 즉각적인 가치 창출

나중에 해도 되는 것:
  → Phase 3/4 (프론트엔드/백엔드)
  → 이유: 웹사이트는 없어도 뉴스레터는 보낼 수 있음

Phase 1 완료 후 기대 효과:
  - 매주 자동 시장 보고서 PDF
  - 매일 뉴스 브리핑 이메일
  - 격주 보고서 작성 시간 16h → 2h
```

---

## 5. 비용 요약 (Phase 0~2 기준)

```
Claude API      $10~30/월
GitHub Actions  무료 (2,000분/월)
Vercel          무료 시작
Supabase        무료 시작
Resend          무료 (3,000건/월)
────────────────────────────
월 합계         $10~30
```
