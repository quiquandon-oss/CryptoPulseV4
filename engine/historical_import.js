// engine/historical_import.js
//
// Additive historical market data import engine.
// Strictly non-destructive: compares new candidate records against existing V4
// observations across all OHLCV fields, preserving existing V4 records on conflict,
// skipping identical duplicates, and only inserting missing records.

const PRICE_TOLERANCE = 1e-4;
const VOLUME_TOLERANCE = 1e-3;

/**
 * Reconciles candidate historical candles against existing market observations.
 * Compares ALL relevant candle fields: open, high, low, close, volume.
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
      // Full OHLCV comparison
      const openDiff = Math.abs((existing.open ?? 0) - c.open);
      const highDiff = Math.abs((existing.high ?? 0) - c.high);
      const lowDiff = Math.abs((existing.low ?? 0) - c.low);
      const closeDiff = Math.abs((existing.close ?? 0) - c.close);
      const volDiff = Math.abs((existing.volume ?? 0) - (c.volume ?? 0));

      const isFullMatch =
        openDiff < PRICE_TOLERANCE &&
        highDiff < PRICE_TOLERANCE &&
        lowDiff < PRICE_TOLERANCE &&
        closeDiff < PRICE_TOLERANCE &&
        volDiff < VOLUME_TOLERANCE;

      if (isFullMatch) {
        duplicatesCount++;
      } else {
        // Discrepancy detected in one or more OHLCV fields: preserve existing V4 record, log conflict
        conflicts.push({
          ts: c.ts,
          existing: {
            open: existing.open,
            high: existing.high,
            low: existing.low,
            close: existing.close,
            volume: existing.volume,
            source: existing.source,
          },
          candidate: {
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            source,
          },
          fieldDiscrepancies: {
            open: openDiff >= PRICE_TOLERANCE,
            high: highDiff >= PRICE_TOLERANCE,
            low: lowDiff >= PRICE_TOLERANCE,
            close: closeDiff >= PRICE_TOLERANCE,
            volume: volDiff >= VOLUME_TOLERANCE,
          },
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
