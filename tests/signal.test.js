import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignal, computePersistence, assessRisk, directionFromScore } from '../engine/signal.js';

test('directionFromScore: sign mapping', () => {
  assert.equal(directionFromScore(2), 'BULLISH');
  assert.equal(directionFromScore(-1), 'BEARISH');
  assert.equal(directionFromScore(0), 'NEUTRAL');
});

test('assessRisk: HIGH_VOLATILITY regime always means HIGH risk regardless of agreement', () => {
  assert.equal(assessRisk('HIGH_VOLATILITY', { agreementRatio: 1 }), 'HIGH');
});

test('assessRisk: strong agreement in a calm regime means LOW risk', () => {
  assert.equal(assessRisk('TRENDING_BULLISH', { agreementRatio: 0.9 }), 'LOW');
});

test('assessRisk: weak agreement means HIGH risk even without high volatility', () => {
  assert.equal(assessRisk('RANGE_BOUND', { agreementRatio: 0.4 }), 'HIGH');
});

test('computePersistence: counts consecutive same-direction evaluations, newest first', () => {
  const result = computePersistence('BULLISH', ['BULLISH', 'BULLISH', 'BEARISH']);
  assert.equal(result.persistenceCount, 3); // current + 2 prior BULLISH before hitting BEARISH
  assert.equal(result.stability, 'STABLE');
});

test('computePersistence: flags instability on repeated flips (spec example: +2 -> -1 -> +2)', () => {
  const result = computePersistence('BULLISH', ['BEARISH', 'BULLISH']);
  assert.equal(result.stability, 'UNSTABLE');
});

test('computePersistence: a single evaluation with no history is STABLE with persistenceCount 1', () => {
  const result = computePersistence('BULLISH', []);
  assert.equal(result.persistenceCount, 1);
  assert.equal(result.stability, 'STABLE');
});

test('buildSignal: assembles score, direction, risk and persistence from agreement + regime', () => {
  const agreement = { bullish: 4, bearish: 1, applicable: 5, agreementRatio: 0.8, label: '4/5 indicators bullish' };
  const signal = buildSignal({ agreement, regime: 'TRENDING_BULLISH', priorDirections: ['BULLISH', 'BULLISH'] });
  assert.equal(signal.score, 3);
  assert.equal(signal.direction, 'BULLISH');
  assert.equal(signal.risk, 'LOW');
  assert.equal(signal.persistenceCount, 3);
  assert.equal(signal.stability, 'STABLE');
});

test('buildSignal: never claims a probability field that was not computed', () => {
  const agreement = { bullish: 4, bearish: 1, applicable: 5, agreementRatio: 0.8, label: '4/5 indicators bullish' };
  const signal = buildSignal({ agreement, regime: 'TRENDING_BULLISH', priorDirections: [] });
  assert.equal('probability' in signal, false);
  assert.equal('confidence' in signal, false);
});
