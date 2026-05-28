-- ============================================================================
-- Logisight v1 — Initial Schema (Migration 001)
-- 실행 위치: Supabase Dashboard → SQL Editor → New query → 전체 붙여넣기 → Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. News Articles (저널리스트 에이전트 산출물)
-- ----------------------------------------------------------------------------
CREATE TABLE news_articles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  summary         TEXT,
  content         TEXT,
  category        TEXT NOT NULL CHECK (category IN ('해상','항공','철도','물류','무역')),
  agent_type      TEXT CHECK (agent_type IN ('shipping','corp','brief')),
  source_name     TEXT,
  source_url      TEXT,
  image_url       TEXT,
  tags            TEXT[],
  is_hero         BOOLEAN DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_category_published ON news_articles(category, published_at DESC);
CREATE INDEX idx_news_published          ON news_articles(published_at DESC);
CREATE INDEX idx_news_hero               ON news_articles(is_hero, published_at DESC) WHERE is_hero = TRUE;
CREATE INDEX idx_news_tags               ON news_articles USING GIN(tags);

-- ----------------------------------------------------------------------------
-- 2. Freight Indices (SCFI, KCCI, WCI, FBX, XSI, BAI, VLSFO, CCFI)
-- ----------------------------------------------------------------------------
CREATE TABLE freight_indices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_name          TEXT NOT NULL,
  route               TEXT,
  composite_value     NUMERIC,
  previous_value      NUMERIC,
  weekly_change       NUMERIC,
  weekly_change_pct   NUMERIC,
  display_value       TEXT,
  week_of             DATE NOT NULL,
  data_source         TEXT,
  display_order       INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(index_name, route, week_of)
);

CREATE INDEX idx_indices_name_week ON freight_indices(index_name, week_of DESC);

-- ----------------------------------------------------------------------------
-- 3. Freight Rates (해양수산부 화물운임공표 + MTL 자체)
-- ----------------------------------------------------------------------------
CREATE TABLE freight_rates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier             TEXT,
  pol_code            TEXT NOT NULL,
  pol_name            TEXT,
  pod_code            TEXT NOT NULL,
  pod_name            TEXT,
  container_type      TEXT NOT NULL CHECK (container_type IN ('20DRY','40DRY','40HC','20RF','40RF')),
  rate_usd            NUMERIC,
  currency            TEXT DEFAULT 'USD',
  weekly_change_pct   NUMERIC,
  is_partner_rate     BOOLEAN DEFAULT FALSE,
  is_spot             BOOLEAN DEFAULT TRUE,
  is_featured         BOOLEAN DEFAULT FALSE,
  transit_days        INT,
  valid_from          DATE,
  valid_until         DATE,
  data_source         TEXT NOT NULL,
  source_updated_at   TIMESTAMPTZ,
  display_order       INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rates_route_type   ON freight_rates(pol_code, pod_code, container_type, valid_until DESC);
CREATE INDEX idx_rates_featured     ON freight_rates(is_featured, display_order) WHERE is_featured = TRUE;

-- ----------------------------------------------------------------------------
-- 4. Port Schedules (PORT-MIS 관제정보)
-- ----------------------------------------------------------------------------
CREATE TABLE port_schedules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_code           TEXT NOT NULL,
  terminal_name           TEXT,
  carrier                 TEXT,
  vessel_name             TEXT NOT NULL,
  voyage                  TEXT,
  arrival_estimated       TIMESTAMPTZ,
  berthing_estimated      TIMESTAMPTZ,
  departure_estimated     TIMESTAMPTZ,
  status                  TEXT,
  data_source             TEXT DEFAULT 'PORT-MIS',
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(terminal_code, vessel_name, voyage)
);

CREATE INDEX idx_port_eta      ON port_schedules(arrival_estimated);
CREATE INDEX idx_port_terminal ON port_schedules(terminal_code, arrival_estimated);

-- ----------------------------------------------------------------------------
-- 5. Rail Schedules (TCR/TSR 유라시아 코리도어)
-- ----------------------------------------------------------------------------
CREATE TABLE rail_schedules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_type          TEXT NOT NULL CHECK (route_type IN ('TCR','TSR')),
  origin_station      TEXT NOT NULL,
  destination_station TEXT NOT NULL,
  via                 TEXT,
  service_name        TEXT,
  operator            TEXT,
  transit_days        INT,
  rate_usd_20         NUMERIC,
  rate_usd_40         NUMERIC,
  status              TEXT CHECK (status IN ('정상','지연주의','운휴')) DEFAULT '정상',
  is_featured         BOOLEAN DEFAULT FALSE,
  display_order       INT DEFAULT 0,
  notes               TEXT,
  valid_from          DATE,
  valid_until         DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rail_route    ON rail_schedules(route_type, origin_station, destination_station);
