-- ============================================================================
-- Logisight Delta Migration (002)
-- 기존 테이블 (blank_sailings, bunker_prices, delay_index_weekly,
-- disruption_events, freight_indices, lanes, maritime_news, schedule_reliability,
-- shipment_legs) 은 그대로 두고, 홈페이지 기능에 필요한 것만 추가.
--
-- 멱등성(idempotency): 여러 번 실행해도 안전. CREATE IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS 패턴 사용.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. maritime_news 컬럼 확장 (홈페이지 표시용)
-- ----------------------------------------------------------------------------
ALTER TABLE maritime_news
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS agent_type TEXT,
  ADD COLUMN IF NOT EXISTS is_hero BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[];

-- 기존 행에 is_hero NULL → FALSE
UPDATE maritime_news SET is_hero = FALSE WHERE is_hero IS NULL;

-- CHECK 제약 (이미 있으면 스킵)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maritime_news_category_check'
  ) THEN
    ALTER TABLE maritime_news ADD CONSTRAINT maritime_news_category_check
      CHECK (category IS NULL OR category IN ('해상','항공','철도','물류','무역','기업','브리핑','트렌드분석'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maritime_news_agent_type_check'
  ) THEN
    ALTER TABLE maritime_news ADD CONSTRAINT maritime_news_agent_type_check
      CHECK (agent_type IS NULL OR agent_type IN ('shipping','corp','brief'));
  END IF;
END $$;

-- URL 유니크 (시드 재실행 안전 + 중복 기사 방지)
CREATE UNIQUE INDEX IF NOT EXISTS maritime_news_url_uniq ON maritime_news(url) WHERE url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maritime_news_category_published
  ON maritime_news(category, published_at DESC) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_maritime_news_hero
  ON maritime_news(is_hero, published_at DESC) WHERE is_hero = TRUE;
CREATE INDEX IF NOT EXISTS idx_maritime_news_lang_published
  ON maritime_news(lang, published_at DESC);

-- ----------------------------------------------------------------------------
-- 2. weekly_briefings — AI 저널리스트 주간 인사이트 헤더
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_briefings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL DEFAULT '주간 시장 브리핑',
  subtitle        TEXT,
  week_of         DATE NOT NULL UNIQUE,
  published_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefings_week ON weekly_briefings(week_of DESC);

-- ----------------------------------------------------------------------------
-- 3. weekly_briefing_points — 브리핑 카드 3개 (인과 연결 없이 독립)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_briefing_points (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id     UUID NOT NULL REFERENCES weekly_briefings(id) ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN ('시황','기업','글로벌')),
  agent_type      TEXT NOT NULL CHECK (agent_type IN ('shipping','corp','brief')),
  headline        TEXT NOT NULL,
  display_order   INT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(briefing_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_briefing_points ON weekly_briefing_points(briefing_id, display_order);

-- ----------------------------------------------------------------------------
-- 4. policy_alerts — CBAM, EU ETS, 제재 등
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL CHECK (code IN ('CBAM','EU ETS','제재','EAR','전략물자')),
  title           TEXT NOT NULL,
  meta            TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_active ON policy_alerts(is_active, display_order) WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 5. newsletter_subscribers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL UNIQUE,
  status              TEXT DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced')),
  preferences         JSONB DEFAULT '{"categories":["해상","항공","철도","물류","무역"]}'::jsonb,
  source              TEXT,
  subscribed_at       TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed_at     TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 6. freight_rates — 해양수산부 화물운임공표 적재용 (data.go.kr)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS freight_rates (
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
  is_featured         BOOLEAN DEFAULT FALSE,
  is_partner_rate     BOOLEAN DEFAULT FALSE,
  transit_days        INT,
  valid_from          DATE,
  valid_until         DATE,
  data_source         TEXT NOT NULL,
  source_updated_at   TIMESTAMPTZ,
  display_order       INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rates_featured
  ON freight_rates(is_featured, display_order) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_rates_route
  ON freight_rates(pol_code, pod_code, container_type, valid_until DESC);

-- ----------------------------------------------------------------------------
-- 7. data_updates — 업데이트 시각 표시용
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset         TEXT NOT NULL,
  record_count    INT,
  status          TEXT,
  notes           TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_updates_dataset ON data_updates(dataset, updated_at DESC);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE weekly_briefings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_briefing_points     ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_alerts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscribers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE freight_rates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_updates               ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_briefings"       ON weekly_briefings;
DROP POLICY IF EXISTS "public_read_briefing_points" ON weekly_briefing_points;
DROP POLICY IF EXISTS "public_read_policies"        ON policy_alerts;
DROP POLICY IF EXISTS "anyone_can_subscribe"        ON newsletter_subscribers;
DROP POLICY IF EXISTS "public_read_rates"           ON freight_rates;
DROP POLICY IF EXISTS "public_read_updates"         ON data_updates;

CREATE POLICY "public_read_briefings"       ON weekly_briefings       FOR SELECT USING (true);
CREATE POLICY "public_read_briefing_points" ON weekly_briefing_points FOR SELECT USING (true);
CREATE POLICY "public_read_policies"        ON policy_alerts          FOR SELECT USING (is_active = TRUE);
CREATE POLICY "anyone_can_subscribe"        ON newsletter_subscribers FOR INSERT WITH CHECK (true);
CREATE POLICY "public_read_rates"           ON freight_rates          FOR SELECT USING (true);
CREATE POLICY "public_read_updates"         ON data_updates           FOR SELECT USING (true);

-- maritime_news + freight_indices RLS (anon 읽기 활성화, 이미 있으면 스킵)
DO $$ BEGIN
  -- maritime_news
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'maritime_news') THEN
    EXECUTE 'ALTER TABLE maritime_news ENABLE ROW LEVEL SECURITY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='maritime_news'
      AND policyname='public_read_maritime_news'
  ) THEN
    EXECUTE 'CREATE POLICY "public_read_maritime_news" ON maritime_news FOR SELECT USING (true)';
  END IF;

  -- freight_indices
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'freight_indices') THEN
    EXECUTE 'ALTER TABLE freight_indices ENABLE ROW LEVEL SECURITY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='freight_indices'
      AND policyname='public_read_freight_indices'
  ) THEN
    EXECUTE 'CREATE POLICY "public_read_freight_indices" ON freight_indices FOR SELECT USING (true)';
  END IF;
END $$;
