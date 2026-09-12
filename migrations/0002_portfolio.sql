-- CryptoPulse V4 — Portfolio layer (migration 0002)
-- Isolated within cryptopulse-v4, same as 0001. No writes to V1/V2's sentiment-history.
-- Scope confirmed explicitly: the 5 assets V1 already tracks (BTC, ETH, SOL, LINK, HYPE) —
-- see engine/portfolio.js TRACKED_ASSETS. Not auto-derived from statement contents.

CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id TEXT PRIMARY KEY,                 -- deterministic sourceId — makes re-uploads idempotent
  asset_id TEXT NOT NULL,
  account TEXT NOT NULL,               -- 'Neverless' | 'Revolut'
  transaction_type TEXT NOT NULL,      -- BUY / SELL / TRANSFER_IN / TRANSFER_OUT
  quantity REAL NOT NULL,
  unit_price_usd REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  transaction_timestamp INTEGER NOT NULL,
  source TEXT NOT NULL,                -- CSV_NEVERLESS / XLSX_REVOLUT / MANUAL
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ptx_asset_ts ON portfolio_transactions(asset_id, transaction_timestamp);
CREATE INDEX IF NOT EXISTS idx_ptx_ts ON portfolio_transactions(transaction_timestamp);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,                 -- '{ts}'
  ts INTEGER NOT NULL,
  total_value_usd REAL,                -- null when a held asset's current price is unavailable — never guessed
  invested_capital_usd REAL NOT NULL,
  unrealized_pnl_usd REAL,
  unrealized_pnl_pct REAL,
  prices_complete INTEGER NOT NULL,    -- 0/1 — whether every held asset had a current price at computation time
  source TEXT NOT NULL DEFAULT 'V4_COMPUTED',
  data_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_psnap_ts ON portfolio_snapshots(ts);

CREATE TABLE IF NOT EXISTS portfolio_asset_snapshots (
  id TEXT PRIMARY KEY,                 -- '{asset_id}_{ts}'
  ts INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  price_usd REAL,
  value_usd REAL,
  invested_value_usd REAL NOT NULL,
  unrealized_pnl_usd REAL,
  allocation_pct REAL,
  source TEXT NOT NULL DEFAULT 'V4_COMPUTED',
  data_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pasnap_asset_ts ON portfolio_asset_snapshots(asset_id, ts);
CREATE INDEX IF NOT EXISTS idx_pasnap_ts ON portfolio_asset_snapshots(ts);