CREATE INDEX idx_rail_featured ON rail_schedules(is_featured, display_order) WHERE is_featured = TRUE;

-- ----------------------------------------------------------------------------
-- 6. Container Tracking (선사 API 프록시 캐시)
-- ----------------------------------------------------------------------------
CREATE TABLE container_tracking_queries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_no        TEXT NOT NULL UNIQUE,
  carrier_detected    TEXT,
  query_count         INT DEFAULT 1,
  last_status         TEXT,
  last_location       TEXT,
  last_event_at       TIMESTAMPTZ,
  raw_response        JSONB,
  cached_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tracking_container ON container_tracking_queries(container_no);

-- ----------------------------------------------------------------------------
-- 7. Newsletter Subscribers
-- ----------------------------------------------------------------------------
CREATE TABLE newsletter_subscribers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL UNIQUE,
  status              TEXT DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced')),
  preferences         JSONB DEFAULT '{"categories":["해상","항공","철도","물류","무역"]}'::jsonb,
  source              TEXT,
  subscribed_at       TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed_at     TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 8. Data Updates Log
-- ----------------------------------------------------------------------------
CREATE TABLE data_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset         TEXT NOT NULL,
  record_count    INT,
  status          TEXT,
  notes           TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_data_updates_dataset ON data_updates(dataset, updated_at DESC);

-- ----------------------------------------------------------------------------
-- 9. Weekly Briefings (AI 저널리스트 주간 인사이트 - 헤더)
-- ----------------------------------------------------------------------------
CREATE TABLE weekly_briefings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL DEFAULT '주간 시장 브리핑',
  subtitle        TEXT,
  week_of         DATE NOT NULL UNIQUE,
  published_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_briefings_week ON weekly_briefings(week_of DESC);

-- ----------------------------------------------------------------------------
-- 10. Weekly Briefing Points (브리핑 카드 3개씩, 인과 연결 없이 독립)
-- ----------------------------------------------------------------------------
CREATE TABLE weekly_briefing_points (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id     UUID NOT NULL REFERENCES weekly_briefings(id) ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN ('시황','기업','글로벌')),
  agent_type      TEXT NOT NULL CHECK (agent_type IN ('shipping','corp','brief')),
  headline        TEXT NOT NULL,
  display_order   INT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(briefing_id, display_order)
);

CREATE INDEX idx_briefing_points ON weekly_briefing_points(briefing_id, display_order);

-- ----------------------------------------------------------------------------
-- 11. Policy Alerts (CBAM, EU ETS, 제재 등)
-- ----------------------------------------------------------------------------
CREATE TABLE policy_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL CHECK (code IN ('CBAM','EU ETS','제재','EAR','전략물자')),
  title           TEXT NOT NULL,
  meta            TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_policies_active ON policy_alerts(is_active, display_order) WHERE is_active = TRUE;

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================
ALTER TABLE news_articles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE freight_indices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE freight_rates                ENABLE ROW LEVEL SECURITY;
ALTER TABLE port_schedules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE rail_schedules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_tracking_queries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscribers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_updates                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_briefings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_briefing_points       ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_alerts                ENABLE ROW LEVEL SECURITY;

-- Public read 정책
CREATE POLICY "public_read_news"            ON news_articles              FOR SELECT USING (true);
CREATE POLICY "public_read_indices"         ON freight_indices            FOR SELECT USING (true);
CREATE POLICY "public_read_rates"           ON freight_rates              FOR SELECT USING (true);
CREATE POLICY "public_read_port"            ON port_schedules             FOR SELECT USING (true);
CREATE POLICY "public_read_rail"            ON rail_schedules             FOR SELECT USING (true);
CREATE POLICY "public_read_tracking"        ON container_tracking_queries FOR SELECT USING (true);
CREATE POLICY "public_read_updates"         ON data_updates               FOR SELECT USING (true);
CREATE POLICY "public_read_briefings"       ON weekly_briefings           FOR SELECT USING (true);
CREATE POLICY "public_read_briefing_points" ON weekly_briefing_points     FOR SELECT USING (true);
CREATE POLICY "public_read_policies"        ON policy_alerts              FOR SELECT USING (is_active = TRUE);

-- 구독: insert-only
CREATE POLICY "anyone_can_subscribe" ON newsletter_subscribers FOR INSERT WITH CHECK (true);

-- ============================================================================
-- 트리거: updated_at 자동 갱신
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_news_updated_at      BEFORE UPDATE ON news_articles              FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_rail_updated_at      BEFORE UPDATE ON rail_schedules             FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_tracking_updated_at  BEFORE UPDATE ON container_tracking_queries FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
