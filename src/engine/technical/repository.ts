import { getDatabase } from '@/db/client';
import { AssetSymbol, MarketSignal, SignalMode } from '@/types';

interface SignalRow {
  id: string;
  asset: string;
  timestamp: number;
  mode: string;
  direction: string;
  score: number;
  regime: string;
  price: number;
  evidence_json: string;
  indicators_json: string;
  persistence_json: string;
  source: string;
}

export function saveSignal(signal: MarketSignal): string {
  const db = getDatabase();
  const id = `${signal.asset}_${signal.timestamp}_${signal.mode}`;
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO signals (
      id, asset, timestamp, mode, direction, score, regime, price,
      evidence_json, indicators_json, persistence_json, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset, timestamp, mode) DO UPDATE SET
      direction = excluded.direction,
      score = excluded.score,
      regime = excluded.regime,
      price = excluded.price,
      evidence_json = excluded.evidence_json,
      indicators_json = excluded.indicators_json,
      persistence_json = excluded.persistence_json
  `);

  stmt.run(
    id,
    signal.asset,
    signal.timestamp,
    signal.mode,
    signal.direction,
    signal.score,
    signal.regime,
    signal.price,
    JSON.stringify(signal.evidence),
    JSON.stringify(signal.indicators),
    JSON.stringify(signal.persistence),
    signal.source,
    now
  );

  return id;
}

export function getLatestSignal(
  asset: AssetSymbol,
  mode: SignalMode = 'LIVE'
): MarketSignal | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM signals
    WHERE asset = ? AND mode = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `);

  const row = stmt.get(asset, mode) as SignalRow | undefined;
  if (!row) return null;

  return mapRowToSignal(row);
}

export function getRecentSignals(
  asset: AssetSymbol,
  limit: number = 50,
  mode: SignalMode = 'LIVE'
): MarketSignal[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM signals
    WHERE asset = ? AND mode = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  const rows = stmt.all(asset, mode, limit) as SignalRow[];
  return rows.map(mapRowToSignal).reverse();
}

function mapRowToSignal(row: SignalRow): MarketSignal {
  return {
    id: row.id,
    asset: row.asset as AssetSymbol,
    timestamp: Number(row.timestamp),
    mode: row.mode as SignalMode,
    direction: row.direction as MarketSignal['direction'],
    score: Number(row.score),
    regime: row.regime as MarketSignal['regime'],
    price: Number(row.price),
    evidence: JSON.parse(row.evidence_json),
    indicators: JSON.parse(row.indicators_json),
    persistence: JSON.parse(row.persistence_json),
    source: row.source,
  };
}
