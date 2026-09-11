// engine/outcomes.js
//
// Resolves a signal's real-world outcome at a future horizon (12h/24h).
// Zero look-ahead: only observations at or after target_ts are used to resolve it,
// and only observations at or before the signal's own ts feed the signal itself.
// Never fabricates a resolution — see spec section 10/29 (DATA_INTEGRITY_RULE).

export const OUTCOME_STATUS = Object.freeze({
  GENERATED: 'GENERATED',
  UNRESOLVED: 'UNRESOLVED',
  RESOLVED: 'RESOLVED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
});

export const HORIZON_MS = Object.freeze({ '12h': 12 * 3_600_000, '24h': 24 * 3_600_000 });

// How far past target_ts we tolerate matching an observation to (data isn't always exactly on-grid).
export const MATCH_TOLERANCE_MS = 90 * 60_000; // 90 minutes
// How long we keep waiting for a matching observation before giving up.
export const GRACE_PERIOD_MS = 6 * 3_600_000; // 6 hours

/**
 * @param outcome   { targetTs, entryPrice, direction } — direction is the signal's BULLISH/BEARISH/NEUTRAL call
 * @param observations  array of { ts, close } for the asset, any order
 * @param now       current unix ms (injected for testability)
 */
export function resolveOutcome(outcome, observations, now) {
  const { targetTs, entryPrice, direction } = outcome;

  if (now < targetTs) {
    return { status: OUTCOME_STATUS.GENERATED, futurePrice: null, actualReturn: null, success: null };
  }

  const candidates = observations
    .filter((o) => Math.abs(o.ts - targetTs) <= MATCH_TOLERANCE_MS)
    .sort((a, b) => Math.abs(a.ts - targetTs) - Math.abs(b.ts - targetTs));

  if (candidates.length === 0) {
    if (now - targetTs > GRACE_PERIOD_MS) {
      return { status: OUTCOME_STATUS.INSUFFICIENT_DATA, futurePrice: null, actualReturn: null, success: null };
    }
    return { status: OUTCOME_STATUS.UNRESOLVED, futurePrice: null, actualReturn: null, success: null };
  }

  const futurePrice = candidates[0].close;
  const actualReturn = (futurePrice - entryPrice) / entryPrice;
  const success = direction === 'BULLISH' ? actualReturn > 0
    : direction === 'BEARISH' ? actualReturn < 0
    : null; // NEUTRAL calls are never scored right/wrong

  return { status: OUTCOME_STATUS.RESOLVED, futurePrice, actualReturn, success };
}

/** Builds the outcome rows to create when a signal is generated — one per supported horizon. */
export function buildPendingOutcomes({ signalId, assetId, signalTs, entryPrice, direction, horizons = ['12h', '24h'] }) {
  return horizons.map((horizon) => ({
    id: `${signalId}_${horizon}`,
    signalId,
    assetId,
    horizon,
    targetTs: signalTs + HORIZON_MS[horizon],
    entryPrice,
    direction,
    status: OUTCOME_STATUS.GENERATED,
  }));
}
