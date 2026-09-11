-- CryptoPulse V4 — initial schema
-- Isolated database: cryptopulse-v4. No foreign keys into V1/V2's sentiment-history DB.
-- See docs/DATA_CONTRACT.md for field-level documentation.

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,               -- 'BTC', 'ETH', 'LINK'
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  source_id TEXT NOT NULL,           -- identifier on the market data source (Hyperliquid coin symbol)
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_observations (
  id TEXT PRIMARY KEY,               -- '{asset_id}_{ts}'
  asset_id TEXT NOT NULL REFERENCES assets(id),
  ts INTEGER NOT NULL,               -- unix ms, candle close time
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obs_asset_ts ON market_observations(asset_id, ts);

CREATE TABLE IF NOT EXISTS technical_indicators (
  id TEXT PRIMARY KEY,               -- '{asset_id}_{ts}'
  asset_id TEXT NOT NULL REFERENCES assets(id),
  ts INTEGER NOT NULL,
  price REAL NOT NULL,
  sma20 REAL, sma50 REAL,
  ema12 REAL, ema26 REAL,
  rsi14 REAL,
  macd REAL, macd_signal REAL,
  bollinger_upper REAL, bollinger_lower REAL,
  atr14 REAL,
  ichimoku_tenkan REAL, ichimoku_kijun REAL, ichimoku_span_a REAL, ichimoku_span_b REAL,
  momentum10 REAL,
  volatility20 REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ti_asset_ts ON technical_indicators(asset_id, ts);

CREATE TABLE IF NOT EXISTS market_regimes (
  id TEXT PRIMARY KEY,               -- '{asset_id}_{ts}'
  asset_id TEXT NOT NULL REFERENCES assets(id),
  ts INTEGER NOT NULL,
  regime TEXT NOT NULL,
  basis TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_regime_asset_ts ON market_regimes(asset_id, ts);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,               -- '{asset_id}_{ts}'
  asset_id TEXT NOT NULL REFERENCES assets(id),
  ts INTEGER NOT NULL,
  direction TEXT NOT NULL,           -- BULLISH / BEARISH / NEUTRAL
  score INTEGER NOT NULL,
  evidence_bullish INTEGER NOT NULL,
  evidence_bearish INTEGER NOT NULL,
  evidence_applicable INTEGER NOT NULL,
  agreement_ratio REAL,
  evidence_label TEXT NOT NULL,
  regime TEXT NOT NULL,
  risk TEXT NOT NULL,                -- LOW / MEDIUM / HIGH
  persistence_count INTEGER NOT NULL DEFAULT 1,
  stability TEXT NOT NULL DEFAULT 'STABLE',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signals_asset_ts ON signals(asset_id, ts);

CREATE TABLE IF NOT EXISTS signal_indicators (
  signal_id TEXT NOT NULL REFERENCES signals(id),
  indicator TEXT NOT NULL,
  value REAL,
  state TEXT,
  direction TEXT,
  applicable INTEGER NOT NULL,
  interpretation TEXT,
  PRIMARY KEY (signal_id, indicator)
);

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id TEXT PRIMARY KEY,               -- '{signal_id}_{horizon}'
  signal_id TEXT NOT NULL REFERENCES signals(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  horizon TEXT NOT NULL,             -- '12h' / '24h'
  target_ts INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'GENERATED',   -- GENERATED / UNRESOLVED / RESOLVED / INSUFFICIENT_DATA
  future_price REAL,
  actual_return REAL,
  success INTEGER,                   -- 1 / 0 / NULL
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outcomes_status ON signal_outcomes(status);
CREATE INDEX IF NOT EXISTS idx_outcomes_asset_horizon_ts ON signal_outcomes(asset_id, horizon, target_ts);

CREATE TABLE IF NOT EXISTS performance_metrics (
  id TEXT PRIMARY KEY,               -- '{asset_id}_{horizon}_{regime}' or 'ALL_ALL_ALL' for global
  asset_id TEXT,
  horizon TEXT,
  regime TEXT,
  samples INTEGER NOT NULL,
  status TEXT NOT NULL,              -- OK / INSUFFICIENT_DATA
  win_rate REAL,
  avg_return REAL,
  median_return REAL,
  best_return REAL,
  worst_return REAL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_health (
  id TEXT PRIMARY KEY,               -- component name, e.g. 'market_data_BTC', 'database', 'ai_explanation'
  component TEXT NOT NULL,
  status TEXT NOT NULL,              -- LIVE / RECENT / STALE / UNAVAILABLE / OK / ERROR
  detail TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_explanations (
  id TEXT PRIMARY KEY,               -- signal_id
  signal_id TEXT NOT NULL REFERENCES signals(id),
  supports TEXT,                     -- JSON array of strings
  contradicts TEXT,                  -- JSON array of strings
  risks TEXT,                        -- JSON array of strings
  invalidation TEXT,
  model TEXT NOT NULL,
  ai_error TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO assets (id, symbol, name, source_id) VALUES
  ('BTC', 'BTC', 'Bitcoin', 'BTC'),
  ('ETH', 'ETH', 'Ethereum', 'ETH'),
  ('LINK', 'LINK', 'Chainlink', 'LINK');
