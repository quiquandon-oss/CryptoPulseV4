// engine/indicators.js
//
// Pure, deterministic technical-analysis calculations.
// Input: an array of candles, oldest first: { ts, open, high, low, close, volume }
// No I/O, no randomness, no AI. Every function documents its interpretation rule
// so the evidence/agreement engine can consume it without re-deriving meaning.

/** Fractional change from `previous` to `current` (e.g. 0.0234 for +2.34%).
 * Returns null rather than dividing by zero or NaN when either input is
 * missing or previous is exactly 0 — never fabricates a change figure from
 * incomplete data. */
export function computePercentChange(current, previous) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

/** Simple moving average of the last `period` closes. */
export function sma(candles, period) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

/** Exponential moving average of closes, seeded with an SMA of the first `period`. */
export function emaSeries(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = candles.slice(0, period).reduce((a, c) => a + c.close, 0) / period;
  out.push(prev);
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push(prev);
  }
  return out; // aligned to candles[period-1 ..]
}

export function ema(candles, period) {
  const series = emaSeries(candles, period);
  return series.length ? series[series.length - 1] : null;
}

/** Wilder's RSI over `period` (default 14). */
export function rsi(candles, period = 14) {
  if (candles.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD line, signal line (9-EMA of MACD) and histogram. */
export function macd(candles, fast = 12, slow = 26, signalPeriod = 9) {
  if (candles.length < slow + signalPeriod) return null;
  const fastSeries = emaSeries(candles, fast);
  const slowSeries = emaSeries(candles, slow);
  const offset = fastSeries.length - slowSeries.length;
  const macdSeries = slowSeries.map((slowVal, i) => fastSeries[i + offset] - slowVal);
  if (macdSeries.length < signalPeriod) return null;
  // EMA of the macd series itself
  const k = 2 / (signalPeriod + 1);
  let signal = macdSeries.slice(0, signalPeriod).reduce((a, v) => a + v, 0) / signalPeriod;
  for (let i = signalPeriod; i < macdSeries.length; i++) {
    signal = macdSeries[i] * k + signal * (1 - k);
  }
  const line = macdSeries[macdSeries.length - 1];
  return { line, signal, histogram: line - signal };
}

/** Bollinger Bands: SMA middle band, +/- stdDevMultiplier standard deviations. */
export function bollingerBands(candles, period = 20, stdDevMultiplier = 2) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const mean = slice.reduce((a, c) => a + c.close, 0) / period;
  const variance = slice.reduce((a, c) => a + (c.close - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return { middle: mean, upper: mean + stdDevMultiplier * stdDev, lower: mean - stdDevMultiplier * stdDev };
}

/** Average True Range over `period` (default 14). */
export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trueRanges.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trueRanges.slice(-period);
  return slice.reduce((a, v) => a + v, 0) / period;
}

/** Ichimoku Kinko Hyo: Tenkan(9), Kijun(26), Senkou Span A/B (projected 26 ahead, returned unprojected here). */
export function ichimoku(candles, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  if (candles.length < senkouBPeriod) return null;
  const mid = (period) => {
    const slice = candles.slice(-period);
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    return (high + low) / 2;
  };
  const tenkan = mid(tenkanPeriod);
  const kijun = mid(kijunPeriod);
  const spanA = (tenkan + kijun) / 2;
  const spanB = mid(senkouBPeriod);
  return { tenkan, kijun, spanA, spanB };
}

/** Rate-of-change momentum over `period` candles, as a percentage. */
export function momentum(candles, period = 10) {
  if (candles.length < period + 1) return null;
  const past = candles[candles.length - 1 - period].close;
  const now = candles[candles.length - 1].close;
  if (past === 0) return null;
  return ((now - past) / past) * 100;
}

/** Realized volatility: stdDev of log returns over `period`, annualization left to the caller. */
export function volatility(candles, period = 20) {
  if (candles.length < period + 1) return null;
  const slice = candles.slice(-(period + 1));
  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push(Math.log(slice[i].close / slice[i - 1].close));
  }
  const mean = returns.reduce((a, v) => a + v, 0) / returns.length;
  const variance = returns.reduce((a, v) => a + (v - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

/**
 * Compute the full indicator snapshot for one asset's candle series.
 * Returns null fields (not fabricated values) for any indicator without enough history.
 */
export function computeIndicatorSnapshot(candles) {
  const price = candles.length ? candles[candles.length - 1].close : null;
  const macdResult = macd(candles);
  const bb = bollingerBands(candles);
  const ich = ichimoku(candles);
  return {
    price,
    sma20: sma(candles, 20),
    sma50: sma(candles, 50),
    ema12: ema(candles, 12),
    ema26: ema(candles, 26),
    rsi14: rsi(candles, 14),
    macd: macdResult?.line ?? null,
    macdSignal: macdResult?.signal ?? null,
    bollingerUpper: bb?.upper ?? null,
    bollingerLower: bb?.lower ?? null,
    atr14: atr(candles, 14),
    ichimokuTenkan: ich?.tenkan ?? null,
    ichimokuKijun: ich?.kijun ?? null,
    ichimokuSpanA: ich?.spanA ?? null,
    ichimokuSpanB: ich?.spanB ?? null,
    momentum10: momentum(candles, 10),
    volatility20: volatility(candles, 20),
  };
}
