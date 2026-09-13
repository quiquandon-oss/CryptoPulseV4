// engine/fx.js
//
// Pure logic for the FX rate cache — deciding WHEN a cached rate needs
// refreshing. The actual fetch (worker/fx.js) is I/O and lives in the
// worker layer; this file has none, so it's directly testable.

// ~12h -> a rate fetched now and a rate fetched 12h later gives roughly
// 2 refreshes per calendar day without needing a second, separate cron
// schedule — the existing hourly ingest cron just checks this each time
// it runs and only actually fetches when the cache has gone stale.
export const FX_CACHE_MAX_AGE_MS = 12 * 3_600_000;

/**
 * @param fetchedAt  ms epoch the cached rate was last fetched, or null/undefined if never cached
 * @param now        ms epoch "now"
 * @param maxAgeMs   staleness threshold
 */
export function isFxRateStale(fetchedAt, now = Date.now(), maxAgeMs = FX_CACHE_MAX_AGE_MS) {
  if (fetchedAt == null) return true;
  return (now - fetchedAt) > maxAgeMs;
}
