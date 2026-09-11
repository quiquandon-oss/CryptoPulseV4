import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'v4.db');

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  initTables(dbInstance);

  return dbInstance;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_candles (
      id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(asset, timestamp, source)
    );

    CREATE INDEX IF NOT EXISTS idx_candles_asset_ts ON market_candles(asset, timestamp);

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      mode TEXT NOT NULL,
      direction TEXT NOT NULL,
      score INTEGER NOT NULL,
      regime TEXT NOT NULL,
      price REAL NOT NULL,
      evidence_json TEXT NOT NULL,
      indicators_json TEXT NOT NULL,
      persistence_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(asset, timestamp, mode)
    );

    CREATE INDEX IF NOT EXISTS idx_signals_asset_ts ON signals(asset, timestamp);
    CREATE INDEX IF NOT EXISTS idx_signals_mode ON signals(mode);

    CREATE TABLE IF NOT EXISTS signal_outcomes (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      signal_timestamp INTEGER NOT NULL,
      horizon TEXT NOT NULL,
      initial_price REAL NOT NULL,
      signal_direction TEXT NOT NULL,
      signal_score INTEGER NOT NULL,
      mode TEXT NOT NULL,
      target_timestamp INTEGER NOT NULL,
      resolution_timestamp INTEGER,
      actual_price REAL,
      actual_return_percent REAL,
      status TEXT NOT NULL,
      is_success INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(signal_id) REFERENCES signals(id) ON DELETE CASCADE,
      UNIQUE(signal_id, horizon)
    );

    CREATE INDEX IF NOT EXISTS idx_outcomes_asset_horizon ON signal_outcomes(asset, horizon);
    CREATE INDEX IF NOT EXISTS idx_outcomes_status ON signal_outcomes(status);

    CREATE TABLE IF NOT EXISTS system_health_logs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      component TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_health_ts ON system_health_logs(timestamp);
  `);
}
