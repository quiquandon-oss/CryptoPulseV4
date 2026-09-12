// worker/market_pulse.js
import {
  computeAggregatedRegime, computeCyclePosition, computeMarketPulse, reconcileV1HistoryImport,
} from '../engine/market_pulse.js';
import { fetchCandles } from './data-source.js';

/**
 * Periodic import of V1's `history` rows into V4's own D1 (migration 0005).
 * Reads V1_DB directly (see wrangler.toml) — a D1 binding, not an HTTP call
 * to V1's Worker, so this keeps working even if V1's Worker were deleted,
 * as long as the underlying database still exists. Called only from the
 * ingest cron path, never from a user-facing request handler.
 */
export async function importV1History(env) {
  if (!env.V1_DB) {
    return { imported: 0, error: 'V1_DB binding not configured' };
  }

  const existingRows = await env.DB.prepare('SELECT ts FROM imported_v1_history ORDER BY ts DESC LIMIT 2000').all();
  const existing = (existingRows.results || []).map((r) => ({ ts: r.ts }));

  // Only pull rows newer than what we already have, bounded to V1's own
  // 500-row cap anyway — no point asking for more than V1 could return.
  const latestKnownTs = existing.length ? Math.max(...existing.map((r) => r.ts)) : 0;
  const candidateRows = await env.V1_DB.prepare(
    'SELECT ts, score, regime_mag, btc_price FROM history WHERE ts > ? ORDER BY ts ASC LIMIT 500',
  ).bind(latestKnownTs).all();

  const candidates = (candidateRows.results || []).map((r) => ({
    ts: r.ts, score: r.score, regimeMag: r.regime_mag, btcPrice: r.btc_price,
  }));

  const { toInsert, duplicates, receivedCount } = reconcileV1HistoryImport(existing, candidates);

  if (toInsert.length) {
    const stmt = env.DB.prepare(
      'INSERT OR IGNORE INTO imported_v1_history (id, ts, score, regime_mag, btc_price, source, import_timestamp) VALUES (?,?,?,?,?,?,?)',
    );
    const now = Date.now();
    await env.DB.batch(toInsert.map((r) => stmt.bind(String(r.ts), r.ts, r.score, r.regimeMag, r.btcPrice, r.source, now)));
  }

  return { imported: toInsert.length, duplicates, receivedCount };
}

/**
 * Computes the current Market Pulse from whatever's actually available right
 * now — V4's latest per-asset regime classifications, a live BTC price for
 * cycle position, and the most recently imported V1 row for the disclosed
 * half. Stores the full breakdown (migration 0005), never just the headline
 * number, and never fabricates a value for a missing input.
 */
export async function computeAndStoreMarketPulse(env, now = Date.now()) {
  const regimeRows = await env.DB.prepare(
    `SELECT r.asset_id, r.regime FROM market_regimes r
     INNER JOIN (SELECT asset_id, MAX(ts) as maxTs FROM market_regimes GROUP BY asset_id) latest
     ON r.asset_id = latest.asset_id AND r.ts = latest.maxTs`,
  ).all();
  const aggregatedRegime = computeAggregatedRegime((regimeRows.results || []).map((r) => ({ asset: r.asset_id, regime: r.regime })));

  let cyclePosition = null;
  try {
    const btcCandles = await fetchCandles('BTC', '1h', 3 * 3_600_000);
    const btcPrice = btcCandles.length ? btcCandles[btcCandles.length - 1].close : null;
    cyclePosition = computeCyclePosition(btcPrice);
  } catch {
    cyclePosition = null;
  }

  const latestV1 = await env.DB.prepare('SELECT score, regime_mag, ts FROM imported_v1_history ORDER BY ts DESC LIMIT 1').first();

  const result = computeMarketPulse({
    v4RegimeNorm: aggregatedRegime?.norm ?? null,
    v4CyclePositionNorm: cyclePosition?.norm ?? null,
    sentimentScore0to100: latestV1?.score ?? null,
    cycleConvictionNeg1to1: latestV1?.regime_mag ?? null,
  });

  await env.DB.prepare(
    `INSERT OR REPLACE INTO market_pulse_snapshots
     (id, ts, market_pulse, label, partial, partial_reason, deterministic_half, disclosed_half,
      v4_regime_norm, v4_cycle_position_norm, sentiment_norm, cycle_conviction_norm, disclosure)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    String(now), now, result.marketPulse, result.label, result.partial ? 1 : 0, result.partialReason ?? result.reason ?? null,
    result.deterministicHalf ?? null, result.disclosedHalf ?? null,
    result.components?.v4RegimeNorm ?? null, result.components?.v4CyclePositionNorm ?? null,
    result.components?.sentimentNorm ?? null, result.components?.cycleConvictionNeg1to1 ?? null,
    result.disclosure ?? null,
  ).run();

  return { ...result, v1DataAgeMs: latestV1 ? now - latestV1.ts : null };
}

export async function getMarketPulseHistory(db, sinceTs) {
  const { results } = await db.prepare(
    'SELECT * FROM market_pulse_snapshots WHERE ts >= ? ORDER BY ts ASC',
  ).bind(sinceTs).all();
  return results || [];
}
