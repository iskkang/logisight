# Logisight PRD v1.1 — 글로벌 인텔리전스 통합판

**작성일**: 2026-05-10
**버전**: v1.1 (v1.0의 확장판)
**대상**: MTL Shipping Agency 경영진 + Codex/Cursor 개발팀
**v1.0 대비 주요 변경**: ① 글로벌 인텔리전스 사이트 10여 곳 분석 + 도입 가능 기능 매트릭스 ② 1단계(자체 개발) vs 2단계(외부 sourcing) 명확 구분 ③ 모듈 6 → 9개로 확장 ④ Auto Bi-Weekly Report Generator 신설 ⑤ Codex Auto-Drafter 지시문은 별도 파일(`Codex_Auto_Drafter_Instructions.md`)로 분리

---

## 0. v1.0 → v1.1 핵심 변경 요약

```
v1.0 (2026-05-10 작성, Logisight 첫 PRD)
─────────────────────────────────────────
  6대 모듈, HS-Code 글로벌 비교 중심
  공공데이터 30개 URL 분석 (관세청·PORT-MIS·인천공항)
  컨테이너/항공 트래킹 + 운임 지수 + 항만 정보 + AI

v1.1 변경점 (현재)
─────────────────────────────────────────
  ① 사용자 업로드 자료 4건 분석 결과 통합:
     - Hansol Biweekly (PPT-PDF, 16p, 자사 광고형)
     - LX Pantos Weekly (4p, 짧고 핵심)
     - Larchive Weekly (49p, 종합 인텔리전스)
     - MTL Vol.02 (Markdown, 4섹션, 데이터 미수집 솔직 표시)
     → 결론: MTL은 이미 격주 발행 능력 보유.
       진짜 가치는 "데이터 수집·분석·초안 자동화"임

  ② 글로벌 인텔리전스 사이트 10여 곳 검색·분석 결과:
     Lloyd's List Intelligence, Sea-Intelligence, S&P Global Maritime,
     Sea.live (Clarksons), Project44, FourKites, Vizion,
     Windward, Xeneta, Drewry, Container xChange, Portcast,
     TRADLINX (한국), Larchive (한국)
     → 도입 가능 기능 매트릭스 작성 (Section 1)

  ③ 6개 모듈 → 9개로 확장:
     기존 4번(운임/시장)을 "Market Intelligence Hub"로 격상
     모듈 7 (Blank Sailing & Capacity), 8 (Geopolitical Risk),
     9 (Trade Policy & Regulation Watch) 신규
     모듈 5 (TCR/TSR Land Bridge Hub) 대폭 확장 — MTL 차별화 핵심
     모듈 6 (AI Assistant) 안에 "Auto Bi-Weekly Report Generator" 신설

  ④ 모든 기능을 1단계(자체 개발 가능) vs 2단계(외부 sourcing 필요)로 분리

  ⑤ Codex 지시문 분리 → Codex_Auto_Drafter_Instructions.md
```

---

## 1. 글로벌 Logistics Intelligence 사이트 매트릭스

> 사용자(대표님)가 본인 보여주신 4개 보고서 외에 "다른 인텔리전스 사이트의 고유 기능"을 요청하셔서, 각 사이트의 핵심 차별점과 Logisight 도입 가능 여부를 정리합니다.

