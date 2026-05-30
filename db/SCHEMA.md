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
| weekly_briefings | 018 | pipeline/generators/email | Lovable /news | ✅ | |
| weekly_briefing_points | 018 | pipeline/generators/email | Lovable /news | ✅ | |
| trade_statistics | 017 | pipeline/collectors | Lovable (지도) | ✅ | 관세청/해수부 공공데이터 |
| policy_alerts | 019 | 수동 or pipeline | Lovable /policy | ✅ | CBAM, EU ETS 등 |
| newsletter_subscribers | 020 | Lovable (구독 폼) | pipeline/publishers | ❌ | 개인정보 — service_role만 |
| user_roles | 021 | Lovable (auth) | Lovable | 인증만 | app_role enum |
| data_updates | 022 | pipeline | 모니터링 | ✅ | 수집 상태 추적 |
| tcr_snapshots | 011 | pipeline/collectors | Lovable /eurasia | ✅ | |
| port_throughput | 010 | pipeline/collectors | Lovable (지도) | ✅ | |

## 뷰(View)

| 뷰 | 마이그레이션 | 설명 |
|----|------------|------|
| v_maritime_articles | 014 | agent_type IN (shipping,corp,brief,weekly_brief) + content >= 400자 |

## agent_type 값 목록 (maritime_news)

| 값 | 용도 | 파이프라인 생성자 |
|----|------|----------------|
| `shipping` | 해운·철도 시황 웹 기사 | generators/web/generate-article-shipping.js |
| `corp` | 기업 동향 웹 기사 | generators/web/generate-article-corp.js |
| `brief` | 브리프 웹 기사 | generators/email/generate-article-brief.js |
| `weekly_brief` | 주간 브리핑 요약 | generators/email/ |
| `daily_card` | 이메일 일간 카드 | generators/web/publish-daily-cards-to-site.js |
| `external` | 외부 링크 카드 (본문 없음) | collectors/ |
