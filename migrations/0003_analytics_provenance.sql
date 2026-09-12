-- CryptoPulse V4 — Additive Analytics & Provenance Schema (migration 0003)
-- Isolated within cryptopulse-v4. Purely additive; no DROP/TRUNCATE/DELETE statements.

CREATE TABLE IF NOT EXISTS historical_import_logs (
  id TEXT PRIMARY KEY,                   -- '{asset_id}_{import_version}_{created_ts}'
  asset_id TEXT NOT NULL,
  source TEXT NOT NULL,                  -- 'hyperliquid_historical' / 'v1_export'
  import_version TEXT NOT NULL,          -- 'v1'
  earliest_ts INTEGER,
  latest_ts INTEGER,
  received_count INTEGER NOT NULL,
  inserted_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  conflict_count INTEGER NOT NULL,
  conflicts_json TEXT,                   -- JSON string detailing any price discrepancies where V4 data was preserved
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hil_asset_ts ON historical_import_logs(asset_id, created_at);

CREATE INDEX IF NOT EXISTS idx_obs_ts ON market_observations(ts);
CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts);
