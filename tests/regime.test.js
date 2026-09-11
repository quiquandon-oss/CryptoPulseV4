import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRegime, REGIME } from '../engine/regime.js';

test('regime: UNKNOWN when history is insufficient', () => {
  const result = classifyRegime({ price: 100, sma20: null, sma50: null, momentum10: null, volatility20: null });
  assert.equal(result.regime, REGIME.UNKNOWN);
});

test('regime: TRENDING_BULLISH when price > sma20 > sma50 with positive momentum and normal volatility', () => {
  const result = classifyRegime({ price: 110, sma20: 105, sma50: 100, momentum10: 3, volatility20: 2 });
  assert.equal(result.regime, REGIME.TRENDING_BULLISH);
});

test('regime: TRENDING_BEARISH when price < sma20 < sma50 with negative momentum and normal volatility', () => {
  const result = classifyRegime({ price: 90, sma20: 95, sma50: 100, momentum10: -3, volatility20: 2 });
  assert.equal(result.regime, REGIME.TRENDING_BEARISH);
});

test('regime: HIGH_VOLATILITY takes priority over trend stacking', () => {
  const result = classifyRegime({ price: 110, sma20: 105, sma50: 100, momentum10: 3, volatility20: 9 });
  assert.equal(result.regime, REGIME.HIGH_VOLATILITY);
});

test('regime: RANGE_BOUND when bands are tight and momentum is flat', () => {
  const result = classifyRegime(
    { price: 100, sma20: 100, sma50: 100.5, momentum10: 0.1, volatility20: 1.5 },
    { upper: 102, middle: 100, lower: 98 },
  );
  assert.equal(result.regime, REGIME.RANGE_BOUND);
});

test('regime: TRANSITION when SMA stack disagrees with momentum sign', () => {
  const result = classifyRegime({ price: 100, sma20: 101, sma50: 99, momentum10: -2, volatility20: 2 });
  assert.equal(result.regime, REGIME.TRANSITION);
});

test('regime: every branch returns a documented basis string', () => {
  const result = classifyRegime({ price: 110, sma20: 105, sma50: 100, momentum10: 3, volatility20: 2 });
  assert.ok(typeof result.basis === 'string' && result.basis.length > 0);
});
