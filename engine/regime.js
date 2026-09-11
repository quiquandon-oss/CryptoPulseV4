// engine/regime.js
//
// Deterministic market-regime classification. No AI-generated labels.
// Thresholds are named constants so they're auditable from the audit page,
// per spec section 7 ("Document exactly how each regime is determined").

export const REGIME = Object.freeze({
  TRENDING_BULLISH: 'TRENDING_BULLISH',
  TRENDING_BEARISH: 'TRENDING_BEARISH',
  RANGE_BOUND: 'RANGE_BOUND',
  HIGH_VOLATILITY: 'HIGH_VOLATILITY',
  LOW_VOLATILITY: 'LOW_VOLATILITY',
  TRANSITION: 'TRANSITION',
  UNKNOWN: 'UNKNOWN',
});

// Volatility20 is stdDev of log returns * 100 over 20 periods (engine/indicators.js).
export const HIGH_VOLATILITY_THRESHOLD = 4.0;
export const LOW_VOLATILITY_THRESHOLD = 1.0;
// Bollinger band width, as a fraction of the middle band, below which price is "coiled".
export const RANGE_BAND_WIDTH_THRESHOLD = 0.04;
// Momentum (10-period % change) below this magnitude is treated as directionless.
export const FLAT_MOMENTUM_THRESHOLD = 0.5;

/**
 * @param snapshot output of engine/indicators.js computeIndicatorSnapshot
 * @param bands    output of engine/indicators.js bollingerBands (optional, for RANGE_BOUND detection)
 */
export function classifyRegime(snapshot, bands = null) {
  const { price, sma20, sma50, momentum10, volatility20 } = snapshot;

  if (price == null || sma20 == null || sma50 == null || momentum10 == null || volatility20 == null) {
    return { regime: REGIME.UNKNOWN, basis: 'Insufficient history to classify a regime yet.' };
  }

  if (volatility20 >= HIGH_VOLATILITY_THRESHOLD) {
    return {
      regime: REGIME.HIGH_VOLATILITY,
      basis: `volatility20 ${volatility20.toFixed(2)}% >= ${HIGH_VOLATILITY_THRESHOLD}% threshold.`,
    };
  }

  const bullishStack = price > sma20 && sma20 > sma50 && momentum10 > FLAT_MOMENTUM_THRESHOLD;
  const bearishStack = price < sma20 && sma20 < sma50 && momentum10 < -FLAT_MOMENTUM_THRESHOLD;

  if (bullishStack) {
    return {
      regime: REGIME.TRENDING_BULLISH,
      basis: `price > SMA20 (${sma20.toFixed(2)}) > SMA50 (${sma50.toFixed(2)}), momentum10 ${momentum10.toFixed(2)}% > ${FLAT_MOMENTUM_THRESHOLD}%.`,
    };
  }
  if (bearishStack) {
    return {
      regime: REGIME.TRENDING_BEARISH,
      basis: `price < SMA20 (${sma20.toFixed(2)}) < SMA50 (${sma50.toFixed(2)}), momentum10 ${momentum10.toFixed(2)}% < -${FLAT_MOMENTUM_THRESHOLD}%.`,
    };
  }

  if (bands) {
    const width = (bands.upper - bands.lower) / bands.middle;
    if (width <= RANGE_BAND_WIDTH_THRESHOLD && Math.abs(momentum10) < FLAT_MOMENTUM_THRESHOLD) {
      return {
        regime: REGIME.RANGE_BOUND,
        basis: `Bollinger band width ${(width * 100).toFixed(2)}% <= ${RANGE_BAND_WIDTH_THRESHOLD * 100}%, momentum10 flat.`,
      };
    }
  }

  if (volatility20 <= LOW_VOLATILITY_THRESHOLD && Math.abs(momentum10) < FLAT_MOMENTUM_THRESHOLD) {
    return {
      regime: REGIME.LOW_VOLATILITY,
      basis: `volatility20 ${volatility20.toFixed(2)}% <= ${LOW_VOLATILITY_THRESHOLD}% and momentum flat.`,
    };
  }

  // sma20/sma50 relationship disagrees with momentum direction: a crossover in progress.
  const smaSaysUp = sma20 > sma50;
  const momentumSaysUp = momentum10 > 0;
  if (smaSaysUp !== momentumSaysUp) {
    return {
      regime: REGIME.TRANSITION,
      basis: `SMA stack (${smaSaysUp ? 'bullish' : 'bearish'}) disagrees with momentum sign (${momentumSaysUp ? 'positive' : 'negative'}) — possible crossover.`,
    };
  }

  return { regime: REGIME.UNKNOWN, basis: 'No rule matched cleanly; defaulting to UNKNOWN rather than guessing.' };
}