### 1.1 Tier S — 글로벌 1군 (라이선스 매우 비쌈, 참고만)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ① Lloyd's List Intelligence (Seasearcher)                              │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 해운 시장 130년+ 권위지, vessel·risk·compliance 통합        │
│  핵심   : 5 pillars (Fleet visibility, Risk, Compliance, Trade,        │
│           Casualty), "Ask the Analyst" — 인간 애널리스트 직접 질문      │
│  데이터 : 12,000+ ports, terrestrial+satellite AIS,                    │
│           제재·sanctions DB, vessel ownership 추적                      │
│  가격   : 미공개, 연 €30,000~ (추정, 엔터프라이즈)                     │
│  도입   : ❌ 구독 불가, ⚠️ 무료 백서·기사만 인용 가능                  │
│  Logisight 적용:                                                       │
│    - "Ask MTL Analyst" 기능 모방 → 사용자 질문이 들어오면              │
│      Claude가 AI로 1차 답변 + 실제 인간 영업 담당이 follow-up           │
│    - 5 pillar 구조를 차용 (Fleet/Risk/Compliance/Trade/Casualty)       │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ② Sea-Intelligence (Copenhagen, 분석 전문)                             │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 컨테이너 해운 산업 분석 권위                                  │
│  핵심   : Sunday Spotlight (주간 €1,800/년 뉴스레터)                   │
│           GLP Report (월간 116p PDF + Excel, €2,000/년)                │
│           Schedule Reliability (선사별·항로별 정시 운항률)              │
│           TPI (Trade lane Performance Index)                           │
│  데이터 : 12,000+ vessel arrivals/month, 60+ carriers,                 │
│           300+ services/loops, 34 trade lanes                          │
│  도입   : ⚠️ 구독 시 데이터 활용 가능 (€1,800/년 합리적)               │
│  Logisight 적용:                                                       │
│    - 일요일 발행 패턴 차용 (Logisight도 일요일 자동 발행)              │
│    - "Schedule Reliability"는 자체 산출 어려움                          │
│      → 2단계로 분류 (Sea-Intelligence 구독 후 라이선스 인용)            │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ③ S&P Global Maritime Intelligence (구 IHS Markit)                    │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 글로벌 1위 vessel/port 데이터                                │
│  데이터 : 130,000+ vessels (60초 단위 AIS),                            │
│           16,000+ ports/terminals, 250,000+ vessel risk screening      │
│  특수   : Maritime risk screening (제재·위험선박)                       │
│  가격   : 연 $50,000~+ (엔터프라이즈)                                  │
│  도입   : ❌ 비용 과대, 1·2단계 모두 미적용                            │
│  Logisight 적용:                                                       │
│    - AIS는 한국 해양수산부 공공데이터(15129186) 활용 (1단계)            │
│    - 글로벌 AIS는 marinetraffic.com 무료 한도 또는 vesselfinder.com    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ④ Drewry Maritime Research                                              │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 컨테이너·드라이벌크·탱커·LNG·LPG 연구 + 운임 지수            │
│  주요 지수 (★ Logisight 핵심):                                          │
│    - WCI (World Container Index, 8개 항로)                             │
│    - Intra-Asia Container Index                                        │
│    - Airfreight Index                                                  │
│    - Port Throughput Indices                                           │
│    - Cancelled Sailings Tracker  ← 무료 공개                           │
│    - LSFO Bunker Price Tracker                                         │
│  서비스: Drewry Benchmarking Club (shipper-only),                      │
│          Container Freight Rate Insight, Container Capacity Insight    │
│  도입   : ✅ 무료 공개 데이터 (WCI snapshot, Cancelled Sailings)       │
│           ⚠️ 유료 분석은 라이선스 필요                                  │
│  Logisight 적용:                                                       │
│    - 1단계: 공개 WCI/Cancelled Sailings 스크래핑                        │
│    - 2단계: Drewry 보고서 인용 (출처 표시 후 일부만)                    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑤ Xeneta (노르웨이, 운임 벤치마킹 1위)                                  │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : "실제 계약 운임" 데이터 (quoted 아님) 1위                    │
│  데이터 : 700+ shippers 기여한 contracted+spot rates                   │
│           160,000+ ocean port-port pairs,                              │
│           40,000+ air region-region/airport pairs                      │
│  특수   : Tender Experience — 화주가 입찰 시 평균 25% 비용 절감        │
│           AI Agents 도입 (2025~)                                        │
│  지수   : XSI (Xeneta Shipping Index — 장기 계약 운임)                  │
│  도입   : ⚠️ 구독 시만 (연 €15,000~)                                   │
│  Logisight 적용:                                                       │
│    - 1단계: Xeneta 공개 분석 기사 인용 (출처 표시)                      │
│    - 2단계: 자체 "Anonymous Rate Pool" 구축                            │
│              (MTL 화주 동의하에 익명 운임 데이터 수집·집계)             │
│              → 한국·CIS 시장에서는 Xeneta보다 데이터 풍부할 수 있음    │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Tier A — Visibility/Tracking (직접 경쟁자, 일부 모방 가능)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⑥ Project44 (Movement Platform) — 시장 1위                             │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 글로벌 RTTVP(실시간 운송 가시성) 28% 점유                     │
│  데이터 : 240,000+ carriers, 180+ countries                            │
│  핵심 차별:                                                              │
│    - Predictive ETA ~98% 정확도 (자체 ML 모델)                          │
│    - "Clean Data" GPS 노이즈 필터링 알고리즘                            │
│    - 인수: Ocean Insights, ClearMetal (해상 예측 IP)                   │
│    - Order-level visibility (오더 단위 추적)                            │
│  가격   : 연 $50,000~$500,000 (엔터프라이즈, 미공개)                   │
│  도입   : ❌ 구독 불가능                                                │
│  Logisight 적용 (모방):                                                 │
│    - Predictive ETA → 1단계: AIS + 평균 transit으로 단순 추정           │
│                       2단계: 자체 ML 모델 (3년 데이터 축적 후)         │
│    - Order-level visibility → 회원 가입 사용자에게 제공                 │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑦ FourKites — 시장 2위                                                  │
├────────────────────────────────────────────────────────────────────────┤
│  핵심 차별:                                                              │
│    - Yard Management (야드 운영 최적화)                                 │
│    - Appointment Scheduling (도크 예약 시스템)                          │
│    - Temperature Tracking (리퍼 컨테이너 온도)                          │
│    - Sustainability Dashboard (Scope 3 탄소배출)                        │
│    - 95% ETA accuracy                                                  │
│  Logisight 적용:                                                       │
│    - Sustainability Dashboard → 1단계 모방 가능 (탄소 계산기)           │
│    - Temperature Tracking → 2단계 (IoT 센서 데이터 라이선스)            │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑧ Vizion (API-first ocean visibility)                                  │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : "포털 없이 API만 제공" — 표준화된 컨테이너 이벤트             │
│  핵심   : DCSA 표준 이벤트 코드 (LOADED, DISCHARGED 등)                │
│           기업 자체 시스템에 데이터만 push                              │
│  Logisight 적용:                                                       │
│    - 1단계: Logisight도 자체 트래킹 결과를 API로 노출                   │
│      → 한국 중소 포워더가 자기 시스템에 임베드                          │
│      → MTL의 B2B 매출원이 될 수 있음                                    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑨ Windward (Maritime AI) — LSE 상장                                     │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : Maritime AI 1위, 117,000+ vessels                             │
│  핵심 차별:                                                              │
│    - Behavioral analytics (선박 행동 패턴 학습)                         │
│    - MAI Expert (Gen AI 가상 분석가)                                    │
│    - Sanctions evasion 탐지 (AIS spoofing, GNSS 조작)                  │
│    - Dark fleet (제재 회피 선박) 식별                                   │
│    - Critical Infrastructure Protection (해저케이블 보호)                │
│  도입   : ❌ 구독 불가                                                  │
│  Logisight 적용:                                                       │
│    - "MTL AI Expert" 기능 모방 → Claude Sonnet으로 가상 애널리스트       │
│    - 제재 회피 선박 탐지는 OFAC SDN List 무료 활용 (1단계 가능)         │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑩ Container xChange (컨테이너 임대·매매 마켓플레이스)                  │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : SOC(Shipper Owned Container) 1위 마켓플레이스                 │
│  데이터 : 1,700+ vetted partners, 4,000+ locations,                    │
│           10,000+ routes, 130 global locations real-time price         │
│  특수 기능:                                                              │
│    - xChange Insights (실시간 컨테이너 가격, 2년 추이)                  │
│    - Demurrage & Detention Calculator (70+ ports) ★ 무료 도구           │
│    - Free One-Way Leasing Network                                      │
│  Logisight 적용:                                                       │
│    - D&D Calculator 기능 모방 → 1단계 즉시 가능 (한국·중국·EU 항만)     │
│    - SOC 가격 추이 → 2단계 (Container xChange API 라이선스 필요)        │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑪ Sea.live (Clarksons Research 기반)                                   │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : Pre-trade intelligence + 계약 관리                            │
│  핵심   : 항만/터미널/선석/선박 통합 + 계약 협상 도구                   │
│  Logisight 적용:                                                       │
│    - "Pre-trade intelligence" 개념 차용 → 부킹 전 노선 추천             │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑫ Portcast (싱가포르, 예측 ETA AI)                                      │
├────────────────────────────────────────────────────────────────────────┤
│  핵심   : 부킹 전·이동 중·도착 후 예측 (pre-departure ETA)              │
│           Web App + API 제공                                            │
│  Logisight 적용:                                                       │
│    - Pre-departure ETA → 2단계 (자체 ML 모델 필요)                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Tier K — 한국 사이트 (직접 비교 대상)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⑬ 라카이브 (Larchive — larchive.simplogis.com)                         │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 한국 1위 종합 인텔리전스 + Weekly Report (49p)                │
│  핵심   : 모든 운임 지수 통합, 49페이지 분석 보고서                     │
│           스폰서십 페이지 (회원사 광고)                                  │
│           larchive.simplogis.com 대시보드                                │
│  Logisight 차별 포인트:                                                  │
│    - 라카이브: 보고서 중심, 정적                                         │
│    - Logisight: 라이브 데이터 + 자동 보고서 생성 (CIS 특화)             │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑭ TRADLINX (한국, Ocean Visibility 특화)                                │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 해상 visibility만 특화 (multi-modal X)                        │
│  핵심   : Per-Master B/L 가격 (project44보다 40% 저렴)                  │
│           80% ETA 정확도 향상, 99% 정확도, 12 daily updates             │
│           Customer-facing widget (포워더 사이트 임베드)                  │
│           83,000+ logistics teams 사용 (Samsung, LG Chem 포함)          │
│  Logisight 차별 포인트:                                                  │
│    - TRADLINX: 트래킹만 특화, 운임 지수·정책·뉴스 없음                  │
│    - Logisight: 트래킹 + 9개 모듈 통합 + AI 보고서 생성                │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ ⑮ KOBC (한국해양진흥공사) + OneKSA                                      │
├────────────────────────────────────────────────────────────────────────┤
│  포지션 : 정부 산하, 공식 데이터 무료 공개                              │
│  핵심   : KCCI 공식 발표, OneKSA 통합 페이지                            │
│  Logisight 적용:                                                       │
│    - 1단계: KCCI 공식 데이터를 직접 인용 (OneKSA 파싱)                  │
│    - 출처 표시는 필수                                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.4 매트릭스 요약 — Logisight 도입 우선순위

