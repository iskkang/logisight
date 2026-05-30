# db/ — Supabase 스키마 문서

이 디렉토리는 Logisight Supabase 스키마의 소유관계와 관리 원칙을 문서화합니다.
실제 마이그레이션 파일은 `supabase/migrations/`에 위치합니다.

## 스키마 변경 규칙

1. 모든 테이블 구조 변경은 `supabase/migrations/` 마이그레이션 파일로만.
2. Lovable에서 테이블/컬럼을 직접 만들거나 바꾸지 않는다.
3. Supabase 대시보드 SQL Editor에서 직접 ALTER TABLE 금지.
4. 파일명: `YYYYMMDDNNNNNN_설명.sql` (6자리 시퀀스 번호)
5. 마이그레이션은 새 파일 추가만 — 기존 파일 수정 금지.

## 마이그레이션 목록 (`supabase/migrations/`)

| 번호 | 파일 | 내용 |
|------|------|------|
| 001 | 20260523000001_cadi_schema.sql | CADI 코어 스키마 (lanes, shipment_legs, delay_index_weekly, disruption_events) |
| 002 | 20260523000002_cadi_schema_v2.sql | CADI v2 업데이트 |
| 003 | 20260523000003_cadi_od_lanes.sql | OD-pair 레인 정의 (KR→CA 11개) |
| 004 | 20260523000004_cadi_cn_lanes.sql | CN 출발 레인 추가 |
| 005 | 20260523000005_delay_reason_check.sql | delay_reason CHECK 제약 |
| 006 | 20260525000006_freight_indices.sql | 운임 지수 (SCFI/KCCI/WCI/FBX/MBCI) |
| 007 | 20260525000007_bunker_prices.sql | 벙커유 가격 |
| 008 | 20260525000008_blank_sailings.sql | 블랭크 세일링 + 운항신뢰도 |
| 009 | 20260525000009_maritime_news.sql | 해운 뉴스 기본 |
| 010 | 20260527000010_port_throughput.sql | 항만 물동량 |
| 011 | 20260528000011_tcr_snapshots.sql | TCR 스냅샷 |
| 012 | 20260528000012_placeholder.sql | 결번 플레이스홀더 |
| 013 | 20260529000013_agent_type_expand.sql | maritime_news agent_type 확장 |
| 014 | 20260529000014_v_maritime_articles.sql | v_maritime_articles 뷰 |
| 015 | 20260601000015_maritime_news_columns.sql | maritime_news 컬럼 추가 (category/slug/content 등) — 역산 |
| 016 | 20260601000016_freight_rates.sql | 운임공표제 운임 테이블 |
| 017 | 20260601000017_trade_statistics.sql | 한국 무역통계 |
| 018 | 20260601000018_weekly_briefings.sql | 주간 브리핑 |
| 019 | 20260601000019_policy_alerts.sql | 정책 알림 |
| 020 | 20260601000020_newsletter_subscribers.sql | 뉴스레터 구독자 |
| 021 | 20260601000021_user_roles.sql | 사용자 역할 (app_role enum) |
| 022 | 20260601000022_data_updates.sql | 데이터 수집 상태 추적 |

## 적용 방법

운영 DB에 새 마이그레이션을 적용할 때:

```bash
# Supabase CLI 사용 시
supabase db push

# 또는 Supabase 대시보드 → SQL Editor에서 파일 내용 직접 실행
```

> ⚠️ 015~022는 "역산 문서화"용입니다. 운영 DB에 이미 테이블이 존재하면
> `IF NOT EXISTS` 덕에 에러 없이 통과합니다. 실행 전 운영 DB 상태 확인 권장.

## 참고 문서

- [SCHEMA.md](./SCHEMA.md) — 테이블별 소유관계 상세
