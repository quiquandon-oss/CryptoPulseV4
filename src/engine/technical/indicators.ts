import { Candle, IndicatorResult, SignalDirection } from '@/types';

export function calculateRSI(closes: number[], period: number = 14): {
  value: number;
  state: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
  interpretation: string;
  bias: SignalDirection;
} {
  if (closes.length < period + 1) {
    return {
      value: 50,
      state: 'NEUTRAL',
      interpretation: 'Insufficient data for RSI',
      bias: 'NEUTRAL',
    };
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) {
    return {
      value: 100,
      state: 'OVERBOUGHT',
      interpretation: 'RSI at 100 (Max momentum)',
      bias: 'BULLISH',
    };
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  const roundedRSI = Math.round(rsi * 100) / 100;

  let state: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' = 'NEUTRAL';
  let bias: SignalDirection = 'NEUTRAL';
  let interpretation = `RSI is neutral at ${roundedRSI}`;

  if (roundedRSI >= 70) {
    state = 'OVERBOUGHT';
    bias = 'BEARISH';
    interpretation = `RSI at ${roundedRSI} indicates overbought conditions (potential pullback risk)`;
  } else if (roundedRSI <= 30) {
    state = 'OVERSOLD';
    bias = 'BULLISH';
    interpretation = `RSI at ${roundedRSI} indicates oversold conditions (potential rebound signal)`;
  } else if (roundedRSI > 55) {
    bias = 'BULLISH';
    interpretation = `RSI at ${roundedRSI} shows positive bullish momentum`;
  } else if (roundedRSI < 45) {
    bias = 'BEARISH';
    interpretation = `RSI at ${roundedRSI} shows weak bearish momentum`;
  }

  return { value: roundedRSI, state, interpretation, bias };
}

export function calculateSMA(closes: number[]): {
  sma20: number;
  sma50: number;
  priceVsSma20Ratio: number;
  slope: 'RISING' | 'FALLING' | 'FLAT';
  interpretation: string;
  bias: SignalDirection;
} {
  const currentPrice = closes[closes.length - 1] || 0;
  const getMean = (slice: number[]) => slice.reduce((a, b) => a + b, 0) / slice.length;

  const sma20 = closes.length >= 20 ? getMean(closes.slice(-20)) : currentPrice;
  const sma50 = closes.length >= 50 ? getMean(closes.slice(-50)) : currentPrice;

  let slope: 'RISING' | 'FALLING' | 'FLAT' = 'FLAT';
  if (closes.length >= 25) {
    const prevSma20 = getMean(closes.slice(-25, -5));
    const diff = ((sma20 - prevSma20) / prevSma20) * 100;
    if (diff > 0.3) slope = 'RISING';
    else if (diff < -0.3) slope = 'FALLING';
  }

  const ratio = sma20 > 0 ? (currentPrice - sma20) / sma20 : 0;
  let bias: SignalDirection = 'NEUTRAL';
  let interpretation = 'Price near SMA20 baseline';

  if (currentPrice > sma20 && sma20 > sma50) {
    bias = 'BULLISH';
    interpretation = `Price ($${currentPrice.toFixed(2)}) is above SMA20 ($${sma20.toFixed(
      2
    )}) and SMA50 ($${sma50.toFixed(2)}) with a bullish alignment`;
  } else if (currentPrice < sma20 && sma20 < sma50) {
    bias = 'BEARISH';
    interpretation = `Price ($${currentPrice.toFixed(2)}) is below SMA20 ($${sma20.toFixed(
      2
    )}) and SMA50 ($${sma50.toFixed(2)}) with a bearish alignment`;
  } else if (currentPrice > sma20) {
    bias = 'BULLISH';
    interpretation = `Price ($${currentPrice.toFixed(2)}) trades above short-term SMA20 ($${sma20.toFixed(2)})`;
  } else if (currentPrice < sma20) {
    bias = 'BEARISH';
    interpretation = `Price ($${currentPrice.toFixed(2)}) trades below short-term SMA20 ($${sma20.toFixed(2)})`;
  }

  return {
    sma20: Math.round(sma20 * 100) / 100,
    sma50: Math.round(sma50 * 100) / 100,
    priceVsSma20Ratio: Math.round(ratio * 10000) / 10000,
    slope,
    interpretation,
    bias,
  };
}

export function calculateEMA(closes: number[]): {
  ema12: number;
  ema26: number;
  cross: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  interpretation: string;
  bias: SignalDirection;
} {
  const computeEMA = (data: number[], period: number): number => {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };

  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);

  let cross: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let bias: SignalDirection = 'NEUTRAL';

  if (ema12 > ema26) {
    cross = 'BULLISH';
    bias = 'BULLISH';
  } else if (ema12 < ema26) {
    cross = 'BEARISH';
    bias = 'BEARISH';
  }

  const interpretation =
    cross === 'BULLISH'
      ? `EMA12 ($${ema12.toFixed(2)}) is above EMA26 ($${ema26.toFixed(2)}), confirming bullish trend bias`
      : cross === 'BEARISH'
      ? `EMA12 ($${ema12.toFixed(2)}) is below EMA26 ($${ema26.toFixed(2)}), confirming bearish trend bias`
      : 'EMA12 and EMA26 are convergent';

  return {
    ema12: Math.round(ema12 * 100) / 100,
    ema26: Math.round(ema26 * 100) / 100,
    cross,
    interpretation,
    bias,
  };
}