```
[Tier 1 — 즉시 도입 (1단계)]
─────────────────────────────────────────────────────────────────
  ① Drewry 무료 공개 데이터 (WCI, Cancelled Sailings, LSFO Tracker)
  ② OneKSA 통합 페이지 파싱 (KCCI, SCFI 한 번에)
  ③ Container xChange D&D Calculator 기능 모방
  ④ Project44 "Order-level visibility" UI 패턴 모방
  ⑤ Lloyd's List "Ask the Analyst" → "Ask MTL Expert" 모방
  ⑥ FourKites "Sustainability Dashboard" 모방 (탄소 계산기)
  ⑦ Vizion API-first 사상 차용 (Logisight도 API 노출)
  ⑧ Sea-Intelligence 일요일 발행 패턴 차용
  ⑨ Larchive 49p 보고서 구조 차용 (Auto-Drafter가 자동 생성)

[Tier 2 — 추가 sourcing 필요 (2단계)]
─────────────────────────────────────────────────────────────────
  ① Sea-Intelligence Sunday Spotlight 구독 (€1,800/년)
     → Schedule reliability 데이터 인용
  ② Drewry Container Freight Rate Insight 라이선스
  ③ Xeneta 자체 데이터 풀 구축 (MTL 화주 동의 후 익명 집계)
  ④ S&P Global / Lloyd's Seasearcher 라이선스 (대량 AIS)
  ⑤ Container xChange API (SOC 가격)
  ⑥ Portcast/Windward 식 자체 ML 예측 ETA 모델 구축
  ⑦ ShipsGo / Searates 카리어 데이터 보조 ($2/track)

[Tier 3 — 도입 불가 / 가격 과대]
─────────────────────────────────────────────────────────────────
  ① Project44 / FourKites / Vizion 직접 구독 (엔터프라이즈)
  ② Lloyd's List Intelligence 구독 (€30,000+/년)
```

---

## 2. 1단계 vs 2단계 개발 전략 (★ 핵심)

> 사용자(대표님) 요청: "현실적으로 가능한 거 1단계, 추가 sourcing 필요한 개발은 2단계"
> 아래 표는 모든 기능을 두 단계로 분리한 마스터 매트릭스입니다.

### 2.1 1단계 — 6개월 내 자체 개발 (외부 비용 ZERO)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 개발 가능 근거                                                         │
├──────────────────────────────────────────────────────────────────────┤
│  • 한국 공공데이터 (관세청·해양수산부·인천공항) — 무료, 활용신청만    │
│  • 글로벌 무료 공개 데이터 (Drewry WCI snapshot, OneKSA 통합 페이지)  │
│  • 선사 웹 트래킹 페이지 스크래핑 (Maersk, MSC, ONE, FESCO 등)        │
│  • UN Comtrade, WTO Tariff Download, USITC HTS — 무료 공식 데이터    │
│  • USCBP·EU CBAM·IMO 공식 발표 — 무료 정부 자료                       │
│  • Claude Sonnet API (월 $50~200) — MTL Link와 동일 패턴              │
│  • OpenAI Embedding (월 $20~50)                                       │
│  • Vercel Functions + Supabase 무료/저렴 한도                          │
│  • Playwright on Vercel (스크래핑 무료)                                │
└──────────────────────────────────────────────────────────────────────┘

[1단계 모듈별 기능 명세]

모듈 1: HS-Code 글로벌 비교 검색
  ✅ 한국 데이터 (관세청 HS부호·표준품명·관세율표) — 즉시
  ✅ 미국 USITC HTS — JSON/CSV 분기 다운로드
  ✅ 중국 海关总署 PDF → AI 파싱 (Claude Documents API)
  ✅ 러시아 EAEU TN VED — XLSX 다운로드 (CIS 5개국 공통)
  ✅ 베트남 ASEAN ATR AHTN — PDF 파싱
  ✅ DG/배터리 분류 (UN3480, UN3481 등) 자동 표시
  ✅ FTA 특혜세율 (KORUS, RCEP, 한·중·베·EU) 표시
  ✅ AI 추천 (자연어 → HS-Code 매칭)

모듈 2: 해상 컨테이너 통합 트래킹
  ✅ 10대 선사 웹 스크래핑 (Maersk·MSC·CMA·HPL·ONE·COSCO·OOCL·EVG·HMM·FESCO)
  ✅ Container prefix → 선사 자동 식별 (BIC code DB 활용)
  ✅ DCSA 표준 이벤트로 정규화
  ✅ 해양수산부 AIS 공공데이터(15129186) — 한국 영해 선박
  ✅ marinetraffic.com 무료 한도 활용 (글로벌 AIS 보조)

