import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sma, ema, rsi, macd, bollingerBands, atr, ichimoku, momentum, volatility,
  computeIndicatorSnapshot,
} from '../engine/indicators.js';

function makeCandles(closes, { high, low, start = 1_700_000_000_000, stepMs = 3_600_000 } = {}) {
  return closes.map((close, i) => ({
    ts: start + i * stepMs,
    open: close,
    high: high ? high(close, i) : close * 1.001,
    low: low ? low(close, i) : close * 0.999,
    close,
    volume: 1000,
  }));
}

test('sma: matches a hand-computed average and requires enough history', () => {
  const candles = makeCandles([10, 20, 30, 40, 50]);
  assert.equal(sma(candles, 5), 30);
  assert.equal(sma(candles, 3), 40); // avg of last 3: 30,40,50
  assert.equal(sma(candles, 10), null); // insufficient history -> null, never fabricated
});

test('ema: constant price series converges to that price', () => {
  const candles = makeCandles(Array(30).fill(100));
  assert.equal(ema(candles, 12), 100);
});

test('ema: reacts more than sma to a recent price jump', () => {
  const closes = [...Array(20).fill(100), 200];
  const candles = makeCandles(closes);
  const smaVal = sma(candles, 20);
  const emaVal = ema(candles, 12);
  assert.ok(emaVal > smaVal, 'EMA should weight the recent jump more heavily than SMA');
});

test('rsi: stays within [0, 100] and is high in a strict uptrend', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const candles = makeCandles(closes);
  const value = rsi(candles, 14);
  assert.ok(value > 90, `expected RSI near 100 in a strict uptrend, got ${value}`);
  assert.ok(value <= 100 && value >= 0);
});

test('rsi: is low in a strict downtrend', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
  const candles = makeCandles(closes);
  const value = rsi(candles, 14);
  assert.ok(value < 10, `expected RSI near 0 in a strict downtrend, got ${value}`);
});

test('rsi: returns null without enough history', () => {
  assert.equal(rsi(makeCandles([1, 2, 3]), 14), null);
});

test('macd: histogram is positive when a fast uptrend overtakes a slow baseline', () => {
  const closes = [...Array(40).fill(100), ...Array.from({ length: 15 }, (_, i) => 100 + i * 5)];
  const candles = makeCandles(closes);
  const result = macd(candles);
  assert.ok(result, 'expected enough history for MACD');
  assert.ok(result.histogram > 0, 'expected positive histogram during a breakout');
});

test('bollingerBands: upper > middle > lower, and bands widen with volatility', () => {
  const flat = bollingerBands(makeCandles(Array(20).fill(100)));
  assert.equal(flat.upper, flat.middle);
  assert.equal(flat.lower, flat.middle);

  const noisy = bollingerBands(makeCandles([100, 110, 90, 115, 85, 120, 80, 105, 95, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]));
  assert.ok(noisy.upper > noisy.middle);
  assert.ok(noisy.lower < noisy.middle);
});

test('atr: is non-negative and null without enough history', () => {
  const candles = makeCandles(Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i)), {
    high: (c) => c + 2,
    low: (c) => c - 2,
  });
  const value = atr(candles, 14);
  assert.ok(value >= 0);
  assert.equal(atr(makeCandles([1, 2]), 14), null);
});

test('ichimoku: tenkan/kijun match the (highest high + lowest low) / 2 formula', () => {
  const highs = Array.from({ length: 60 }, (_, i) => 100 + i);
  const lows = Array.from({ length: 60 }, (_, i) => 90 + i);
  const closes = Array.from({ length: 60 }, (_, i) => 95 + i);
  const candles = closes.map((close, i) => ({
    ts: i, open: close, high: highs[i], low: lows[i], close, volume: 1,
  }));
  const result = ichimoku(candles);
  const last9 = candles.slice(-9);
  const expectedTenkan = (Math.max(...last9.map((c) => c.high)) + Math.min(...last9.map((c) => c.low))) / 2;
  assert.equal(result.tenkan, expectedTenkan);
  assert.equal(result.spanA, (result.tenkan + result.kijun) / 2);
});

test('momentum: positive in an uptrend, negative in a downtrend, sign-correct', () => {
  const up = momentum(makeCandles(Array.from({ length: 15 }, (_, i) => 100 + i * 3)), 10);
  const down = momentum(makeCandles(Array.from({ length: 15 }, (_, i) => 100 - i * 3)), 10);
  assert.ok(up > 0);
  assert.ok(down < 0);
});

test('volatility: zero for a constant price series, positive for a noisy one', () => {
  const flat = volatility(makeCandles(Array(25).fill(100)), 20);
  assert.equal(flat, 0);
  const noisy = volatility(makeCandles([100, 105, 98, 110, 95, 108, 97, 112, 93, 115, 90, 118, 88, 120, 85, 122, 83, 125, 80, 128, 78]), 20);
  assert.ok(noisy > 0);
});

test('computeIndicatorSnapshot: never fabricates — insufficient history yields null fields, not guesses', () => {
  const snapshot = computeIndicatorSnapshot(makeCandles([100, 101, 99, 102]));
  assert.equal(snapshot.price, 102);
  assert.equal(snapshot.rsi14, null);
  assert.equal(snapshot.sma50, null);
  assert.equal(snapshot.ichimokuTenkan, null);
});

test('computeIndicatorSnapshot: full fields populate with enough history', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.5);
  const snapshot = computeIndicatorSnapshot(makeCandles(closes));
  assert.ok(snapshot.sma20 !== null);
  assert.ok(snapshot.rsi14 !== null);
  assert.ok(snapshot.ichimokuTenkan !== null);
});
