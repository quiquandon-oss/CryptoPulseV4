import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness, FRESHNESS } from '../engine/freshness.js';
import { aggregateHealth } from '../engine/health.js';

const NOW = 1_700_000_000_000;

test('classifyFreshness: LIVE just under 15 minutes old', () => {
  assert.equal(classifyFreshness(NOW - 14 * 60_000, NOW).state, FRESHNESS.LIVE);
});

test('classifyFreshness: RECENT covers the normal hourly-candle cycle, up to 70 minutes', () => {
  assert.equal(classifyFreshness(NOW - 20 * 60_000, NOW).state, FRESHNESS.RECENT);
  assert.equal(classifyFreshness(NOW - 65 * 60_000, NOW).state, FRESHNESS.RECENT, 'a candle 65m old is still within one normal hourly cycle, not stale');
});

test('classifyFreshness: STALE between 70 minutes (one missed cycle) and 3 hours old', () => {
  assert.equal(classifyFreshness(NOW - 90 * 60_000, NOW).state, FRESHNESS.STALE);
});

test('classifyFreshness: UNAVAILABLE beyond 3 hours, or with no data at all', () => {
  assert.equal(classifyFreshness(NOW - 4 * 3_600_000, NOW).state, FRESHNESS.UNAVAILABLE);
  assert.equal(classifyFreshness(null, NOW).state, FRESHNESS.UNAVAILABLE);
});

test('classifyFreshness: never reports LIVE for a timestamp in the future (clock skew guard)', () => {
  assert.equal(classifyFreshness(NOW + 60_000, NOW).state, FRESHNESS.UNAVAILABLE);
});

test('aggregateHealth: all LIVE components roll up to overall LIVE', () => {
  const result = aggregateHealth([{ component: 'BTC', status: 'LIVE' }, { component: 'DB', status: 'OK' }]);
  assert.equal(result.overall, 'LIVE');
  assert.deepEqual(result.issues, []);
});

test('aggregateHealth: RECENT is normal for an hourly cadence, not degraded — a healthy system reads this way most of every hour', () => {
  const result = aggregateHealth([{ component: 'BTC', status: 'RECENT' }, { component: 'DB', status: 'OK' }]);
  assert.equal(result.overall, 'LIVE');
  assert.deepEqual(result.issues, []);
});

test('aggregateHealth: one STALE component degrades the overall status without hiding it', () => {
  const result = aggregateHealth([{ component: 'BTC', status: 'LIVE' }, { component: 'LINK', status: 'STALE' }]);
  assert.equal(result.overall, 'DEGRADED');
  assert.deepEqual(result.issues, ['LINK: STALE']);
});

test('aggregateHealth: all components UNAVAILABLE means fully OFFLINE, not a generic healthy flag', () => {
  const result = aggregateHealth([{ component: 'BTC', status: 'UNAVAILABLE' }, { component: 'ETH', status: 'ERROR' }]);
  assert.equal(result.overall, 'OFFLINE');
});

test('aggregateHealth: no components at all is OFFLINE, never fabricated as healthy', () => {
  assert.equal(aggregateHealth([]).overall, 'OFFLINE');
});