모듈 3: 항공 화물 트래킹
  ✅ AWB 번호 입력 → 항공사 자동 식별
  ✅ 인천공항 OpenAPI (15129097, 15129099 등)
  ✅ 한국공항공사 OpenAPI (15000126)
  ✅ 항공사 5곳 웹 스크래핑 (KE, OZ, CV, CA/CZ, SU)

모듈 4: Market Intelligence Hub (★ v1.1 대폭 확장)
  ✅ KCCI 종합 + 13개 권역 (KOBC kobc.or.kr 직접 접근 또는 OneKSA 우회)
  ✅ SCFI 종합 + 14개 권역 (Shanghai 항운교역소 sse.net.cn)
  ✅ WCI 종합 + 8개 항로 (Drewry 무료 헤드라인)
  ✅ FBX 글로벌 + FBX01/03/11/13 (Macromicro 우회 또는 Freightos 직접)
  ✅ MBCI (Maersk Broker Chartering Index — Larchive 인용)
  ✅ NCFI (Ningbo) 보조
  ✅ BDI (Baltic Dry, 무료 공개)
  ✅ KCCI Weather Card 4지역 표시 (한솔 스타일 차용)
  ✅ Bunker Price (IFO380/VLSFO/MGO) — Ship & Bunker
  ✅ Jet Fuel Index (S&P Global 공개 헤드라인 + IATA)
  ✅ MOPS (싱가폴 현물) — 한국발 항공 FSC 기준
  ✅ 4주 추이 + WoW/MoM/YoY 자동 계산

모듈 5: TCR/TSR Land Bridge Hub (★ MTL 차별화)
  ✅ CR Express 운행 현황 (crexpress.cn 자동 스크래핑)
  ✅ CR Express 국경 통과 순위 (Horgos, Dostyk, Erenhot)
  ✅ 중국 국가철도국 (NRA) 공식 통계
  ✅ Landbridge 5개 카테고리 자동 큐레이션
     - 요문 (yaowen)
     - 일대일로 (silkroad)
     - 내륙항 (kouan)
     - CIS (cis)
     - 러시아 정보 (russiainfo)
  ✅ Interfax / TASS / RZD Partner / PortNews / Vgudok 자동 번역
  ✅ TITR (Middle Corridor) 동향 (middlecorridor.com)
  ✅ MTL 운영 5개 노선 (TCR/TSR/TMR/TITR/TMGR) 비교 테이블
  ✅ 국경 환적지 4곳 (Dostyk, Horgos, Erenhot, Zabaikalsk)
  ✅ PORT-MIS 공공데이터 (선박관제·입항신고·컨테이너형식승인 등)

모듈 6: AI Assistant + Auto Bi-Weekly Report Generator (★ v1.1 신설)
  ✅ HS 추천 / DG·배터리 체크 / 통관 서류 검증
  ✅ 노선 추천 (해상 vs TCR vs TITR 비교)
  ✅ 운임 트렌드 코멘트 (한국어 자동 생성)
  ✅ 뉴스 요약 (영문→한국어 [현상→원인→전망])
  ✅ MTL 시사점 자동 생성 (영업 검토용)
  ✅ Carrier 비교
  ✅ 운임 협상 도우미
  ✅ ETA 예측 (단순: AIS + 평균 transit, 1단계는 정확도 70~80%)
  ✅ 임시결항 영향 분석
  ✅ Auto Bi-Weekly Report Generator (★ 가장 중요)
     - MTL Vol.02 양식 자동 생성
     - 4섹션: 해운/항공/철도/무역공급망
     - 검토 UI: 영업이 MTL 시사점만 추가
     - PDF 변환 + 이메일 발송 + 사이트 게시
     - 자동 발행 시간 80% 단축

모듈 7: Blank Sailing & Capacity Tracker
  ✅ Drewry Cancelled Sailings — 무료 공개 (drewry.co.uk)
  ✅ 5주 예측 (편수·비율·항로별)
  ✅ 얼라이언스별 결항 (Gemini, Premier, Ocean Alliance, MSC)
  ✅ Top 12 carriers fleet (Alphaliner 무료 공개 일부)

모듈 8: Geopolitical & Risk Heatmap
  ✅ 6개 핫스팟 지도 (호르무즈/홍해/우크라이나/베네수엘라/멕시코/파나마)
  ✅ 주요 뉴스 자동 수집 (Reuters, AP, BBC 무료 RSS)
  ✅ 선사별 WRS (전쟁할증료) 부과 현황 (각 선사 발표문 스크래핑)
  ✅ OFAC SDN List 무료 (제재 선박/회사)

모듈 9: Trade Policy & Regulation Watch
  ✅ 미국 USTR / CBP 공식 발표 RSS
  ✅ EU CBAM / ETS 공식 (taxation-customs.ec.europa.eu)
  ✅ IMO MEPC 발표 (imo.org)
  ✅ 한국 관세청 공지사항 RSS
  ✅ 사용자 등록 HS Code 기반 알림
