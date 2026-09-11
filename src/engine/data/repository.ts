import { getDatabase } from '@/db/client';
import { AssetSymbol, Candle } from '@/types';

interface CandleRow {
  asset: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

export function saveCandles(candles: Candle[]): void {
  if (candles.length === 0) return;

  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO market_candles (id, asset, timestamp, open, high, low, close, volume, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset, timestamp, source) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume
  `);

  const now = Date.now();
  const insertMany = db.transaction((items: Candle[]) => {
    for (const c of items) {
      const id = `${c.asset}_${c.timestamp}_${c.source}`;
      stmt.run(id, c.asset, c.timestamp, c.open, c.high, c.low, c.close, c.volume, c.source, now);
    }
  });

  insertMany(candles);
}

export function getCandles(
  asset: AssetSymbol,
  endTimestampMs: number,
  limit: number = 200
): Candle[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT asset, timestamp, open, high, low, close, volume, source
    FROM market_candles
    WHERE asset = ? AND timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  const rows = stmt.all(asset, endTimestampMs, limit) as CandleRow[];
  return rows
    .map((r) => ({
      asset: r.asset as AssetSymbol,
      timestamp: Number(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      source: r.source,
    }))
    .reverse();
}

export function getLatestCandle(asset: AssetSymbol): Candle | null {
  const candles = getCandles(asset, Date.now(), 1);
  return candles.length > 0 ? candles[0] : null;
}
