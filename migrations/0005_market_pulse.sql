-- Market Pulse (migration 0005). Additive only.
--
-- imported_v1_history: V1's `history` table (Sentiment composite + Cycle
-- conviction), synced in periodically by the ingest cron via V1's own
-- /history endpoint — never queried live from the UI or at request time
-- (see spec: "V4 must NOT depend on V1 at runtime"). V1's own copy is
-- hard-pruned to its most recent 500 rows; this table is V4's independent,
-- append-only copy that does NOT get pruned, so V4 retains history V1 itself
-- will eventually discard.
CREATE TABLE IF NOT EXISTS imported_v1_history (
  id TEXT PRIMARY KEY,                 -- '{ts}'
  ts INTEGER NOT NULL,
  score REAL NOT NULL,                 -- V1 Sentiment composite, 0-100 — disclosed non-deterministic, see engine/market_pulse.js
  regime_mag REAL,                     -- V1 Cycle/Regime Scorecard conviction, -1..1 — includes Gemini AI narrative factors
  btc_price REAL,
  source TEXT NOT NULL DEFAULT 'V1_HISTORY_IMPORT',
  import_timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v1hist_ts ON imported_v1_history(ts);

-- market_pulse_snapshots: the computed composite itself, one row per
-- computation. Stores every component separately (never just the final
-- number) so a later audit can see exactly which half(ves) contributed and
-- whether the reading was partial.
CREATE TABLE IF NOT EXISTS market_pulse_snapshots (
  id TEXT PRIMARY KEY,                 -- '{ts}'
  ts INTEGER NOT NULL,
  market_pulse INTEGER,                -- 0-100, NULL when both halves were unavailable — never fabricated
  label TEXT,                          -- BULLISH / NEUTRAL / BEARISH, NULL when market_pulse is NULL
  partial INTEGER NOT NULL DEFAULT 0,  -- 1 if only one half contributed
  partial_reason TEXT,
  deterministic_half REAL,
  disclosed_half REAL,
  v4_regime_norm REAL,
  v4_cycle_position_norm REAL,
  sentiment_norm REAL,
  cycle_conviction_norm REAL,
  disclosure TEXT,                     -- non-null whenever disclosed_half contributed; the exact caveat text shown alongside the gauge
  data_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mpsnap_ts ON market_pulse_snapshots(ts);
