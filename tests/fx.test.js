// tests/fx.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isFxRateStale, FX_CACHE_MAX_AGE_MS } from '../engine/fx.js';

test('isFxRateStale: never-cached (null/undefined fetchedAt) is always stale', () => {
  assert.equal(isFxRateStale(null, Date.now()), true);
  assert.equal(isFxRateStale(undefined, Date.now()), true);
});

test('isFxRateStale: a rate fetched just now is not stale', () => {
  const now = Date.now();
  assert.equal(isFxRateStale(now, now), false);
});

test('isFxRateStale: a rate fetched 1 hour ago is not stale (well under the 12h threshold)', () => {
  const now = Date.now();
  assert.equal(isFxRateStale(now - 3_600_000, now), false);
});

test('isFxRateStale: a rate fetched exactly 12h ago is not yet stale (boundary is exclusive)', () => {
  const now = Date.now();
  assert.equal(isFxRateStale(now - FX_CACHE_MAX_AGE_MS, now), false);
});

test('isFxRateStale: a rate fetched 12h + 1ms ago is stale', () => {
  const now = Date.now();
  assert.equal(isFxRateStale(now - FX_CACHE_MAX_AGE_MS - 1, now), true);
});

test('isFxRateStale: a rate fetched 20 hours ago is stale', () => {
  const now = Date.now();
  assert.equal(isFxRateStale(now - 20 * 3_600_000, now), true);
});

test('isFxRateStale: a custom maxAgeMs threshold is respected', () => {
  const now = Date.now();
  assert.equal(isFxRateStale(now - 3_600_000, now, 1_800_000), true); // 1h old, 30min threshold -> stale
  assert.equal(isFxRateStale(now - 3_600_000, now, 7_200_000), false); // 1h old, 2h threshold -> not stale
});

test('FX_CACHE_MAX_AGE_MS is 12 hours, matching a ~2x/day refresh cadence', () => {
  assert.equal(FX_CACHE_MAX_AGE_MS, 12 * 3_600_000);
});
