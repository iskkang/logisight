-- Migration 007: fix trade_statistics UNIQUE constraint
-- Remove stat_type from the composite key; (period, hs_code, country_code) is sufficient.

DO $$ BEGIN
  ALTER TABLE trade_statistics
    DROP CONSTRAINT IF EXISTS trade_statistics_period_stat_type_hs_code_country_code_key;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_statistics_period_hs_code_country_code_key'
      AND conrelid = 'trade_statistics'::regclass
  ) THEN
    ALTER TABLE trade_statistics
      ADD CONSTRAINT trade_statistics_period_hs_code_country_code_key
      UNIQUE (period, hs_code, country_code);
  END IF;
END $$;
