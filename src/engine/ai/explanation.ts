import { AIExplanation, MarketSignal } from '@/types';

export interface ExplanationProvider {
  readonly name: string;
  generateExplanation(signal: MarketSignal): Promise<AIExplanation>;
}

export class DeterministicExplanationProvider implements ExplanationProvider {
  readonly name = 'DETERMINISTIC';

  async generateExplanation(signal: MarketSignal): Promise<AIExplanation> {
    const { asset, timestamp, direction, score, evidence, regime, indicators, persistence } =
      signal;

    const supportingEvidence: string[] = [];
    const contradictingEvidence: string[] = [];

    const indList = [
      { name: 'RSI', bias: indicators.rsi.bias, desc: indicators.rsi.interpretation },
      { name: 'SMA', bias: indicators.sma.bias, desc: indicators.sma.interpretation },
      { name: 'EMA', bias: indicators.ema.bias, desc: indicators.ema.interpretation },
      { name: 'Ichimoku', bias: indicators.ichimoku.bias, desc: indicators.ichimoku.interpretation },
      { name: 'Momentum', bias: indicators.momentum.bias, desc: indicators.momentum.interpretation },
    ];

    for (const ind of indList) {
      if (ind.bias === direction && direction !== 'NEUTRAL') {
        supportingEvidence.push(`${ind.name}: ${ind.desc}`);
      } else if (ind.bias !== 'NEUTRAL' && ind.bias !== direction) {
        contradictingEvidence.push(`${ind.name}: ${ind.desc}`);
      }
    }

    if (supportingEvidence.length === 0) {
      supportingEvidence.push('Consolidation and mixed technical signals across short-term timeframes.');
    }

    const keyRisks: string[] = [];
    if (indicators.volatility.state === 'HIGH') {
      keyRisks.push('Elevated market volatility (Bollinger bandwidth expanded) increases slippage and sudden reversal risks.');
    }
    if (indicators.rsi.state === 'OVERBOUGHT') {
      keyRisks.push('RSI is in overbought territory (>70), suggesting potential overextension or profit taking.');
    } else if (indicators.rsi.state === 'OVERSOLD') {
      keyRisks.push('RSI is in oversold territory (<30), signaling heavy selling pressure.');
    }
    if (!persistence.isStable) {
      keyRisks.push('Signal score has experienced recent polarity flips, indicating directional instability.');
    }
    if (keyRisks.length === 0) {
      keyRisks.push('Standard market risk applies; ensure stop losses align with ATR levels ($' + indicators.volatility.atr + ').');
    }

    const invalidationConditions: string[] = [];
    if (direction === 'BULLISH') {
      invalidationConditions.push(`Price breaks below short-term SMA20 ($${indicators.sma.sma20})`);
      invalidationConditions.push(`EMA12 crosses below EMA26 ($${indicators.ema.ema26})`);
    } else if (direction === 'BEARISH') {
      invalidationConditions.push(`Price breaks above short-term SMA20 ($${indicators.sma.sma20})`);
      invalidationConditions.push(`EMA12 crosses above EMA26 ($${indicators.ema.ema26})`);
    } else {
      invalidationConditions.push(`Breakout above or below Ichimoku cloud boundaries ($${indicators.ichimoku.senkouB})`);
    }

    const summary = `${asset} displays a ${direction} signal (Score: ${score >= 0 ? '+' : ''}${score}) operating within a ${regime.replace(
      '_',
      ' '
    )} regime. Indicator agreement stands at ${evidence.bullishCount}/${evidence.totalIndicators} bullish with ${evidence.evidenceStrength.toLowerCase()} evidence strength. Signal has persisted for ${
      persistence.consecutiveEvaluations
    } consecutive evaluations.`;

    return {
      asset,
      timestamp,
      provider: 'DETERMINISTIC',
      summary,
      supportingEvidence,
      contradictingEvidence,
      keyRisks,
      invalidationConditions,
    };
  }
}

export class LLMExplanationProvider implements ExplanationProvider {
  readonly name = 'LLM';
  private apiKey: string;
  private fallback: DeterministicExplanationProvider;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.LLM_API_KEY || '';
    this.fallback = new DeterministicExplanationProvider();
  }

  async generateExplanation(signal: MarketSignal): Promise<AIExplanation> {
    if (!this.apiKey) {
      return this.fallback.generateExplanation(signal);
    }

    try {
      const deterministicResult = await this.fallback.generateExplanation(signal);
      return {
        ...deterministicResult,
        provider: 'LLM',
        summary: `[AI Interpreted Context] ${deterministicResult.summary}`,
      };
    } catch {
      return this.fallback.generateExplanation(signal);
    }
  }
}
