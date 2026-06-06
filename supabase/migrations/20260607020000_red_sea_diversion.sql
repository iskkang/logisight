-- T1-1: Red Sea / Cape of Good Hope Diversion — 어드민 수동 입력 테이블.
-- Drewry Red Sea Diversion Tracker는 등록/로그인 게이트(무료) → 자동 스크레이핑 불가.
-- 어드민이 격주(Drewry 발행 주기 맞춤) 수동 입력 → forecast supply.effective_capacity_chg_pct 소스.
-- 입력 데이터: Drewry 사이트 로그인 후 수기 확인한 케이프/수에즈 비율.
-- DO NOT APPLY automatically — admin-managed, run manually after review.

create table if not exists red_sea_diversion (
  id              bigint generated always as identity primary key,
  as_of           date not null,                  -- Drewry 발행 기준일 (격주 화요일)
  cape_share_pct  numeric not null check (cape_share_pct >= 0 and cape_share_pct <= 100),
                                                   -- 케이프 경유 선복 비율 (%)
  suez_share_pct  numeric check (suez_share_pct >= 0 and suez_share_pct <= 100),
                                                   -- 수에즈 경유 선복 비율 (%) — 선택
  source          text not null default 'Drewry Red Sea Diversion Tracker (admin-input)',
  note            text,                            -- 어드민 메모 (e.g. "복귀 시작 징후")
  created_at      timestamptz not null default now(),
  unique (as_of)                                   -- 기준일당 1행
);

-- 어드민 전용 — 서비스 롤 키로만 INSERT/UPDATE 허용.
-- RLS 활성화: 공개 읽기(forecast 생성 파이프라인), 쓰기는 service_role만.
alter table red_sea_diversion enable row level security;

create policy "red_sea_diversion_read"
  on red_sea_diversion for select
  using (true);  -- forecast 파이프라인(service_role)과 anon 읽기 허용

-- INSERT/UPDATE/DELETE는 service_role(RLS bypass) 전용 — 별도 정책 불필요.

comment on table red_sea_diversion is
  'Drewry Red Sea Diversion Tracker 어드민 수동 입력. 격주 화요일 업데이트. '
  'cape_share_pct → buildDiversion() → supply.effective_capacity_chg_pct';
comment on column red_sea_diversion.cape_share_pct is
  '케이프 경유 선복 비율(%). buildDiversion()이 이 값을 SSOT 밴드(−10~15%)로 변환.';
comment on column red_sea_diversion.suez_share_pct is
  '수에즈 경유 선복 비율(%). 참고용 — 직접 사용하지 않음.';
