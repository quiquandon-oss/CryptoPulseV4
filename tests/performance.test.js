import test from 'node:test';
import assert from 'node:assert/strict';
import { computePerformance, computePerformanceBySegment, MIN_SAMPLES } from '../engine/performance.js';

function makeOutcomes(n, { winRatio = 0.6 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const success = i < Math.round(n * winRatio);
    return { actualReturn: success ? 0.02 : -0.015, success };
  });
}

test('computePerformance: reports INSUFFICIENT_DATA below the minimum sample size, never a bare percentage', () => {
  const result = computePerformance(makeOutcomes(MIN_SAMPLES - 1));
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.winRate, undefined);
  assert.match(result.message, /Insufficient evidence/);
});

test('computePerformance: computes win rate, avg and median return once the sample size is met', () => {
  const result = computePerformance(makeOutcomes(MIN_SAMPLES, { winRatio: 0.6 }));
  assert.equal(result.status, 'OK');
  assert.equal(result.samples, MIN_SAMPLES);
  assert.ok(Math.abs(result.winRate - 0.6) < 1e-9);
  assert.ok(result.avgReturn > 0);
});

test('computePerformance: NEUTRAL (unscored) outcomes are excluded from win rate but included in returns', () => {
  const outcomes = [
    ...makeOutcomes(MIN_SAMPLES, { winRatio: 1 }),
    { actualReturn: 0.0, success: null },
  ];
  const result = computePerformance(outcomes);
  assert.equal(result.samples, MIN_SAMPLES + 1);
  assert.equal(result.winRate, 1); // the null-success row is excluded from the win-rate denominator
});

test('computePerformanceBySegment: groups by an arbitrary key and gates each group independently', () => {
  const outcomes = [
    ...makeOutcomes(MIN_SAMPLES).map((o) => ({ ...o, asset: 'BTC' })),
    ...makeOutcomes(3).map((o) => ({ ...o, asset: 'LINK' })),
  ];
  const bySegment = computePerformanceBySegment(outcomes, (o) => o.asset);
  assert.equal(bySegment.BTC.status, 'OK');
  assert.equal(bySegment.LINK.status, 'INSUFFICIENT_DATA');
});
