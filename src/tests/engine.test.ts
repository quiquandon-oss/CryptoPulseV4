import { describe, it, expect } from 'vitest';
import { Candle } from '@/types';
import { evaluateIndicators } from '@/engine/technical/indicators';
import { generateSignal } from '@/engine/technical/signal';

function createMockCandles(prices: number[]): Candle[] {
  const baseTime = 1700000000000;
  return prices.map((price, idx) => ({
    timestamp: baseTime + idx * 3600 * 1000,
    asset: 'BTC',
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1000,
    source: 'Binance',
  }));
}

describe('Deterministic Technical Engine & Signal System', () => {
  it('calculates deterministic indicators correctly on uptrend candles', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const candles = createMockCandles(prices);
    const indicators = evaluateIndicators(candles);

    expect(indicators.sma.bias).toBe('BULLISH');
    expect(indicators.ema.cross).toBe('BULLISH');
    expect(indicators.ichimoku.priceVsCloud).toBe('ABOVE');
    expect(indicators.momentum.bias).toBe('BULLISH');
  });

  it('generates a strong BULLISH (+2) signal when evidence is unanimous', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const candles = createMockCandles(prices);
    const signal = generateSignal('BTC', candles, 'LIVE');

    expect(signal.score).toBe(2);
    expect(signal.direction).toBe('BULLISH');
    expect(signal.evidence.bullishCount).toBeGreaterThanOrEqual(4);
    expect(signal.evidence.evidenceStrength).toBe('STRONG');
  });

  it('generates a strong BEARISH (-2) signal on steady downtrend', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 200 - i * 2);
    const candles = createMockCandles(prices);
    const signal = generateSignal('BTC', candles, 'LIVE');

    expect(signal.score).toBe(-2);
    expect(signal.direction).toBe('BEARISH');
    expect(signal.evidence.bearishCount).toBeGreaterThanOrEqual(4);
  });

  it('detects signal persistence over consecutive evaluations', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const candles = createMockCandles(prices);
    const prevScores = [2, 2];
    const signal = generateSignal('BTC', candles, 'LIVE', prevScores);

    expect(signal.persistence.consecutiveEvaluations).toBe(3);
    expect(signal.persistence.isStable).toBe(true);
  });

  it('detects unstable signals when scores flip polarity', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const candles = createMockCandles(prices);
    const prevScores = [-2, 1];
    const signal = generateSignal('BTC', candles, 'LIVE', prevScores);

    expect(signal.persistence.isStable).toBe(false);
  });
});