export function calculateIchimoku(candles: Candle[]): {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  priceVsCloud: 'ABOVE' | 'BELOW' | 'INSIDE';
  cloudColor: 'BULLISH' | 'BEARISH';
  interpretation: string;
  bias: SignalDirection;
} {
  const getMidpoint = (slice: Candle[]) => {
    if (slice.length === 0) return 0;
    let high = -Infinity;
    let low = Infinity;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
    return (high + low) / 2;
  };

  const currentPrice = candles[candles.length - 1]?.close || 0;
  const tenkan = candles.length >= 9 ? getMidpoint(candles.slice(-9)) : currentPrice;
  const kijun = candles.length >= 26 ? getMidpoint(candles.slice(-26)) : currentPrice;

  const senkouA = (tenkan + kijun) / 2;
  const senkouB = candles.length >= 52 ? getMidpoint(candles.slice(-52)) : currentPrice;

  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);

  let priceVsCloud: 'ABOVE' | 'BELOW' | 'INSIDE' = 'INSIDE';
  let bias: SignalDirection = 'NEUTRAL';

  if (currentPrice > cloudTop) {
    priceVsCloud = 'ABOVE';
    bias = 'BULLISH';
  } else if (currentPrice < cloudBottom) {
    priceVsCloud = 'BELOW';
    bias = 'BEARISH';
  }

  const cloudColor: 'BULLISH' | 'BEARISH' = senkouA >= senkouB ? 'BULLISH' : 'BEARISH';

  const interpretation =
    priceVsCloud === 'ABOVE'
      ? `Price ($${currentPrice.toFixed(2)}) is trading above the Ichimoku Cloud (Bullish)`
      : priceVsCloud === 'BELOW'
      ? `Price ($${currentPrice.toFixed(2)}) is trading below the Ichimoku Cloud (Bearish)`
      : `Price ($${currentPrice.toFixed(2)}) is trading inside the Ichimoku Cloud (Neutral/Consolidation)`;

  return {
    tenkan: Math.round(tenkan * 100) / 100,
    kijun: Math.round(kijun * 100) / 100,
    senkouA: Math.round(senkouA * 100) / 100,
    senkouB: Math.round(senkouB * 100) / 100,
    priceVsCloud,
    cloudColor,
    interpretation,
    bias,
  };
}

