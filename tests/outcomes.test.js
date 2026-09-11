import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOutcome, buildPendingOutcomes, OUTCOME_STATUS, HORIZON_MS } from '../engine/outcomes.js';

const T0 = 1_700_000_000_000;

test('resolveOutcome: GENERATED before the target time is reached', () => {
  const outcome = { targetTs: T0 + HORIZON_MS['12h'], entryPrice: 100, direction: 'BULLISH' };
  const result = resolveOutcome(outcome, [], T0);
  assert.equal(result.status, OUTCOME_STATUS.GENERATED);
});

test('resolveOutcome: RESOLVED with correct return and success when a matching observation exists', () => {
  const targetTs = T0 + HORIZON_MS['12h'];
  const outcome = { targetTs, entryPrice: 100, direction: 'BULLISH' };
  const observations = [{ ts: targetTs, close: 110 }];
  const result = resolveOutcome(outcome, observations, targetTs);
  assert.equal(result.status, OUTCOME_STATUS.RESOLVED);
  assert.equal(result.futurePrice, 110);
  assert.ok(Math.abs(result.actualReturn - 0.10) < 1e-9);
  assert.equal(result.success, true);
});

test('resolveOutcome: a BEARISH call succeeds when price actually fell', () => {
  const targetTs = T0 + HORIZON_MS['24h'];
  const outcome = { targetTs, entryPrice: 100, direction: 'BEARISH' };
  const observations = [{ ts: targetTs, close: 92 }];
  const result = resolveOutcome(outcome, observations, targetTs);
  assert.equal(result.success, true);
});

test('resolveOutcome: a BEARISH call fails when price rose instead', () => {
  const targetTs = T0 + HORIZON_MS['24h'];
  const outcome = { targetTs, entryPrice: 100, direction: 'BEARISH' };
  const observations = [{ ts: targetTs, close: 105 }];
  const result = resolveOutcome(outcome, observations, targetTs);
  assert.equal(result.success, false);
});

test('resolveOutcome: UNRESOLVED when target has passed but no matching data yet, within the grace period', () => {
  const targetTs = T0 + HORIZON_MS['12h'];
  const outcome = { targetTs, entryPrice: 100, direction: 'BULLISH' };
  const result = resolveOutcome(outcome, [], targetTs + 60 * 60_000); // 1h after target
  assert.equal(result.status, OUTCOME_STATUS.UNRESOLVED);
});

test('resolveOutcome: INSUFFICIENT_DATA once the grace period has elapsed with no data', () => {
  const targetTs = T0 + HORIZON_MS['12h'];
  const outcome = { targetTs, entryPrice: 100, direction: 'BULLISH' };
  const result = resolveOutcome(outcome, [], targetTs + 7 * 3_600_000); // 7h after target, grace is 6h
  assert.equal(result.status, OUTCOME_STATUS.INSUFFICIENT_DATA);
});

test('resolveOutcome: never fabricates a result — no observations means no return computed', () => {
  const targetTs = T0 + HORIZON_MS['12h'];
  const outcome = { targetTs, entryPrice: 100, direction: 'BULLISH' };
  const result = resolveOutcome(outcome, [], targetTs + 7 * 3_600_000);
  assert.equal(result.actualReturn, null);
  assert.equal(result.success, null);
});

test('buildPendingOutcomes: creates one row per horizon with correct target timestamps', () => {
  const rows = buildPendingOutcomes({ signalId: 'sig_1', assetId: 'BTC', signalTs: T0, entryPrice: 100, direction: 'BULLISH' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].horizon, '12h');
  assert.equal(rows[0].targetTs, T0 + HORIZON_MS['12h']);
  assert.equal(rows[1].targetTs, T0 + HORIZON_MS['24h']);
  assert.ok(rows.every((r) => r.status === OUTCOME_STATUS.GENERATED));
});
