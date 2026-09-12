// engine/health.js
//
// Aggregates individual component states (per-asset freshness, DB, AI layer, etc.)
// into the top-level "Market status: LIVE / DEGRADED / OFFLINE" shown in the header.
// No generic boolean "healthy" flag without supporting evidence — spec section 13.

/**
 * @param components array of { component, status } where status is one of:
 *   LIVE, RECENT, STALE, UNAVAILABLE, OK, ERROR
 *
 * RECENT deliberately does NOT count as degraded: for anything on an hourly
 * (or slower) cadence, "not literally live, but within the normal cycle" is
 * the expected, healthy state most of the time — see engine/freshness.js.
 * Only STALE (a missed cycle) and outright failures count as degraded.
 */
export function aggregateHealth(components) {
  const bad = components.filter((c) => c.status === 'UNAVAILABLE' || c.status === 'ERROR');
  const degraded = components.filter((c) => c.status === 'STALE');

  let overall;
  if (components.length === 0) overall = 'OFFLINE';
  else if (bad.length > 0) overall = bad.length === components.length ? 'OFFLINE' : 'DEGRADED';
  else if (degraded.length > 0) overall = 'DEGRADED';
  else overall = 'LIVE';

  return {
    overall,
    components,
    issues: [...bad, ...degraded].map((c) => `${c.component}: ${c.status}`),
  };
}