```

### 2.2 2단계 — 추가 sourcing 필요 (12개월+, 비용 발생)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 도입 조건                                                             │
├──────────────────────────────────────────────────────────────────────┤
│  • 1단계 출시 후 트래픽·매출이 발생한 시점                            │
│  • 외부 라이선스 비용을 감당할 매출 기반 마련                          │
│  • 또는 MTL 영업 가치가 명확히 측정된 후 (광고·리드 제너레이션)        │
└──────────────────────────────────────────────────────────────────────┘

[2단계 외부 sourcing 후보]

★★★ 우선순위 1: Sea-Intelligence Sunday Spotlight 구독
  • 비용     : 연 €1,800 (~250만 원)
  • 추가가치 : 60+ carriers, 300+ services, 34 trade lanes
              schedule reliability 데이터 인용 가능
  • 도입시점 : Logisight 출시 6개월 후
  • Logisight 활용:
     - 모듈 4에 "Schedule Reliability" 위젯 추가
     - Auto-Drafter가 매주 일요일 Sunday Spotlight 인용
       (출처 표시 필수)

★★★ 우선순위 2: ShipsGo Container Tracking API (보조)
  • 비용     : Pay-as-you-go ($2/track) 또는 €99/월 무제한
  • 추가가치 : 자체 스크래핑 실패 시 폴백
              FESCO·소형 선사 커버리지 확대
  • 도입시점 : 모듈 2 트래픽 증가 시 (월 1,000건+)

★★ 우선순위 3: Container xChange API
  • 비용     : 미공개 (예상 연 $5,000~$15,000)
  • 추가가치 : SOC 가격 130 locations, D&D 70+ ports
  • 도입시점 : SOC 사용 화주 영업 강화 시점

★★ 우선순위 4: Drewry Container Freight Rate Insight 라이선스
  • 비용     : 연 $5,000~$10,000 (추정)
  • 추가가치 : Drewry 공식 분석을 합법적으로 인용
  • 도입시점 : 보고서 신뢰도 강화 시점

★ 우선순위 5: 자체 "Anonymous Rate Pool" 구축 (Xeneta 모방)
  • 비용     : 개발 비용만 (라이선스 X)
  • 조건     : MTL 화주 30곳 이상 동의 → 익명 운임 공유
  • 추가가치 : 한국·CIS 시장에서 Xeneta보다 풍부한 데이터
              MTL이 운임 벤치마크 권위 사이트로 격상
  • 도입시점 : 1단계 출시 후 12개월 (화주 신뢰도 확보 후)

★ 우선순위 6: 자체 ML 기반 Predictive ETA 모델 (Portcast/Project44 모방)
  • 비용     : 데이터 사이언티스트 인건비 (월 1,000만~)
  • 조건     : 3년 트래킹 데이터 축적 (Phase 1 종료 후)
  • 추가가치 : ETA 정확도 70~80% → 90%+ 향상
  • 도입시점 : 데이터 축적 후

★ 우선순위 7: Lloyd's List / S&P Global AIS 라이선스
  • 비용     : 연 $30,000~$50,000 (협상)
  • 추가가치 : 글로벌 130,000+ 선박 60초 단위 AIS
  • 도입시점 : 엔터프라이즈 고객 매출 발생 후

[비용 시뮬레이션 — 2단계 진입 후 1년차]
─────────────────────────────────────────────────────────────────
  Sea-Intelligence              €1,800     /년
  ShipsGo (선택, 백업용)        €1,200     /년
  Container xChange API         $10,000    /년
  Drewry Insight                $7,500     /년
  자체 Rate Pool (개발)         $0 (인건비만)
  ─────────────────────────────────────────
  합계                          약 2,500만 원/년

  (1단계 1년차 광고 수익 200~500만 원/월 가정 시 5~10개월 차에 흑자 전환)
```

---

## 3. 모듈별 상세 정의 (v1.0 + v1.1 통합)

### 3.1 모듈 메뉴 구조 (최종)

```
[Logisight 메인 네비게이션 - 11개 메뉴]
─────────────────────────────────────────────────
🏠 홈                  — 오늘의 시황 1페이지 요약
📊 Market Intelligence — 모듈 4 (운임 지수·Bunker·Weather Card)
🔍 Tracking            — 모듈 2·3 (해상·항공·선박)
🔢 HS-Code             — 모듈 1 (5개국 비교)
🚂 Land Bridge         — 모듈 5 (TCR/TSR/TITR + CIS)
🌍 Risk Map            — 모듈 8 (지정학 히트맵 + WRS)
📜 Policy Watch        — 모듈 9 (관세·CBAM·IMO)
📰 News                — 글로벌·한국·중국·러시아 자동 수집
🤖 AI Assistant        — 모듈 6
📑 Report Studio       — Auto Bi-Weekly Report Generator
⚙️ 마이페이지           — 즐겨찾기·알림·MTL 영업팀 채널
```

### 3.2 모듈 1: HS-Code 글로벌 비교 검색

```
[1단계 — 6개월 내]
✅ 한국·미국·중국·러시아·베트남 5개국 비교
✅ 6자리(HS-6) 마스터 테이블
✅ 10자리 국가별 매핑 (불완전 매핑 시 "추정 정확도" 표시)
✅ DG/배터리 자동 표시 (UN 번호·class)
✅ FTA 특혜세율 (KORUS, RCEP, 한·EU 등)
✅ UN Comtrade 무역 통계 (5개국 양방향)
✅ AI 추천 (자연어 → HS-Code)
✅ 다국어 검색 (한·영·중·러·베)

[2단계 — 추가 sourcing]
□ 인도(India), 일본(Japan) HS-Code 추가 (3년차)
□ EU TARIC 데이터 (CBAM 연동)
□ AI 분류 정확도 향상 (전문 AI 모델 학습)
```

### 3.3 모듈 2: 해상 컨테이너 통합 트래킹

```
[1단계]
✅ 10대 선사 웹 스크래핑 (Playwright)
   Maersk, MSC, CMA, HPL, ONE, COSCO, OOCL, EVG, HMM, FESCO
✅ DCSA 표준 이벤트 정규화 (LOADED, DEPARTED 등)
✅ Container prefix → 선사 자동 식별
✅ marinetraffic.com 무료 vessel 위치
✅ 한국 PORT-MIS AIS 공공데이터 (15129186)
✅ 신뢰도 표시 (Source/Confidence/Updated)

[2단계]
□ ShipsGo API 백업 ($2/track 또는 €99/월)
□ DCSA 인증 회원가입 (carrier 직접 API 일부 무료 공개)
□ 자체 ML Predictive ETA 모델 (정확도 90%+)
□ Order-level visibility (다중 컨테이너·B/L 통합)
```

### 3.4 모듈 3: 항공 화물 트래킹

```
[1단계]
✅ AWB 번호 prefix → 항공사 식별
✅ 항공사 5곳 웹 스크래핑 (KE, OZ, CV, CA/CZ, SU)
✅ 인천공항 OpenAPI 화물편 운항 매칭
✅ 한국공항공사 OpenAPI (김포·제주 등)

[2단계]
□ 항공사 추가 (LH Cargo, EK Cargo, QR Cargo, AF/KL Cargo)
□ FlightRadar24 라이선스 (글로벌 항공기 위치)
□ IATA Cargo iQ 표준 이벤트 (CXLD, RCS, MAN, RCT 등)
```

### 3.5 모듈 4: Market Intelligence Hub (★ 대폭 확장)

