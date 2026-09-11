// engine/evidence.js
//
// Converts a raw indicator snapshot (engine/indicators.js output) into
// per-indicator directional facts, then an agreement measure.
// Deliberately NOT called "confidence" — see DATA_INTEGRITY_RULE in docs/ARCHITECTURE.md.

export const DIRECTION = Object.freeze({ BULLISH: 'BULLISH', BEARISH: 'BEARISH', NEUTRAL: 'NEUTRAL' });

/**
 * Each entry: { indicator, applicable, direction, state, interpretation }
 * `applicable` is false when there isn't enough history to say anything (never fabricated).
 * Volatility/ATR are risk metrics, not directional — they're returned for context but
 * excluded from the agreement ratio.
 */
export function evaluateIndicators(snapshot) {
  const out = [];

  // RSI — overbought/oversold state, bullish above 50 / bearish below 50.
  if (snapshot.rsi14 != null) {
    const v = snapshot.rsi14;
    const state = v >= 70 ? 'OVERBOUGHT' : v <= 30 ? 'OVERSOLD' : 'NEUTRAL';
    const direction = v > 50 ? DIRECTION.BULLISH : v < 50 ? DIRECTION.BEARISH : DIRECTION.NEUTRAL;
    out.push({
      indicator: 'RSI', applicable: true, direction, state, value: v,
      interpretation: `RSI ${v.toFixed(1)} — ${state.toLowerCase()}, ${direction.toLowerCase()} of the midline`,
    });
  } else {
    out.push({ indicator: 'RSI', applicable: false, direction: DIRECTION.NEUTRAL, state: 'UNKNOWN', value: null, interpretation: 'Insufficient history for RSI' });
  }

  // SMA — price position relative to the 20-period average.
  if (snapshot.sma20 != null && snapshot.price != null) {
    const direction = snapshot.price > snapshot.sma20 ? DIRECTION.BULLISH
      : snapshot.price < snapshot.sma20 ? DIRECTION.BEARISH : DIRECTION.NEUTRAL;
    const slopeNote = snapshot.sma50 != null
      ? (snapshot.sma20 > snapshot.sma50 ? 'SMA20 above SMA50 (short-term strength)' : 'SMA20 below SMA50 (short-term weakness)')
      : 'SMA50 not yet available';
    out.push({
      indicator: 'SMA', applicable: true, direction, state: direction, value: snapshot.sma20,
      interpretation: `Price ${direction === DIRECTION.BULLISH ? 'above' : direction === DIRECTION.BEARISH ? 'below' : 'at'} SMA20. ${slopeNote}.`,
    });
  } else {
    out.push({ indicator: 'SMA', applicable: false, direction: DIRECTION.NEUTRAL, state: 'UNKNOWN', value: null, interpretation: 'Insufficient history for SMA' });
  }

  // EMA — trend alignment: price and the fast EMA both above/below the slow EMA.
  if (snapshot.ema12 != null && snapshot.ema26 != null && snapshot.price != null) {
    const bullish = snapshot.price > snapshot.ema12 && snapshot.ema12 > snapshot.ema26;
    const bearish = snapshot.price < snapshot.ema12 && snapshot.ema12 < snapshot.ema26;
    const direction = bullish ? DIRECTION.BULLISH : bearish ? DIRECTION.BEARISH : DIRECTION.NEUTRAL;
    out.push({
      indicator: 'EMA', applicable: true, direction, state: direction, value: snapshot.ema12,
      interpretation: bullish ? 'Price and EMA12 above EMA26 — aligned uptrend'
        : bearish ? 'Price and EMA12 below EMA26 — aligned downtrend'
        : 'EMA12/EMA26 not aligned — mixed trend',
    });
  } else {
    out.push({ indicator: 'EMA', applicable: false, direction: DIRECTION.NEUTRAL, state: 'UNKNOWN', value: null, interpretation: 'Insufficient history for EMA' });
  }

  // MACD — histogram sign.
  if (snapshot.macd != null && snapshot.macdSignal != null) {
    const hist = snapshot.macd - snapshot.macdSignal;
    const direction = hist > 0 ? DIRECTION.BULLISH : hist < 0 ? DIRECTION.BEARISH : DIRECTION.NEUTRAL;
    out.push({
      indicator: 'MACD', applicable: true, direction, state: direction, value: hist,
      interpretation: `MACD histogram ${hist.toFixed(4)} — ${direction.toLowerCase()} momentum`,
    });
  } else {
    out.push({ indicator: 'MACD', applicable: false, direction: DIRECTION.NEUTRAL, state: 'UNKNOWN', value: null, interpretation: 'Insufficient history for MACD' });
  }

  // Ichimoku — price vs cloud (span A/B), tenkan/kijun relationship for interpretation.
  if (snapshot.ichimokuSpanA != null && snapshot.ichimokuSpanB != null && snapshot.price != null) {
    const cloudTop = Math.max(snapshot.ichimokuSpanA, snapshot.ichimokuSpanB);
    const cloudBottom = Math.min(snapshot.ichimokuSpanA, snapshot.ichimokuSpanB);
    const direction = snapshot.price > cloudTop ? DIRECTION.BULLISH
      : snapshot.price < cloudBottom ? DIRECTION.BEARISH : DIRECTION.NEUTRAL;
    const tk = snapshot.ichimokuTenkan != null && snapshot.ichimokuKijun != null
      ? (snapshot.ichimokuTenkan > snapshot.ichimokuKijun ? 'Tenkan above Kijun' : 'Tenkan below Kijun')
      : 'Tenkan/Kijun unavailable';
    out.push({
      indicator: 'Ichimoku', applicable: true, direction, state: direction, value: snapshot.price - cloudTop,
      interpretation: `Price ${direction === DIRECTION.NEUTRAL ? 'inside the cloud' : direction === DIRECTION.BULLISH ? 'above the cloud' : 'below the cloud'}. ${tk}.`,
    });
  } else {
    out.push({ indicator: 'Ichimoku', applicable: false, direction: DIRECTION.NEUTRAL, state: 'UNKNOWN', value: null, interpretation: 'Insufficient history for Ichimoku' });
  }

  // Momentum — rate of change sign.
  if (snapshot.momentum10 != null) {
    const direction = snapshot.momentum10 > 0 ? DIRECTION.BULLISH : snapshot.momentum10 < 0 ? DIRECTION.BEARISH : DIRECTION.NEUTRAL;
    out.push({
      indicator: 'Momentum', applicable: true, direction, state: direction, value: snapshot.momentum10,
      interpretation: `10-period momentum ${snapshot.momentum10.toFixed(2)}%`,
    });
  } else {
    out.push({ indicator: 'Momentum', applicable: false, direction: DIRECTION.NEUTRAL, state: 'UNKNOWN', value: null, interpretation: 'Insufficient history for Momentum' });
  }

  // Volatility / ATR — risk context only, never counted toward agreement.
  out.push({
    indicator: 'Volatility', applicable: false, directional: false, direction: DIRECTION.NEUTRAL,
    state: snapshot.volatility20 == null ? 'UNKNOWN' : snapshot.volatility20 >= 4 ? 'HIGH' : snapshot.volatility20 <= 1 ? 'LOW' : 'NORMAL',
    value: snapshot.volatility20 ?? null, interpretation: 'Risk context, not counted toward directional agreement.',
  });

  return out;
}

/**
 * agreement_ratio = (count of indicators agreeing with the majority directional call)
 *                   / (indicators that had enough data to evaluate, excluding non-directional ones)
 * Never described as statistical confidence — see docs/ARCHITECTURE.md.
 */
export function computeAgreement(indicatorFacts) {
  const directional = indicatorFacts.filter((f) => f.applicable && f.directional !== false);
  const bullish = directional.filter((f) => f.direction === DIRECTION.BULLISH).length;
  const bearish = directional.filter((f) => f.direction === DIRECTION.BEARISH).length;
  const applicable = directional.length;
  const majority = bullish >= bearish ? DIRECTION.BULLISH : DIRECTION.BEARISH;
  const majorityCount = Math.max(bullish, bearish);

  return {
    bullish,
    bearish,
    neutral: applicable - bullish - bearish,
    applicable,
    majorityDirection: applicable === 0 ? DIRECTION.NEUTRAL : majority,
    agreementRatio: applicable === 0 ? null : majorityCount / applicable,
    label: applicable === 0 ? 'Insufficient evidence' : `${majorityCount}/${applicable} indicators ${majority.toLowerCase()}`,
  };
}