export function calculateMomentum(closes: number[]): {
  roc: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  interpretation: string;
  bias: SignalDirection;
} {
  const currentPrice = closes[closes.length - 1] || 0;
  const prevPrice = closes.length >= 12 ? closes[closes.length - 12] : closes[0] || currentPrice;
  const roc = prevPrice > 0 ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;

  const computeEMA = (data: number[], period: number): number[] => {
    const res: number[] = [];
    if (data.length === 0) return res;
    const k = 2 / (period + 1);
    let ema = data[0];
    res.push(ema);
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
      res.push(ema);
    }
    return res;
  };

  const ema12Series = computeEMA(closes, 12);
  const ema26Series = computeEMA(closes, 26);
  const macdSeries = ema12Series.map((val, idx) => val - ema26Series[idx]);
  const signalSeries = computeEMA(macdSeries, 9);

  const macd = macdSeries[macdSeries.length - 1] || 0;
  const macdSignal = signalSeries[signalSeries.length - 1] || 0;
  const macdHist = macd - macdSignal;

  let bias: SignalDirection = 'NEUTRAL';
  if (macdHist > 0 && roc > 0) {
    bias = 'BULLISH';
  } else if (macdHist < 0 && roc < 0) {
    bias = 'BEARISH';
  }

  const interpretation =
    bias === 'BULLISH'
      ? `Momentum is positive with ROC at ${roc.toFixed(2)}% and positive MACD histogram (${macdHist.toFixed(2)})`
      : bias === 'BEARISH'
      ? `Momentum is negative with ROC at ${roc.toFixed(2)}% and negative MACD histogram (${macdHist.toFixed(2)})`
      : `Momentum indicators are mixed (ROC: ${roc.toFixed(2)}%, MACD Hist: ${macdHist.toFixed(2)})`;

  return {
    roc: Math.round(roc * 100) / 100,
    macd: Math.round(macd * 100) / 100,
    macdSignal: Math.round(macdSignal * 100) / 100,
    macdHist: Math.round(macdHist * 100) / 100,
    interpretation,
    bias,
  };
}

export function calculateVolatility(candles: Candle[]): {
  atr: number;
  bollingerUpper: number;
  bollingerLower: number;
  bollingerMiddle: number;
  state: 'HIGH' | 'LOW' | 'NORMAL';
  interpretation: string;
} {
  const closes = candles.map((c) => c.close);

  let trSum = 0;
  const count = Math.min(14, candles.length - 1);
  for (let i = candles.length - count; i < candles.length; i++) {
    if (i <= 0) continue;
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  const atr = count > 0 ? trSum / count : 0;

  const slice = closes.slice(-20);
  const mean = slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (slice.length || 1);
  const stdDev = Math.sqrt(variance);

  const bollingerMiddle = mean;
  const bollingerUpper = mean + 2 * stdDev;
  const bollingerLower = mean - 2 * stdDev;

  const bandwidth = mean > 0 ? ((bollingerUpper - bollingerLower) / mean) * 100 : 0;

  let state: 'HIGH' | 'LOW' | 'NORMAL' = 'NORMAL';
  if (bandwidth > 8) state = 'HIGH';
  else if (bandwidth < 2) state = 'LOW';

  const interpretation = `Volatility is ${state.toLowerCase()} with Bollinger Bandwidth of ${bandwidth.toFixed(
    2
  )}% and ATR of $${atr.toFixed(2)}`;

  return {
    atr: Math.round(atr * 100) / 100,
    bollingerUpper: Math.round(bollingerUpper * 100) / 100,
    bollingerLower: Math.round(bollingerLower * 100) / 100,
    bollingerMiddle: Math.round(bollingerMiddle * 100) / 100,
    state,
    interpretation,
  };
}

export function evaluateIndicators(candles: Candle[]): IndicatorResult {
  const closes = candles.map((c) => c.close);

  return {
    rsi: calculateRSI(closes),
    sma: calculateSMA(closes),
    ema: calculateEMA(closes),
    ichimoku: calculateIchimoku(candles),
    momentum: calculateMomentum(closes),
    volatility: calculateVolatility(candles),
  };
}