```
[1단계 — 운임 지수 풀 통합]
✅ KCCI       종합 + 13권역 (KOBC 또는 OneKSA)
✅ SCFI       종합 + 14권역 (sse.net.cn)
✅ WCI        종합 + 8항로 (drewry.co.uk 무료)
✅ FBX        글로벌 + FBX01/03/11/13 (macromicro/Freightos)
✅ MBCI       Maersk Broker (Larchive·MB Shipbroker)
✅ NCFI       Ningbo (보조)
✅ BDI        Baltic Dry
✅ FAX        Freightos Air Index
✅ BAI/BAI-B  Baltic Air Freight Index
✅ MOPS       싱가폴 항공유 (한국발 FSC 기준)
✅ Bunker     IFO380/VLSFO/MGO (Ship & Bunker)
✅ Jet Fuel   S&P Global 공개 헤드라인
✅ 4지역 Weather Card (유럽/북미/동남아/서남아)
✅ 4주 추이 그래프 + WoW/MoM/YoY 자동
✅ AI 주간 코멘트 (한국어 자동 생성)

[2단계]
□ XSI 라이선스 (Xeneta 장기 계약)
□ Drewry Container Freight Rate Insight 라이선스
□ Sea-Intelligence Schedule Reliability 데이터
□ 자체 "Anonymous Rate Pool" — MTL 화주 익명 집계
   → 한국·CIS 시장 1차 데이터 권위 확보
```

### 3.6 모듈 5: TCR/TSR Land Bridge Hub (★ MTL 차별화)

```
[1단계]
✅ CR Express 운행 현황 (주간 편수, crexpress.cn)
✅ CR Express 국경 통과 순위 (Horgos, Dostyk, Erenhot)
✅ 중국 국가철도국 (nra.gov.cn) 공식 통계
✅ Landbridge 5개 카테고리 자동 큐레이션
✅ Interfax / TASS / RZD Partner / PortNews / Vgudok 자동 번역
✅ TITR (middlecorridor.com) 동향
✅ MTL 운영 5개 노선 비교 테이블
   - TCR (중국 횡단, 부산→유럽 23~30일)
   - TSR (시베리아, 부산→모스크바 20~27일)
   - TMR (만주, 25~35일)
   - TITR (카스피해, 38~45일) ← Q1 2026 +34.4% 급증
   - TMGR (몽골)
✅ 국경 환적지 4곳 (Dostyk·Horgos·Erenhot·Zabaikalsk) 현황
✅ PORT-MIS 공공데이터 통합 (선박입항·관제·컨테이너 형식승인)

[2단계]
□ MTL 사내 운임 데이터 연동 (영업 시스템 통합)
□ MTL 알마티(카자흐) 법인 데이터 직접 수집
□ Carrier별 TCR 운임 견적 자동 비교
□ TITR 카스피해 페리 일정 통합 (Aktau·Baku)
```

### 3.7 모듈 6: AI Assistant + Auto Bi-Weekly Report Generator (★ 핵심)

```
[1단계 — Auto-Drafter 우선]
✅ HS 추천 / DG·배터리 체크 / 통관 서류 검증
✅ 노선 추천 (해상 vs TCR vs TITR vs Sea&Air)
✅ 운임 트렌드 코멘트 자동 생성
✅ 뉴스 요약 (영문→한국어 [현상→원인→전망])
✅ MTL 시사점 자동 생성 (Vol.02 패턴 학습)
✅ Carrier 비교
✅ 운임 협상 도우미
✅ ETA 예측 (1단계: AIS+평균 transit, 정확도 70~80%)
✅ 임시결항 영향 분석

★ Auto Bi-Weekly Report Generator
  ✅ Vol.02 양식 자동 생성 (4섹션: 해운/항공/철도/무역공급망)
  ✅ 모든 데이터 자동 수집 (모듈 4·5·7·8·9에서)
  ✅ AI 초안 작성 (Claude Sonnet)
  ✅ 검토 UI (영업이 MTL 시사점만 추가)
  ✅ "데이터 미수집" 자동 감지·표시 (Vol.02 솔직성 유지)
  ✅ PDF 변환 + 이메일 발송 + 사이트 게시
  ✅ 격주 작성 시간 16h → 3h

[2단계]
□ ML 기반 Predictive ETA 모델 (90%+ 정확도)
□ 화주별 맞춤 리포트 자동 생성 (회원제)
□ "Ask MTL Expert" 인간 follow-up (Lloyd's 모방)
□ 운임 협상 시뮬레이션 (게임 이론 기반)
```

### 3.8 모듈 7: Blank Sailing & Capacity Tracker (★ 신규)

```
[1단계]
✅ Drewry Cancelled Sailings — 무료 공개 자동 수집
✅ 5주 예측 (편수·비율·항로별)
✅ 얼라이언스별 결항 (Gemini·Premier·Ocean Alliance·MSC)
✅ Top 12 carriers fleet (Alphaliner 무료 헤드라인)
✅ Service network 변경 (포트콜 추가/제거 자동 추출)
✅ 신조선 인도·해체 추이 (Clarksons 공개)

[2단계]
□ Sea-Intelligence schedule reliability 라이선스
□ Alphaliner Premium (선사별 시장점유율 상세)
□ MarineTraffic Premium (vessel position 글로벌)
```

### 3.9 모듈 8: Geopolitical & Risk Heatmap (★ 신규)

```
[1단계]
✅ 6개 핫스팟 지도 (호르무즈/홍해/우크라이나/베네수엘라/멕시코/파나마)
✅ 핫스팟별 최신 뉴스 (Reuters·AP·BBC RSS)
✅ 선사별 WRS (War Risk Surcharge) 현황
✅ OFAC SDN List 무료 (제재 선박/회사)
✅ 핫스팟 영향 받는 항로 자동 매핑
✅ 우회 옵션 추천 (희망봉, TCR 등)

[2단계]
□ Windward MAI Expert 식 행동 패턴 분석 (자체 구축)
□ 위성 영상 (Planet Labs, Maxar) 라이선스
□ 정부 발표 RSS 자동 번역 (CIS 6개국)
```

### 3.10 모듈 9: Trade Policy & Regulation Watch (★ 신규)

```
[1단계]
✅ 미국 USTR / CBP 공식 발표 RSS 자동 번역
✅ EU CBAM / ETS 공식
✅ IMO MEPC 결정 추적
✅ 한국 관세청 공지사항
✅ Section 232 / 301 / IEEPA 추적
✅ 사용자 HS Code 등록 → 영향 정책 자동 알림
✅ FTA 활용 가이드 (KORUS·RCEP·USMCA·KAFTA)

[2단계]
□ Morgan Lewis / KPMG 등 법무법인 분석 라이선스
□ 다국어 정책 알림 (영업 6개국어)
□ AI 영향도 점수 (자동 5단계 평가)
```

