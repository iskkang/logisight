-- 015: maritime_news 컬럼 추가 (Lovable에서 직접 추가된 것 역산 문서화)
-- 009 기본 스키마 이후, 013 agent_type 제약 이전에 추가된 컬럼들.
-- 운영 DB에 이미 존재하므로 IF NOT EXISTS/IF EXISTS 패턴 사용.

ALTER TABLE maritime_news
  ADD COLUMN IF NOT EXISTS category   TEXT,
  ADD COLUMN IF NOT EXISTS agent_type TEXT,
  ADD COLUMN IF NOT EXISTS is_hero    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_url  TEXT,
  ADD COLUMN IF NOT EXISTS tags       TEXT[],
  ADD COLUMN IF NOT EXISTS content    TEXT,
  ADD COLUMN IF NOT EXISTS slug       TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_maritime_news_category
  ON maritime_news(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_maritime_news_slug
  ON maritime_news(slug) WHERE slug IS NOT NULL;
