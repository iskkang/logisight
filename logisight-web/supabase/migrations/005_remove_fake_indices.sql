-- Migration 005: Remove seed/fake freight_indices rows
--
-- Seed.sql inserted placeholder rows with generic source names.
-- Real collectors write suffixed sources ('Drewry WCI', 'Freightos FBX',
-- 'KOBC (via dashboard)', 'stooq.com') so they are NOT affected.
--
-- BAI was seeded into freight_indices but air_indices.ts never persists to DB.
-- VLSFO was seeded here but the real data belongs in bunker_prices.

DELETE FROM freight_indices
WHERE source IN (
  'Drewry',                     -- seed placeholder  (real collector: 'Drewry WCI')
  'Freightos',                  -- seed placeholder  (real collector: 'Freightos FBX')
  'Shanghai Shipping Exchange', -- seed placeholder  (real collector: '... (via dashboard)')
  'KOBC',                       -- seed placeholder  (real collector: 'KOBC (via dashboard)')
  'Baltic Exchange Air',        -- air_indices never persists to freight_indices
  'Ship & Bunker'               -- VLSFO belongs in bunker_prices, not freight_indices
);
