import {
  AssetSymbol,
  Candle,
  IndicatorResult,
  MarketSignal,
  SignalAgreement,
  SignalDirection,
  SignalMode,
} from '@/types';
import { evaluateIndicators } from './indicators';
import { classifyRegime } from './regime';

export function calculateAgreement(indicators: IndicatorResult): SignalAgreement {
  const biases: SignalDirection[] = [
    indicators.rsi.bias,
    indicators.sma.bias,
    indicators.ema.bias,
    indicators.ichimoku.bias,
    indicators.momentum.bias,
  ];

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const b of biases) {
    if (b === 'BULLISH') bullishCount++;
    else if (b === 'BEARISH') bearishCount++;
    else neutralCount++;
  }

  const totalIndicators = biases.length;
  const maxAgreement = Math.max(bullishCount, bearishCount);
  const agreementRatio = Math.round((maxAgreement / totalIndicators) * 100) / 100;

  let evidenceStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'CONFLICTED' = 'WEAK';
  if (agreementRatio >= 0.8) {
    evidenceStrength = 'STRONG';
  } else if (agreementRatio >= 0.6) {
    evidenceStrength = 'MODERATE';
  } else if (bullishCount >= 2 && bearishCount >= 2) {
    evidenceStrength = 'CONFLICTED';
  }

  return {
    totalIndicators,
    bullishCount,
    bearishCount,
    neutralCount,
    agreementRatio,
    evidenceStrength,
  };
}

export function generateSignal(
  asset: AssetSymbol,
  candles: Candle[],
  mode: SignalMode = 'LIVE',
  previousRecentScores: number[] = []
): MarketSignal {
  if (candles.length === 0) {
    throw new Error(`Cannot generate signal for ${asset}: zero candles provided`);
  }

  const latestCandle = candles[candles.length - 1];
  const closes = candles.map((c) => c.close);
  const indicators = evaluateIndicators(candles);
  const regime = classifyRegime(indicators, closes);
  const evidence = calculateAgreement(indicators);

  let rawScore = 0;
  if (evidence.bullishCount >= 4) rawScore = +2;
  else if (evidence.bullishCount === 3) rawScore = +1;
  else if (evidence.bearishCount >= 4) rawScore = -2;
  else if (evidence.bearishCount === 3) rawScore = -1;
  else rawScore = 0;

  let direction: SignalDirection = 'NEUTRAL';
  if (rawScore > 0) direction = 'BULLISH';
  else if (rawScore < 0) direction = 'BEARISH';

  const historyRecentScores = [...previousRecentScores, rawScore].slice(-5);
  let consecutiveEvaluations = 1;
  for (let i = historyRecentScores.length - 2; i >= 0; i--) {
    if (historyRecentScores[i] === rawScore) {
      consecutiveEvaluations++;
    } else {
      break;
    }
  }

  let isStable = true;
  if (historyRecentScores.length >= 3) {
    const last3 = historyRecentScores.slice(-3);
    const hasPos = last3.some((s) => s > 0);
    const hasNeg = last3.some((s) => s < 0);
    if (hasPos && hasNeg) {
      isStable = false;
    }
  }

  return {
    asset,
    timestamp: latestCandle.timestamp,
    mode,
    direction,
    score: rawScore,
    evidence,
    regime,
    indicators,
    persistence: {
      consecutiveEvaluations,
      isStable,
      historyRecentScores,
    },
    price: latestCandle.close,
    source: latestCandle.source,
  };
}
