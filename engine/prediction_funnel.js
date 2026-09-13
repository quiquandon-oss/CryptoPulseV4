// engine/prediction_funnel.js
//
// Short-term portfolio prediction funnel — reuses V2's existing k-NN and
// TimesFM (Experiment 4) prediction models rather than building a new one,
// per the explicit decision to not repeat V2's own path of inventing yet
// another forecasting model. V4 contributes the honest aggregation and
// disclosure layer V2 never needed (V2 predicts individual coins; this
// combines those into a portfolio-level view while being explicit about
// what that combination does and doesn't account for).
//
// MINIMUM SAMPLE GATE for any accuracy claim, matching the threshold
// engine/performance.js already uses elsewhere in V4.
export const MIN_RESOLVED_SAMPLES = 20;

/**
 * Projects one asset's price range from a percentile return distribution.
 * Returns null if currentPrice is missing/invalid — never fabricates a
 * price from nothing.
 * @param currentPrice   live price now
 * @param p25ReturnPct   e.g. -1.5 for -1.5% (V2's own units)
 * @param medianReturnPct
 * @param p75ReturnPct
 */
export function projectAssetPriceRange(currentPrice, p25ReturnPct, medianReturnPct, p75ReturnPct) {
  if (currentPrice == null || !(currentPrice > 0)) return null;
  const apply = (pct) => (pct == null ? null : currentPrice * (1 + pct / 100));
  return { p25: apply(p25ReturnPct), median: apply(medianReturnPct), p75: apply(p75ReturnPct) };
}

/**
 * Combines per-asset projections into a portfolio-level funnel.
 *
 * METHODOLOGY, disclosed in the return value rather than hidden: sums each
 * modeled asset's OWN percentile independently (portfolio_p25 = sum of each
 * asset's individual p25 value) rather than a jointly-modeled portfolio
 * percentile. This assumes every asset simultaneously hits its own
 * worst/best case, which is more extreme than reality unless the assets are
 * perfectly correlated — the resulting band is a defensible upper bound on
 * uncertainty, not a statistically correct portfolio-level percentile.
 * Building the correlation-aware version would need the joint historical
 * return distribution across all holdings, which V2's per-coin models don't
 * provide — noted as a known limitation, not silently smoothed over.
 *
 * Any held asset with no entry in `predictions` is held flat at its current
 * price (0% assumed change) and listed in `coverage.flatAssets` — never
 * silently included as if modeled.
 *
 * @param holdings       { [asset]: { quantity } } — from computeHoldings
 * @param currentPrices  { [asset]: number }
 * @param predictions    { [asset]: { p25ReturnPct, medianReturnPct, p75ReturnPct } }
 *                       — only assets with an actual model prediction present
 */
export function projectPortfolioFunnel(holdings, currentPrices, predictions) {
  const assets = Object.keys(holdings || {}).filter((a) => holdings[a].quantity > 0);
  if (!assets.length) return null;

  let currentValue = 0, p25Value = 0, medianValue = 0, p75Value = 0, modeledValue = 0;
  const modeledAssets = [], flatAssets = [];

  for (const asset of assets) {
    const qty = holdings[asset].quantity;
    const price = currentPrices?.[asset];
    if (price == null) return null; // never project from a missing price

    currentValue += qty * price;
    const pred = predictions?.[asset];

    if (pred) {
      const range = projectAssetPriceRange(price, pred.p25ReturnPct, pred.medianReturnPct, pred.p75ReturnPct);
      p25Value += qty * (range.p25 ?? price);
      medianValue += qty * (range.median ?? price);
      p75Value += qty * (range.p75 ?? price);
      modeledAssets.push(asset);
      modeledValue += qty * price;
    } else {
      p25Value += qty * price;
      medianValue += qty * price;
      p75Value += qty * price;
      flatAssets.push(asset);
    }
  }

  return {
    currentValue, p25Value, medianValue, p75Value,
    coverage: {
      modeledAssets, flatAssets,
      coveragePct: currentValue > 0 ? modeledValue / currentValue : 0,
    },
    methodologyNote: 'Each modeled asset\u2019s own predicted range is summed independently, assuming every asset hits its own best/worst case at the same time \u2014 this likely widens the band beyond what a true correlation-aware portfolio estimate would show. Assets with no prediction model are held at today\u2019s price, not assumed to move.',
  };
}

/**
 * Gate for showing a model's accuracy-derived claims. Mirrors the
 * 20-sample minimum already used in engine/performance.js — a resolved
 * count below this is "insufficient data," full stop, regardless of the
 * apparent accuracy percentage.
 */
export function evaluateModelSufficiency(resolvedCount, correctCount) {
  const sufficient = resolvedCount >= MIN_RESOLVED_SAMPLES;
  const accuracy = resolvedCount > 0 ? correctCount / resolvedCount : null;
  return {
    sufficient,
    resolvedCount,
    accuracy,
    message: sufficient
      ? `${(accuracy * 100).toFixed(0)}% accuracy over ${resolvedCount} resolved predictions.`
      : `Insufficient data \u2014 only ${resolvedCount} resolved prediction${resolvedCount === 1 ? '' : 's'} (need ${MIN_RESOLVED_SAMPLES}+ for a reliable accuracy read).`,
  };
}