---

## 4. 사용자 시나리오 (Personas)

### 4.1 비로그인 일반 사용자

```
1. 검색 엔진에서 "리튬배터리 HS-Code" 검색
2. Logisight 도착 → 8507.60 5개국 비교
3. 사이드 위젯 "이 품목 SCFI 운임 추이"
4. 우측 하단 "MTL 영업팀에 견적 문의" 버튼
   → 양식 작성 → MTL CRM에 리드 자동 등록
```

### 4.2 회원 (포워더 / 화주 담당자)

```
1. 로그인 → 마이페이지에 즐겨찾기 컨테이너 50개
2. 도착 D-3 자동 알림 (이메일·카카오)
3. 리스크 맵에서 "내 화물 통과 예정 지역" 표시
4. Report Studio에서 "내 노선 4월 운임 추이" PDF 다운로드
```

### 4.3 MTL 영업팀

```
1. Auto-Drafter가 일요일 오후 6시 격주 보고서 초안 자동 생성
2. 영업이 월요일 오전 검토 → "MTL 시사점" 코너만 추가 (30분)
3. 발송 버튼 클릭 → 등록된 고객 200명에게 이메일
4. 사이트 공개판도 자동 게시 → SEO 효과
```

---

## 5. 기술 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + TS + Vite)                                   │
│  • Tailwind 또는 MTL Link CSS 변수                              │
│  • react-i18next (6개국어)                                       │
│  • Recharts (차트), Mapbox/Leaflet (지도)                       │
│  • PWA 지원                                                      │
└─────────────────────────────────────────────────────────────────┘
                          ↓ Supabase JS Client
┌─────────────────────────────────────────────────────────────────┐
│  Backend (Supabase — 별도 프로젝트, MTL Link와 분리)            │
│  • PostgreSQL + pgvector (HS·뉴스 의미 검색)                    │
│  • Edge Functions (Deno)                                        │
│    - hs-search          : HS-Code 5개국 검색                    │
│    - container-track    : 컨테이너 트래킹 어댑터 dispatch       │
│    - air-track          : AWB 트래킹                            │
│    - market-snapshot    : 운임 지수 통합 조회                   │
│    - landbridge-feed    : Landbridge·CR Express 큐레이션        │
│    - risk-feed          : 핫스팟 뉴스 통합                      │
│    - policy-feed        : 정책 RSS 통합                         │
│    - ai-chat            : Claude Sonnet 채팅                    │
│    - ai-report-draft    : Auto-Drafter (격주)                   │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  Workers (Vercel Functions or 자체 서버)                        │
│  • Playwright 스크래핑 (선사·운임·뉴스)                         │
│  • RSS 파서                                                      │
│  • Translator (Claude Sonnet — 한국어 자동 번역)                │
│  • Embedding (OpenAI text-embedding-3-small)                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  Cron (GitHub Actions)                                          │
│  • 매시      : 운임 지수 갱신 (모듈 4)                          │
│  • 매일      : 뉴스·정책 갱신 (모듈 8·9)                         │
│  • 주간      : 블랭크 세일링 (모듈 7)                           │
│  • 월간      : 공공데이터 (관세청·PORT-MIS)                     │
│  • 격주 일요일: Auto-Drafter (모듈 6)                            │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  Deploy: Vercel (frontend) + Supabase (backend)                 │
│  Domain: logisight.mtlship.com (또는 별도 .com)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 1단계 로드맵 (6개월 내)

```
Month 1 — 기반
─────────────────────────────────────────────
  Week 1-2: Vercel + Supabase 신규 프로젝트, 도메인
            data.go.kr 활용신청 (Tier 1 데이터 5건)
            랜딩 페이지 + 글로벌 검색바
  Week 3-4: 모듈 1 — HS-Code 한국 데이터 적재 + 검색
            모듈 4 일부 — KCCI/SCFI 운임 위젯

Month 2 — HS-Code 글로벌 + 트래킹 시작
─────────────────────────────────────────────
  Week 5-6: 모듈 1 — 미국·중국 HS-Code 추가
            모듈 4 — WCI/FBX/Bunker 추가
  Week 7-8: 모듈 1 — 러시아·베트남 추가
            모듈 2 — Maersk·MSC·ONE 어댑터

Month 3 — 트래킹 + 항만 + 항공
─────────────────────────────────────────────
  Week 9-10: 모듈 2 — Hapag·COSCO·HMM·FESCO 추가
             모듈 3 — 인천공항 OpenAPI + KE/OZ
  Week 11-12: 모듈 5 — PORT-MIS 데이터 + 부산항 대시보드
              모듈 6 — AI 어시스턴트 1차 (HS·DG)

Month 4 — 인텔리전스 + 정책 + 뉴스
─────────────────────────────────────────────
  Week 13-14: 모듈 7 — Blank Sailing + Fleet
              모듈 8 — Risk Map (6개 핫스팟)
  Week 15-16: 모듈 9 — Policy Watch
              모듈 5 — TCR/TSR + Landbridge 큐레이션

Month 5 — Auto-Drafter (★ 가장 중요)
─────────────────────────────────────────────
  Week 17-18: Auto-Drafter 데이터 수집기
              섹션별 AI 초안 생성 (Claude Sonnet)
  Week 19-20: 검토 UI + PDF 변환 + 이메일 발송
              MTL Vol.03 자동 생성 (시범 발행)

Month 6 — 회원제 + 마케팅
─────────────────────────────────────────────
  Week 21-22: 회원 가입 + 즐겨찾기 + 알림
              MTL 영업팀 1:1 채널
  Week 23-24: SEO 최적화 (HS 6자리 9,000+ 페이지 자동 생성)
              GA·Mixpanel 분석
              정식 외부 공개

산출물 (6개월차 시점):
─────────────────────────────────────────────
  ✅ 9대 모듈 모두 1단계 기능 작동
  ✅ MTL Vol.03 첫 자동 발행
  ✅ 5개국 HS-Code 검색 완비
  ✅ 10개 선사 컨테이너 트래킹
  ✅ 격주 보고서 자동 생성 (영업 시간 80% 절감)
  ✅ 회원 100명+ / 월 organic 트래픽 5,000+
```

