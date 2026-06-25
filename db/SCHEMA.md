# Logisight Supabase 스키마 소유관계

## 원칙

- 테이블 구조 변경: `supabase/migrations/` 마이그레이션으로만
- Lovable: anon 키 + RLS 읽기 전용. 테이블 구조 직접 변경 금지.
- 파이프라인: service_role 키로 INSERT/UPDATE만.
- Supabase 대시보드 SQL Editor에서 직접 ALTER TABLE 금지.

## 테이블별 소유관계

| 테이블 | 마이그레이션 | 쓰는 곳 | 읽는 곳 | anon 접근 | 비고 |
|--------|------------|---------|---------|-----------|------|
| lanes | 003~004 | db/migrations (seed) | Lovable /eurasia | ✅ | OD-pair 코리도어 정의 |
| shipment_legs | 001~002 | pipeline/collectors | 없음 (비공개) | ❌ | 원자료, 절대 공개 금지 |
| delay_index_weekly | 001~002 | pipeline/generators/report | Lovable /eurasia | ✅ | 집계치만 공개 |
| disruption_events | 001~002 | pipeline/collectors | Lovable /eurasia | ✅ | |
| freight_indices | 006 | pipeline/collectors | Lovable /rates | ✅ | SCFI/KCCI/WCI/FBX/MBCI |
| freight_rates | 016 | pipeline/collectors | Lovable /rates | ✅ | 운임공표제 KMI |
| bunker_prices | 007 | pipeline/collectors | Lovable /rates | ✅ | |
| blank_sailings | 008 | pipeline/collectors | Lovable /rates | ✅ | |
| schedule_reliability | 008 | pipeline/collectors | Lovable /rates | ✅ | |
| maritime_news | 009,013,015 | pipeline/generators/web | Lovable /news | ✅ | agent_type으로 웹/이메일 구분 |
| weekly_briefings | 018 | generators/web/generate-weekly-briefing.js | Lovable /news | ✅ | 매주 월요일 자동 적재 |
| weekly_briefing_points | 018 | generators/web/generate-weekly-briefing.js | Lovable /news | ✅ | shipping/corp/brief 슬롯 |
| trade_statistics | 017,023 | collectors/trade_stats.ts (월간 확정치), collectors/trade_provisional.ts (10일 잠정치) | Lovable (지도) | ✅ | stat_type: country/provisional_exp/provisional_imp |
| policy_alerts | 019 | 수동 or pipeline | Lovable /policy | ✅ | CBAM, EU ETS 등 |
| newsletter_subscribers | 020 | Lovable (구독 폼) | pipeline/publishers | ❌ | 개인정보 — service_role만 |
| user_roles | 021 | Lovable (auth) | Lovable | 인증만 | app_role enum |
| data_updates | 022 | pipeline | 모니터링 | ✅ | 수집 상태 추적 |
| tcr_snapshots | 011 | pipeline/collectors | Lovable /eurasia | ✅ | 익명 **집계** 일별 스냅샷(총계·운송중·도착·경보). container_no 미저장 |
| tcr_tracking_snapshots | 047 | collectors/tracing_tcr_current.ts | (route_health 경유) | ❌ | append-only 일일 스냅샷(컨테이너×일). 현재상태 덮어쓰기와 별개로 이력 누적. service-only |
| tcr_container_baseline | 047 | collectors/tracing_tcr_current.ts | (route_health 경유) | ❌ | first-seen eta_final 고정 baseline(불변). service-only |
| tcr_route_health | 047 | collectors/tracing_tcr_current.ts (rpc tcr_recompute_route_health) | Lovable /eurasia (전환 후) | ✅ | 노선별 지연 산출 결과(status·avg/max_delay·trend). 함수 tcr_recompute_route_health()가 재계산 |
| port_throughput | 010 | pipeline/collectors | Lovable (지도) | ✅ | 소스: LA·LB·SGP + KOSIS(해양수산부) KRPUS/KRICN/KRGMP 등 한국 항만 TEU |
| industry_briefs | 044 | supabase/functions/industry-brief-generate (Edge, service_role) | Lovable /industries (직접 read) | ✅ | period(YYYY.MM)별 Claude 산업 브리핑 캐시(trade_briefs 043의 산업판 트윈). input_hash 동일 시 재생성 스킵(월1회). 챕터집계 RPC industry_chapter_totals(044) |
| weekly_pick | 045 | supabase/functions/weekly-pick-select (Edge, service_role) | Lovable /news (직접 read) | ✅ | 최근 7일 maritime_news(ko) 점수화(언급량·물류 영향도)로 주1건 자동 선정 캐시. 주당 1행(week_start PK). maritime_news.view_count 도입 시 조회수 신호 가산 |
| reports | 046 | generators/weekly-report/publish-weekly-report.js, generators/report/publish-monthly-report.js | Lovable "마켓 리포트" 랜딩/아카이브 (직접 read) | ✅ | 주간+월간 PDF 통합 카탈로그. weekly_reports(030)는 웹 가독 원본으로 유지, 본 테이블은 PDF 발행 인덱스. PDF는 reports 공개 버킷(weekly/·monthly/). 같은 기간 재발행 시 id로 upsert(덮어쓰기) |

## trade_statistics.stat_type 값 목록

| 값 | 수집기 | 주기 | 비고 |
|----|--------|------|------|
| `country` | collectors/trade_stats.ts | 월 1회 (16일) | 관세청 nationtrade API 확정치 |
| `provisional_exp` | collectors/trade_provisional.ts | 월 3회 (1/11/21일) | 관세청 10일단위 수출 잠정치 |
| `provisional_imp` | collectors/trade_provisional.ts | 월 3회 (1/11/21일) | 관세청 10일단위 수입 잠정치 |

- `priod_dt`: `'01~10'` | `'01~20'` | `'01~말일'` (provisional_* 행에서만 사용)
- `direction`: `'exp'` | `'imp'` (provisional_* 행에서만 사용)
- `country_code = 'ALL'`: 전체 합계 — 지도 히트맵 제외, 합계 검증용

## 뷰(View)

| 뷰 | 마이그레이션 | 설명 |
|----|------------|------|
| v_maritime_articles | 014 | agent_type IN (shipping,corp,brief,weekly_brief) + content >= 400자 |

## agent_type 값 목록 (maritime_news)

| 값 | 용도 | 파이프라인 생성자 |
|----|------|----------------|
| `shipping` | (2026-06-12 폐기 — 신규 생성 없음, 기존 행만 잔존) | (삭제됨, brief로 통합) |
| `corp` | 기업 동향 웹 기사 | generators/web/generate-article-corp.js |
| `brief` | 시황·브리프 웹 기사 (KSG 스타일) | generators/web/publish-curated-to-site.js, generators/email/generate-article-brief.js |
| `weekly_brief` | 주간 브리핑 요약 | generators/email/ |
| `daily_card` | (2026-06-12 폐기 — 신규 생성 없음, 기존 행만 잔존) | (삭제됨) |
| `external` | 외부 링크 카드 (본문 없음) | collectors/ |
