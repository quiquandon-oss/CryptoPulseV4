import { describe, it, expect } from 'vitest';
import { MarketSignal } from '@/types';
import { DeterministicExplanationProvider, LLMExplanationProvider } from '@/engine/ai/explanation';

const mockSignal: MarketSignal = {
  asset: 'BTC',
  timestamp: 1700000000000,
  mode: 'LIVE',
  direction: 'BULLISH',
  score: 2,
  evidence: {
    totalIndicators: 5,
    bullishCount: 4,
    bearishCount: 1,
    neutralCount: 0,
    agreementRatio: 0.8,
    evidenceStrength: 'STRONG',
  },
  regime: 'TRENDING_BULLISH',
  indicators: {
    rsi: { value: 62, state: 'NEUTRAL', interpretation: 'RSI at 62', bias: 'BULLISH' },
    sma: { sma20: 95000, sma50: 92000, priceVsSma20Ratio: 0.02, slope: 'RISING', interpretation: 'Above SMA', bias: 'BULLISH' },
    ema: { ema12: 96000, ema26: 93000, cross: 'BULLISH', interpretation: 'EMA Bullish', bias: 'BULLISH' },
    ichimoku: { tenkan: 96000, kijun: 94000, senkouA: 95000, senkouB: 91000, priceVsCloud: 'ABOVE', cloudColor: 'BULLISH', interpretation: 'Above cloud', bias: 'BULLISH' },
    momentum: { roc: 3.5, macd: 500, macdSignal: 300, macdHist: 200, interpretation: 'Macd positive', bias: 'BULLISH' },
    volatility: { atr: 1500, bollingerUpper: 98000, bollingerLower: 92000, bollingerMiddle: 95000, state: 'NORMAL', interpretation: 'Normal vol' },
  },
  persistence: {
    consecutiveEvaluations: 4,
    isStable: true,
    historyRecentScores: [2, 2, 2, 2],
  },
  price: 97000,
  source: 'Binance',
};

describe('AI Explanation Layer', () => {
  it('generates fact-based deterministic explanations without hallucinating numbers', async () => {
    const provider = new DeterministicExplanationProvider();
    const explanation = await provider.generateExplanation(mockSignal);

    expect(explanation.provider).toBe('DETERMINISTIC');
    expect(explanation.asset).toBe('BTC');
    expect(explanation.summary).toContain('BULLISH');
    expect(explanation.supportingEvidence.length).toBeGreaterThan(0);
    expect(explanation.invalidationConditions.length).toBeGreaterThan(0);
  });

  it('falls back gracefully to deterministic provider when LLM key is missing', async () => {
    const llmProvider = new LLMExplanationProvider();
    const explanation = await llmProvider.generateExplanation(mockSignal);

    expect(explanation.asset).toBe('BTC');
    expect(explanation.summary.length).toBeGreaterThan(0);
  });
});
