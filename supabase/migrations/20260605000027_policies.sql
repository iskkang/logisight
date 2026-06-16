-- 027: 정책 인텔리전스 풀스펙
-- policy_alerts(3필드 stub)와 별개로 완전한 정책 데이터 저장
CREATE TABLE IF NOT EXISTS policies (
  id                   UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  code                 TEXT    NOT NULL UNIQUE,
  title_ko             TEXT    NOT NULL,
  title_en             TEXT,
  category             TEXT    NOT NULL
    CHECK (category IN ('관세/통관','환경규제','수출통제','FTA','인증','제재','기타')),
  status               TEXT    NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','announced','expired','suspended')),
  impact_level         TEXT    NOT NULL DEFAULT 'medium'
    CHECK (impact_level IN ('critical','high','medium','low')),
  region               TEXT[],           -- 영향 지역 (예: ['US','CN','EU'])
  affected_lanes       TEXT[],           -- 영향 노선 (예: ['TCR','TSR'])
  hs_codes             TEXT[],           -- 해당 HS 코드
  carriers             TEXT[],           -- 해당 선사/항공사
  effective_date       DATE,
  expiry_date          DATE,
  compliance_deadline  DATE,
  source_url           TEXT,
  summary_ko           TEXT,
  summary_en           TEXT,
  impact_description   TEXT,
  penalty_description  TEXT,
  is_active            BOOLEAN DEFAULT true,
  display_order        INTEGER,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read"    ON policies FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write" ON policies FOR ALL   TO service_role USING (true);
