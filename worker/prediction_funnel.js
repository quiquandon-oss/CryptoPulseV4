// worker/prediction_funnel.js
//
// Reuses V2's existing k-NN and TimesFM (Experiment 4) prediction models —
// read via the V1V2_DB binding (see wrangler.toml), a direct D1 read, never
// an HTTP call to V2's Worker. Deliberately does NOT build a new prediction
// model: V2 already has one, with its own real (and honestly mixed) track
// record, and repeating that effort here would just be a second thing that
// could be wrong instead of one thing everyone can point at.
import { computeHoldings } from '../engine/portfolio.js';
import { getAllTransactions, getCurrentPrices, getPortfolioHistory } from './portfolio.js';
import { projectPortfolioFunnel, projectAssetPriceRange, evaluateModelSufficiency } from '../engine/prediction_funnel.js';

const KNN_TABLES = {
  BTC: { table: 'predictions', priceCol: 'btc_price_at_prediction' },
  ETH: { table: 'eth_predictions', priceCol: 'eth_price_at_prediction' },
  LINK: { table: 'link_predictions', priceCol: 'link_price_at_prediction' },
};

/** Latest UNRESOLVED k-NN prediction for ONE asset at the given horizon, or
 * null if this asset has no k-NN model (SOL/HYPE) or no current prediction. */
async function fetchKnnPredictionForAsset(env, asset, horizonHours) {
  const cfg = KNN_TABLES[asset];
  if (!cfg) return null;
  const row = await env.V1V2_DB.prepare(
    `SELECT ts, target_ts, ${cfg.priceCol} as priceAtPrediction, median_analog_return, return_p25, return_p75, n_analogs, calibrated_p_up
     FROM ${cfg.table} WHERE horizon_hours = ? AND resolved_ts IS NULL ORDER BY ts DESC LIMIT 1`,
  ).bind(horizonHours).first();
  if (!row) return null;
  return {
    prediction: { p25ReturnPct: row.return_p25, medianReturnPct: row.median_analog_return, p75ReturnPct: row.return_p75 },
    detail: { predictionTs: row.ts, targetTs: row.target_ts, priceAtPrediction: row.priceAtPrediction, nAnalogs: row.n_analogs, calibratedPUp: row.calibrated_p_up },
  };
}

/** Latest UNRESOLVED k-NN prediction per covered asset (BTC/ETH/LINK only —
 * V2 has no k-NN model for SOL or HYPE) at the given horizon. */
async function fetchKnnPredictions(env, horizonHours) {
  const predictions = {};
  const details = {};
  for (const asset of Object.keys(KNN_TABLES)) {
    const result = await fetchKnnPredictionForAsset(env, asset, horizonHours);
    if (result) {
      predictions[asset] = result.prediction;
      details[asset] = result.detail;
    }
  }
  return { predictions, details };
}

/** k-NN's own historical accuracy, per asset — realized_up vs p_up direction,
 * same evidence-gating threshold as everywhere else in V4. */
async function fetchKnnSufficiency(env, asset) {
  const table = KNN_TABLES[asset].table;
  const row = await env.V1V2_DB.prepare(
    `SELECT COUNT(*) as resolved, SUM(CASE WHEN (calibrated_p_up >= 0.5 AND realized_up = 1) OR (calibrated_p_up < 0.5 AND realized_up = 0) THEN 1 ELSE 0 END) as correct
     FROM ${table} WHERE resolved_ts IS NOT NULL`,
  ).first();
  return evaluateModelSufficiency(row?.resolved || 0, row?.correct || 0);
}

/** Latest UNRESOLVED TimesFM prediction — BTC only, V2 has never run this
 * model for any other coin. Point forecast only (no percentile band in its
 * own schema) — never fabricates a spread from too few resolved samples. */
async function fetchTimesFmPrediction(env, horizonHours) {
  const row = await env.V1V2_DB.prepare(
    `SELECT ts, target_ts, price_at_prediction, forecast_price, predicted_return_pct, direction
     FROM experiment_4_timesfm WHERE coin = 'BTC' AND horizon_hours = ? AND resolved_ts IS NULL ORDER BY ts DESC LIMIT 1`,
  ).bind(horizonHours).first();

  const acc = await env.V1V2_DB.prepare(
    `SELECT COUNT(*) as resolved, SUM(correct) as correct FROM experiment_4_timesfm WHERE coin = 'BTC' AND resolved_ts IS NOT NULL`,
  ).first();
  const sufficiency = evaluateModelSufficiency(acc?.resolved || 0, acc?.correct || 0);

  return { row, sufficiency };
}

/**
 * Builds the full funnel response: real portfolio history (for the chart's
 * "actual" segment) + the projected funnel (for the "forecast" segment) +
 * full disclosure of what was and wasn't modeled.
 * @param model 'knn' | 'timesfm'
 * @param horizonHours 12 | 24
 */
