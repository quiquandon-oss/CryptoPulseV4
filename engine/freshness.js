// engine/freshness.js
//
// Classifies how old a piece of data is. Never presented as live when it isn't
// — see spec section 12.

export const FRESHNESS = Object.freeze({ LIVE: 'LIVE', RECENT: 'RECENT', STALE: 'STALE', UNAVAILABLE: 'UNAVAILABLE' });

export const LIVE_MAX_AGE_MS = 5 * 60_000;      // < 5 min
export const RECENT_MAX_AGE_MS = 30 * 60_000;   // < 30 min
export const STALE_MAX_AGE_MS = 180 * 60_000;   // < 3 h — beyond this, UNAVAILABLE

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