---

## 7. 2단계 로드맵 (7~24개월)

```
Month 7-9 — Tier 2 외부 라이선스 도입
─────────────────────────────────────────────
  ✅ Sea-Intelligence Sunday Spotlight (€1,800/년)
  ✅ ShipsGo Tracking API (백업)
  ✅ Drewry Container Freight Rate Insight 협상

Month 10-12 — 자체 데이터 자산 구축
─────────────────────────────────────────────
  ✅ "Anonymous Rate Pool" 베타 (MTL 화주 30곳 동의)
  ✅ Sea&Air 통합 견적 시뮬레이터
  ✅ 회원 1,000명 + 광고 첫 매출

Month 13-18 — AI 모델 자체 구축
─────────────────────────────────────────────
  ✅ Predictive ETA ML 모델 (정확도 90%+)
  ✅ 항만 혼잡 예측
  ✅ "MTL Maritime Expert" Gen AI (Windward MAI Expert 모방)

Month 19-24 — 글로벌 확장
─────────────────────────────────────────────
  ✅ 인도·일본 HS-Code 추가
  ✅ 영어 버전 마케팅 (CIS·인도 화주 타겟)
  ✅ 엔터프라이즈 SaaS 플랜 출시
```

---

## 8. 면책·법적 고려 (v1.0 동일 + 추가)

```
1. 모든 정보는 "참고용" 명시
2. 컨테이너 트래킹은 선사 공식 정보 우선 (선사 사이트 링크 표시)
3. 운임 지수는 원출처 표시 + 라이선스 침해 방지
   - SCFI/CCFI: 헤드라인만 인용, 출처·갱신시각 명시
   - Drewry WCI: 무료 공개 헤드라인만, 유료 분석 인용 X
   - Xeneta XSI: 출처 표시 후 헤드라인만
4. Sea-Intelligence Sunday Spotlight 인용 시:
   - 구독 후 합법 인용
   - "출처: Sea-Intelligence Sunday Spotlight, 2026.MM.DD" 명시
5. 개인정보 (B/L·Container 번호): 30일 후 익명화
6. robots.txt 준수, rate limiting (선사당 분당 10회 이하)
7. 약관에 자동화 명시 금지 선사: "공식 사이트로 이동" 버튼만
8. (★ 신규) AI 생성 보고서: "AI 자동 작성, MTL 검토 완료" 명시
   - 화주가 의사결정에 사용 시 책임 한계 표기
```

---

## 9. ROI / 사업 가치 (v1.0 + 갱신)

```
[정량 가치 — 1년차 기준 추정]
─────────────────────────────────────────────────
  영업팀 시간 절감 (격주 보고서 16h→3h × 26회 × 시급 5만원)
                              = 1,690만 원/년
  Logisight 광고 매출         = 200~500만 원/월 × 12 = 2,400~6,000만 원
  Logisight 회원 → MTL 영업 리드 (월 100건 × 전환율 5% × 평균 매출 50만원)
                              = 3,000만 원/월
  외부 SaaS 플랜 (2단계)      = 10건 × 10만원/월 × 12 = 1,200만 원

  운영비
  - Supabase Pro              = 30만 원/월 = 360만 원/년
  - Vercel Pro                = 30만 원/월 = 360만 원/년
  - Claude API                = 30만 원/월 = 360만 원/년
  - 도메인·기타               = 100만 원/년
  - (2단계) Sea-Intelligence  = 250만 원/년
  ─────────────────────────────────────────────────
  1년차 순이익 추정           = +5,000만 원~3억 원
  3년차 누적                  = +5억 원~10억 원

[정성 가치]
─────────────────────────────────────────────────
  "MTL은 데이터 회사이기도 하다" 브랜드 격상
  CIS·중앙아시아 영업 차별화 강화
  기존 고객 락인 (보고서·알림·트래킹)
  사내 직원 도구로도 활용
  Logisight 자체가 매각 가능한 IT 자산
```

---

## 10. 다음 액션 — 오늘 결정

```
1. ⬜ 도메인 결정
   A. logisight.mtlship.com (서브도메인)
   B. 별도 .com (logisight.com / mtlsight.com 등)

2. ⬜ Supabase 신규 프로젝트 생성

3. ⬜ data.go.kr 회원가입 + 활용신청 (Tier 1)
   - 관세청 HS부호 (15049721)
   - 관세청 표준품명 (15049722)
   - 관세청 관세율표 (15051179)
   - 인천공항 화물편 운항현황 다국어
   - 인천공항 여객기 정기운항편 (15095059)

4. ⬜ 첫 모듈 결정 (Codex 첫 투입)
   A. 모듈 1 HS-Code (SEO·차별화 효과)
   B. Auto-Drafter (영업팀 시간 절감 즉효)
   ★ 추천: A부터 시작 → B는 Month 5

5. ⬜ Codex/Cursor 작업자 배정 + STEP 1 지시문 투입
   (별첨 Codex_Auto_Drafter_Instructions.md 참조)

6. ⬜ 데이터 다운로드 담당자 지정 (수작업 첫 1회만)
   - USITC HTS JSON
   - EAEU TN VED XLSX
   - 중국 海关总署 PDF
   - ASEAN ATR PDF
```

---

## 11. 부록 — Codex 지시문 분리

이 PRD의 13장(v1.0)에 있던 Codex 지시문은 별도 파일로 분리되었습니다:

```
파일: Codex_Auto_Drafter_Instructions.md
내용: STEP 1 (데이터 수집기)
      STEP 2 (AI 초안 생성기)
      STEP 3 (검토·발행 UI)
※ HS-Code 모듈 Codex 지시문은 PRD v1.0의 13장 그대로 유지 (재사용)
```

---

*본 PRD v1.1은 글로벌 인텔리전스 사이트 14곳 (Lloyd's·Sea-Intelligence·S&P Global·Drewry·Xeneta·Project44·FourKites·Vizion·Windward·Container xChange·Sea.live·Portcast·라카이브·TRADLINX) 분석을 통합한 결과입니다. 1단계는 외부 비용 ZERO로 6개월 내 자체 개발 가능하며, 2단계는 1단계 매출 발생 후 합리적 라이선스만 도입합니다. 가장 핵심 기능은 모듈 6의 "Auto Bi-Weekly Report Generator"로, MTL의 격주 발행 시간을 80% 단축시켜 즉각적 ROI를 확보합니다.*
