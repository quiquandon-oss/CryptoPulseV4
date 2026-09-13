// worker/fx.js
//
// Wraps data-source.js's fetchEurUsdRate() with a D1-backed cache so the
// rate refreshes on a controlled ~2x/day cadence (engine/fx.js) instead of
// hitting Frankfurter on every single portfolio API call and every Revolut
// import — both of which previously called fetchEurUsdRate() directly,
// live, every time.
import { fetchEurUsdRate } from './data-source.js';
import { isFxRateStale } from '../engine/fx.js';

const PAIR = 'EURUSD';

/**
 * Returns the cached EUR->USD rate, refreshing it first if stale or never
 * cached. fetchEurUsdRate() itself never throws (falls back to V1's
 * hardcoded 1.1385 on failure), so this always resolves to a usable rate —
 * worst case, a stale cached number or the hardcoded fallback, never null.
 */
export async function getOrRefreshEurUsdRate(env, now = Date.now()) {
  const cached = await env.DB.prepare('SELECT rate, fetched_at FROM fx_rate_cache WHERE pair = ?').bind(PAIR).first();

  if (cached && !isFxRateStale(cached.fetched_at, now)) {
    return { rate: cached.rate, fetchedAt: cached.fetched_at, fromCache: true };
  }

  const rate = await fetchEurUsdRate();
  await env.DB.prepare(
    `INSERT INTO fx_rate_cache (pair, rate, fetched_at, source) VALUES (?, ?, ?, 'frankfurter')
     ON CONFLICT(pair) DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`,
  ).bind(PAIR, rate, now).run();

  return { rate, fetchedAt: now, fromCache: false };
}
