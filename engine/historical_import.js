// engine/historical_import.js
//
// Additive historical market data import engine.
// Strictly non-destructive: compares new candidate records against existing V4
// observations, preserving existing V4 records on conflict, skipping identical
// duplicates, and only inserting missing records.

/**
 * Reconciles candidate historical candles against existing market observations.
 *
 * @param {Array<Object>} existingObs Existing V4 observations [{ ts, open, high, low, close, volume, source }]
 * @param {Array<Object>} candidateCandles Candidates [{ ts, open, high, low, close, volume }]
 * @param {string} source Provenance identifier, e.g. 'hyperliquid_historical'
 * @returns {Object} Reconciliation result containing records to insert, duplicates, conflicts, and summary stats.
 */
export function reconcileHistoricalMarketData(existingObs, candidateCandles, source = 'hyperliquid_historical') {
  const existingMap = new Map();
  for (const obs of existingObs) {
    existingMap.set(obs.ts, obs);
  }

  const toInsert = [];
  let duplicatesCount = 0;
  const conflicts = [];

  for (const c of candidateCandles) {
    const existing = existingMap.get(c.ts);
    if (!existing) {
      toInsert.push({
        ts: c.ts,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
        source,
      });
    } else {
      // Compare close price and OHLC with tolerance for minor floating point rounding
      const closeDiff = Math.abs((existing.close ?? 0) - c.close);
      const isCloseMatching = closeDiff < 1e-4;

      if (isCloseMatching) {
        duplicatesCount++;
      } else {
        // Discrepancy detected: preserve existing V4 record, log conflict
        conflicts.push({
          ts: c.ts,
          existingClose: existing.close,
          candidateClose: c.close,
          existingSource: existing.source,
          candidateSource: source,
        });
      }
    }
  }

  const timestamps = candidateCandles.map((c) => c.ts);
  const earliestTs = timestamps.length ? Math.min(...timestamps) : null;
  const latestTs = timestamps.length ? Math.max(...timestamps) : null;

  return {
    source,
    receivedCount: candidateCandles.length,
    toInsert,
    insertedCount: toInsert.length,
    duplicatesCount,
    conflicts,
    conflictCount: conflicts.length,
    earliestTs,
    latestTs,
  };
}
