ALTER TABLE maritime_news
  ADD COLUMN IF NOT EXISTS image_source TEXT,
  ADD COLUMN IF NOT EXISTS image_credit TEXT;

COMMENT ON COLUMN maritime_news.image_source IS 'original or unsplash';
COMMENT ON COLUMN maritime_news.image_credit IS 'Display-ready image attribution';

CREATE INDEX IF NOT EXISTS idx_maritime_news_public_category
  ON maritime_news(category, published_at DESC)
  WHERE lang = 'ko';
