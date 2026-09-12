// engine/freshness.js
//
// Classifies how old a piece of data is. Never presented as live when it isn't
// — see spec section 12.
//
// Thresholds are calibrated to the actual update cadence, not a generic
// near-realtime assumption. market_data_* freshness is driven by the
// timestamp of the last completed 1h candle (see worker/ingest.js) — by
// construction that age cycles from ~0 to ~60 minutes every single hour,
// completely independent of how often ingest polls (a candle for hour X only
// becomes "the latest" once hour X ends, no matter how many times it's
// checked in between). A cutoff below ~65-70 minutes would report this
// perfectly healthy, by-design cycle as degraded almost all the time.

export const FRESHNESS = Object.freeze({ LIVE: 'LIVE', RECENT: 'RECENT', STALE: 'STALE', UNAVAILABLE: 'UNAVAILABLE' });

export const LIVE_MAX_AGE_MS = 15 * 60_000;     // < 15 min — just refreshed
export const RECENT_MAX_AGE_MS = 70 * 60_000;   // < 70 min — the normal full hourly cycle, plus scheduling slack
export const STALE_MAX_AGE_MS = 180 * 60_000;   // < 3 h — one missed cycle; beyond this, UNAVAILABLE

/** @param lastSuccessTs unix ms of the last successful update, or null if there has never been one */
export function classifyFreshness(lastSuccessTs, now) {
  if (lastSuccessTs == null) {
    return { state: FRESHNESS.UNAVAILABLE, ageMs: null };
  }
  const ageMs = now - lastSuccessTs;
  if (ageMs < 0) return { state: FRESHNESS.UNAVAILABLE, ageMs }; // clock skew / bad data, don't pretend it's live
  if (ageMs <= LIVE_MAX_AGE_MS) return { state: FRESHNESS.LIVE, ageMs };
  if (ageMs <= RECENT_MAX_AGE_MS) return { state: FRESHNESS.RECENT, ageMs };
  if (ageMs <= STALE_MAX_AGE_MS) return { state: FRESHNESS.STALE, ageMs };
  return { state: FRESHNESS.UNAVAILABLE, ageMs };
}