export async function computePortfolioFunnel(env, model, horizonHours) {
  const transactions = await getAllTransactions(env.DB);
  const holdings = computeHoldings(transactions);
  const currentPrices = await getCurrentPrices(env);
  const historyPoints = await getPortfolioHistory(env.DB, Date.now() - 7 * 86_400_000);

  if (model === 'timesfm') {
    const { row, sufficiency } = await fetchTimesFmPrediction(env, horizonHours);
    if (!row) {
      return { model, horizonHours, historyPoints, funnel: null, sufficiency, message: 'No current TimesFM prediction available for this horizon.' };
    }
    // Point forecast only — p25/median/p75 collapse to the same value in
    // projectPortfolioFunnel, which correctly renders as a line, not a band,
    // rather than needing special-case handling for "no band" here.
    const predictions = { BTC: { p25ReturnPct: row.predicted_return_pct, medianReturnPct: row.predicted_return_pct, p75ReturnPct: row.predicted_return_pct } };
    const funnel = projectPortfolioFunnel(holdings, currentPrices, predictions);
    return {
      model, horizonHours, historyPoints, funnel, sufficiency, isPointForecastOnly: true,
      targetTs: row.target_ts, predictionTs: row.ts,
      coverageNote: 'TimesFM has only ever been run for BTC \u2014 ETH, LINK, SOL, and HYPE are all held at today\u2019s price in this projection, not modeled.',
    };
  }

  if (model === 'knn') {
    const { predictions, details } = await fetchKnnPredictions(env, horizonHours);
    const funnel = projectPortfolioFunnel(holdings, currentPrices, predictions);
    const sufficiencyByAsset = {};
    for (const asset of Object.keys(details)) {
      sufficiencyByAsset[asset] = await fetchKnnSufficiency(env, asset);
    }
    // Use the earliest target_ts among modeled assets for the funnel's
    // labeled horizon point — conservative (nearest-in-time), and honestly
    // reflects that per-asset predictions weren't all made at exactly the
    // same tick, rather than implying a single precise shared instant.
    const targetTsValues = Object.values(details).map((d) => d.targetTs);
    const targetTs = targetTsValues.length ? Math.min(...targetTsValues) : null;
    return {
      model, horizonHours, historyPoints, funnel, details, sufficiencyByAsset, targetTs,
      coverageNote: funnel?.coverage.flatAssets.length
        ? `${funnel.coverage.flatAssets.join(', ')} ${funnel.coverage.flatAssets.length === 1 ? 'has' : 'have'} no k-NN model \u2014 held at today\u2019s price, not modeled.`
        : null,
    };
  }

  return { model, horizonHours, historyPoints, funnel: null, message: `Unknown model "${model}".` };
}

/**
 * Per-coin equivalent of computePortfolioFunnel — same models, same
 * disclosure rules, one asset instead of the whole portfolio. Reuses
 * projectAssetPriceRange directly (not projectPortfolioFunnel, which is
 * for combining multiple assets) since there's nothing to aggregate here.
 * @param asset 'BTC' | 'ETH' | 'LINK' | 'SOL' | 'HYPE'
 */
export async function computeAssetFunnel(env, asset, model, horizonHours) {
  const { results: candles } = await env.DB
    .prepare('SELECT ts, close FROM market_observations WHERE asset_id = ? AND ts >= ? ORDER BY ts ASC')
    .bind(asset, Date.now() - 7 * 86_400_000).all();
  const historyPoints = (candles || []).map((c) => ({ ts: c.ts, price: c.close }));
  const currentPrice = historyPoints.length ? historyPoints[historyPoints.length - 1].price : null;

  if (currentPrice == null) {
    return { model, horizonHours, asset, historyPoints, funnel: null, message: `No recent price history for ${asset}.` };
  }

  if (model === 'timesfm') {
    if (asset !== 'BTC') {
      return { model, horizonHours, asset, historyPoints, funnel: null, message: `TimesFM has never been run for ${asset} \u2014 only BTC.` };
    }
    const { row, sufficiency } = await fetchTimesFmPrediction(env, horizonHours);
    if (!row) {
      return { model, horizonHours, asset, historyPoints, funnel: null, sufficiency, message: 'No current TimesFM prediction available for this horizon.' };
    }
    const range = projectAssetPriceRange(currentPrice, row.predicted_return_pct, row.predicted_return_pct, row.predicted_return_pct);
    return {
      model, horizonHours, asset, historyPoints, sufficiency, isPointForecastOnly: true,
      targetTs: row.target_ts, predictionTs: row.ts,
      funnel: { currentValue: currentPrice, p25Value: range.p25, medianValue: range.median, p75Value: range.p75, coverage: { modeledAssets: [asset], flatAssets: [], coveragePct: 1 }, methodologyNote: null },
    };
  }

  if (model === 'knn') {
    const result = await fetchKnnPredictionForAsset(env, asset, horizonHours);
    if (!result) {
      const reason = KNN_TABLES[asset] ? 'No current prediction available for this horizon.' : `k-NN has never been run for ${asset} \u2014 only BTC, ETH, and LINK.`;
      return { model, horizonHours, asset, historyPoints, funnel: null, message: reason };
    }
    const range = projectAssetPriceRange(currentPrice, result.prediction.p25ReturnPct, result.prediction.medianReturnPct, result.prediction.p75ReturnPct);
    const sufficiency = await fetchKnnSufficiency(env, asset);
    return {
      model, horizonHours, asset, historyPoints, sufficiency, detail: result.detail, targetTs: result.detail.targetTs,
      funnel: { currentValue: currentPrice, p25Value: range.p25, medianValue: range.median, p75Value: range.p75, coverage: { modeledAssets: [asset], flatAssets: [], coveragePct: 1 }, methodologyNote: null },
    };
  }

  return { model, horizonHours, asset, historyPoints, funnel: null, message: `Unknown model "${model}".` };
}

export { getPortfolioHistory as getFunnelHistoryPoints };
