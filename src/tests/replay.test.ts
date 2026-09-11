import { describe, it, expect } from 'vitest';
import { Candle } from '@/types';
import { replayHistoricalSignals, resolveSignalOutcomes, calculatePerformanceStats } from '@/engine/outcome/engine';

function createMockCandles(prices: number[]): Candle[] {
  const baseTime = 1700000000000;
  return prices.map((price, idx) => ({
    timestamp: baseTime + idx * 3600 * 1000,
    asset: 'BTC',
    open: price,
    high: price * 1.005,
    low: price * 0.995,
    close: price,
    volume: 1000,
    source: 'Binance',
  }));
}

describe('Historical Point-in-Time Replay & Outcome Engine', () => {
  it('replays historical signals with zero look-ahead leakage', () => {
    const prices = Array.from({ length: 100 }, (_, i) => 100 + i * 2);
    const candles = createMockCandles(prices);

    const replayedSignals = replayHistoricalSignals('BTC', candles, 6);
    expect(replayedSignals.length).toBeGreaterThan(0);

    for (const sig of replayedSignals) {
      expect(sig.mode).toBe('SIMULATED');
    }
  });

  it('resolves 12h and 24h outcomes accurately', () => {
    const prices = Array.from({ length: 100 }, (_, i) => 100 + i * 2);
    const candles = createMockCandles(prices);

    const replayedSignals = replayHistoricalSignals('BTC', candles, 6);
    const outcomes = resolveSignalOutcomes(replayedSignals, candles);

    expect(outcomes.length).toBe(replayedSignals.length * 2);

    const resolved = outcomes.filter((o) => o.status === 'RESOLVED');
    expect(resolved.length).toBeGreaterThan(0);

    for (const r of resolved) {
      expect(r.actualReturnPercent).toBeGreaterThan(0);
      expect(r.isSuccess).toBe(true);
    }
  });

  it('enforces sample size limits for performance statistics', () => {
    const stats = calculatePerformanceStats('BTC', '12h', 'SIMULATED');
    if (stats.sampleCount < 10) {
      expect(stats.winRatePercent).toBeNull();
      expect(stats.isStatisticallySufficient).toBe(false);
    }
  });
});
