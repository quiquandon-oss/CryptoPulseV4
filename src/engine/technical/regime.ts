import { IndicatorResult, MarketRegimeType } from '@/types';

export function classifyRegime(
  indicators: IndicatorResult,
  closes: number[]
): MarketRegimeType {
  const currentPrice = closes[closes.length - 1] || 0;
  const sma20 = indicators.sma.sma20;
  const sma50 = indicators.sma.sma50;
  const isHighVol = indicators.volatility.state === 'HIGH';
  const isLowVol = indicators.volatility.state === 'LOW';

  if (isHighVol) {
    return 'HIGH_VOLATILITY';
  }

  const isSmaBullish = currentPrice > sma20 && sma20 > sma50;
  const isEmaBullish = indicators.ema.cross === 'BULLISH';
  const isIchimokuBullish = indicators.ichimoku.priceVsCloud === 'ABOVE';

  if (isSmaBullish && isEmaBullish && isIchimokuBullish) {
    return 'TRENDING_BULLISH';
  }

  const isSmaBearish = currentPrice < sma20 && sma20 < sma50;
  const isEmaBearish = indicators.ema.cross === 'BEARISH';
  const isIchimokuBearish = indicators.ichimoku.priceVsCloud === 'BELOW';

  if (isSmaBearish && isEmaBearish && isIchimokuBearish) {
    return 'TRENDING_BEARISH';
  }

  if (
    isLowVol ||
    (indicators.ichimoku.priceVsCloud === 'INSIDE' &&
      Math.abs(indicators.sma.priceVsSma20Ratio) < 0.01)
  ) {
    return 'RANGE_BOUND';
  }

  if (isLowVol) {
    return 'LOW_VOLATILITY';
  }

  if (
    (indicators.ema.cross === 'BULLISH' && indicators.rsi.bias === 'BEARISH') ||
    (indicators.ema.cross === 'BEARISH' && indicators.rsi.bias === 'BULLISH')
  ) {
    return 'TRANSITION';
  }

  return 'UNKNOWN';
}
