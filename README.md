# Logisight — MTL Shipping Agency

> 한국·CIS·중앙아시아 특화 Logistics Intelligence Platform

---

## 개요

Logisight는 MTL Shipping Agency가 운영하는 외부 공개 물류 인텔리전스 사이트입니다. 컨테이너 운임 트래킹, 시장 분석, AI 보고서 자동 생성, HS-Code 검색 기능을 제공합니다.

## 주요 기능

- 📊 **Market Intelligence Hub** — SCFI, WCI, KCCI, FBX 운임 지수 실시간 대시보드
- 🚢 **컨테이너 트래킹** — 10대 선사 통합 추적
- 🚂 **TCR/TSR Land Bridge Hub** — CIS·중앙아시아 철도 노선 특화
- 🔢 **HS-Code 검색** — 5개국 관세율 비교
- 🤖 **AI 보고서 자동 생성** — 격주 시장 보고서 자동화

## 기술 스택

```
Frontend  : React 18 + TypeScript + Vite + Tailwind CSS
Backend   : Supabase (PostgreSQL + Edge Functions)
AI        : Claude Sonnet (Anthropic)
Scraping  : Playwright + GitHub Actions
Deploy    : Vercel
i18n      : 6개국어 (ko/en/zh/ru/uz/ja)
```

## 프로젝트 구조

```
logisight/
├── src/              # React 프론트엔드
├── supabase/         # DB 마이그레이션 + Edge Functions
├── workers/          # 데이터 수집기 (14개 collector)
├── content/          # 블로그/뉴스레터 콘텐츠
├── scripts/          # PDF 생성, 이메일 발송
├── .claude/          # Claude Code AI agent 정의
└── .github/          # CI/CD + 자동화 워크플로우
```

## 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| 0 | 레포 구조 세팅 | 🚧 진행 중 |
| 1 | 콘텐츠 자동화 (블로그/뉴스레터) | ⬜ 예정 |
| 2 | 데이터 수집기 14개 | ⬜ 예정 |
| 3 | React 프론트엔드 | ⬜ 예정 |
| 4 | Supabase 백엔드 | ⬜ 예정 |
| 5 | 완전 자동화 | ⬜ 예정 |

## 개발 시작

```bash
npm install
npm run dev
```

## 라이선스

Private — MTL Shipping Agency 내부 프로젝트
