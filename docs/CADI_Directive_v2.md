# Claude Code 지시문 — Logisight CADI v2
> 저장일: 2026-05-23 | 원본: 사용자 제공 자기완결형 지시문 (부록 A·B·C 포함)
> 상태: Phase 0.5~6 구현 완료. Phase 7(배포)·8(베이스 모듈)은 별도.

---

## 핵심 결정 사항 (구현 확정)

| 항목 | 결정값 |
|------|--------|
| Lane 체계 | OD 쌍: KR-ANDIJAN/OSH/BISHKEK/CHUKURSAY/ALMATY/MALASZEWICZE; CN-* |
| route_pattern | kashi \| khorgos \| northern \| tsr |
| 1차 데이터 소스 | https://link.mtlship.com/api/tcr?action=list (무인증 GET, 현재) |
| 발행 단위 | days (저장=hours, 표시 레이어 변환) |
| 표본 게이팅 | confirmed(n≥5) / provisional(2≤n<5) / indicative(n<2) |
| 자동화 경계 | 수집·초안·배포 자동 / POV·검수 사람 필수 |
| 빌드 순서 | CADI(스파이크) 먼저 → 베이스 모듈(Phase 8) |
| 언어 | CADI=영어 우선 / 베이스 모듈=한국어 우선 |

---

## 0.1 포지셔닝 — 광의 Logisight 안의 CADI

**베이스(광의 플랫폼):** 운임지수·뉴스·해상/항공 트래킹·HS코드 = 한국 고객 table-stakes + 도메스틱 영업 리드. 한국어 우선.

**스파이크(CADI):** 중앙아 딜레이 인텔리전스 = 유일 차별화 + 글로벌 재방문 가치. 영어 우선.

**홈 hook = CADI(유일한 것).** 운임·뉴스는 그 아래 모듈.

---

## 완료 Phase (재작성 금지)

| Phase | 내용 | 상태 |
|-------|------|------|
| 0.5 | Supabase cloud (hmgbvqczmyjixkqbruzp), VITE_ 키, supabase.ts | ✅ |
| 1 | DB 스키마 5개 마이그레이션 (OD lanes 11개, RLS, CHECK 제약) | ✅ |
| 2 | tracing_live.ts (180건 실증, SHA-256 anon, PII strip, Node 20 compat) | ✅ |
| 3 | disruption_events 2건 (Event A 진행중 HIGH / Event B 해소 HIGH) | ✅ |
| 4 | Edge Functions 4개 배포 (cadi-lanes, cadi-weekly, alerts, reports) | ✅ |
| 5 | Frontend (Home, CadiDashboard, NewsAnalysis, Methodology, Subscribe, AlertCard) | ✅ |
| 6 | GitHub Actions (cadi-ingest.yml 월요일 크론, weekly-report.yml collect:live) | ✅ |

---

## 미완료 (의도적 지연)

| 항목 | 이유 |
|------|------|
| Phase 7: Vercel 배포 | MTL Link read 토큰 적용 후 + 보안 정리 후 |
| Phase 8: 베이스 모듈 전체 | CADI 운영 안정화(첫 주보 사이클) 후 착수 |
| W17~W18 DOSTYK 원인 Layer B | 우즈벡/중국 현장 담당자 확인 대기 |
| 주보 질문지→자동 생성 연결 | research-market-analyst + newsletter 체인 연결 작업 |
| MTL Link read 토큰 | MTL Link 팀 작업 필요 |

---

## Phase 8 예고 (베이스 모듈 — CADI 안정화 후)

원본 PRD v1.1 (`docs/Logisight_PRD_v1_1.md`) 모듈 1~4·7~9:
- ① HS-Code 5개국 관세 검색
- ② 해상 컨테이너 트래킹 (10선사)
- ③ 항공 트래킹 (AWB)
- ④ Market Intelligence Hub (SCFI·WCI·KCCI·FBX·Bunker)
- ⑦ Blank Sailing
- ⑧ Geopolitical Risk Heatmap
- ⑨ Trade Policy Watch

**베이스 데이터 이슈 (Phase 8 착수 시 해결):**
- SCFI: 한국 IP 차단 → container-news.com 우회
- KCCI: JS렌더링 → data.go.kr API 신청
- news_industry: Playwright → fetch 전환
- 일부 RSS URL 재확인

---

## 하드 제약 (불변)

- 프라이버시: 외부 노출 = 집계치만. 개별 화물·고객 절대 금지
- RLS: shipment_legs = service-role only. Frontend = anon only
- 외부 데이터: 무료·공개만. Xeneta·Drewry 유료·Sea-Intelligence 본문 금지
- 자동화 경계: POV(4) + 검수(5) = 사람 필수. 완전 자동화 금지
- 신규 의존성: 사전 승인 필수
