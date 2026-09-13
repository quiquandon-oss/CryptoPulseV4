-- 0006_fx_rate_cache.sql
-- Caches live-fetched FX rates so they refresh on a controlled cadence
-- (~2x/day, see engine/fx.js FX_CACHE_MAX_AGE_MS) instead of hitting
-- Frankfurter on every single portfolio API call and every Revolut import.
CREATE TABLE IF NOT EXISTS fx_rate_cache (
  pair TEXT PRIMARY KEY,
  rate REAL NOT NULL,
  fetched_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'frankfurter'
);
