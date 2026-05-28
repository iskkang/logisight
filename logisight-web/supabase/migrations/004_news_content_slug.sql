-- 004_news_content_slug.sql
-- maritime_news에 content(본문), slug(URL 식별자) 컬럼 추가

ALTER TABLE maritime_news ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE maritime_news ADD COLUMN IF NOT EXISTS slug   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS maritime_news_slug_uniq
  ON maritime_news(slug) WHERE slug IS NOT NULL;
