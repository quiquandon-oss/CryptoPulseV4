// worker/ingest.js
//
// One full evaluation cycle: fetch candles -> indicators -> regime -> evidence ->
// signal -> persist -> resolve due outcomes -> refresh performance -> AI explanation.
//
// NOTE on CPU budget: Workers Free gives ~10ms CPU per HTTP-triggered invocation.
// Computing 8 indicators + regime + signal for 3 assets is real work; if this
// invocation starts hitting exceededCpu (same failure mode already seen on
// PulseWorkerV2), the fix is either (a) split into one HTTP call per asset,
// invoked 3x by the GitHub Actions workflow instead of once, or (b) Workers Paid.
// Don't guess — check Workers Logs for outcome=exceededCpu first.

import { computeIndicatorSnapshot, bollingerBands } from '../engine/indicators.js';
import { evaluateIndicators, computeAgreement } from '../engine/evidence.js';
import { classifyRegime } from '../engine/regime.js';
import { buildSignal } from '../engine/signal.js';
import { buildPendingOutcomes, resolveOutcome, OUTCOME_STATUS } from '../engine/outcomes.js';
import { computePerformance } from '../engine/performance.js';
import { classifyFreshness } from '../engine/freshness.js';
import { explainSignal } from '../engine/explain.js';
import { fetchAllCandles } from './data-source.js';
import * as db from './db.js';

const INTERVAL = '1h';
const LOOKBACK_MS = 60 * 24 * 3_600_000; // 60 days of hourly candles — covers Ichimoku's 52-period span

export async function runIngestCycle(env, now = Date.now()) {
  const assets = await db.listAssets(env.DB);
  const candleResults = await fetchAllCandles(assets, INTERVAL, LOOKBACK_MS);
  const summary = { ts: now, assets: {} };

  for (const asset of assets) {
    const result = candleResults[asset.id];

    if (!result.ok) {
      await db.upsertHealth(env.DB, `market_data_${asset.id}`, 'market_data', 'UNAVAILABLE', result.error, null);
      summary.assets[asset.id] = { ok: false, error: result.error };
      continue;
    }

    const candles = result.candles;
    await db.insertObservations(env.DB, asset.id, candles, 'hyperliquid');

    const lastCandleTs = candles[candles.length - 1].ts;
    const freshness = classifyFreshness(lastCandleTs, now);
    await db.upsertHealth(env.DB, `market_data_${asset.id}`, `market_data_${asset.id}`, freshness.state, `age ${Math.round(freshness.ageMs / 60000)}m`, new Date(lastCandleTs).toISOString());

    const snapshot = computeIndicatorSnapshot(candles);
    await db.insertIndicatorSnapshot(env.DB, asset.id, lastCandleTs, snapshot);

    const bands = bollingerBands(candles);
    const regimeResult = classifyRegime(snapshot, bands);
    await db.insertRegime(env.DB, asset.id, lastCandleTs, regimeResult);

    const indicatorFacts = evaluateIndicators(snapshot);
    const agreement = computeAgreement(indicatorFacts);
    const priorDirections = await db.getRecentSignalDirections(env.DB, asset.id, 5);
    const signal = buildSignal({ agreement, regime: regimeResult.regime, priorDirections });

    const signalId = await db.insertSignal(env.DB, asset.id, lastCandleTs, signal, indicatorFacts);

    const pendingOutcomes = buildPendingOutcomes({
      signalId, assetId: asset.id, signalTs: lastCandleTs, entryPrice: snapshot.price, direction: signal.direction,
    });
    await db.insertPendingOutcomes(env.DB, pendingOutcomes);

    if (env.GEMINI_API_KEY) {
      const explanation = await explainSignal(
        { asset: asset.id, price: snapshot.price, indicators: indicatorFacts, regime: regimeResult, signal },
        env.GEMINI_API_KEY,
      );
      await db.insertAIExplanation(env.DB, signalId, explanation);
    }

    summary.assets[asset.id] = { ok: true, signal: signal.direction, score: signal.score, regime: regimeResult.regime };
  }

  await resolveDueOutcomes(env, now);
  await refreshPerformanceMetrics(env);
  await db.upsertHealth(env.DB, 'database', 'database', 'OK', null, new Date(now).toISOString());

  return summary;
}

export async function resolveDueOutcomes(env, now = Date.now()) {
  const pending = await db.getPendingOutcomes(env.DB, now);
  let resolved = 0;

  // Group by asset to avoid re-querying observations per outcome.
  const byAsset = new Map();
  for (const outcome of pending) {
    if (!byAsset.has(outcome.asset_id)) byAsset.set(outcome.asset_id, []);
    byAsset.get(outcome.asset_id).push(outcome);
  }

  for (const [assetId, outcomes] of byAsset) {
    const earliestTarget = Math.min(...outcomes.map((o) => o.target_ts));
    const observations = await db.getRecentObservations(env.DB, assetId, earliestTarget - 2 * 3_600_000);

    for (const outcome of outcomes) {
      const resolution = resolveOutcome(
        { targetTs: outcome.target_ts, entryPrice: outcome.entry_price, direction: outcome.direction },
        observations,
        now,
      );
      if (resolution.status !== OUTCOME_STATUS.GENERATED) {
        await db.updateOutcome(env.DB, outcome.id, resolution);
        if (resolution.status === OUTCOME_STATUS.RESOLVED) resolved++;
      }
    }
  }

  return { checked: pending.length, resolved };
}

export async function refreshPerformanceMetrics(env) {
  const assets = await db.listAssets(env.DB);
  for (const asset of assets) {
    for (const horizon of ['12h', '24h']) {
      const outcomes = await db.getResolvedOutcomes(env.DB, { assetId: asset.id, horizon });
      const perf = computePerformance(outcomes.map((o) => ({ actualReturn: o.actual_return, success: o.success === null ? null : !!o.success })));
      await db.upsertPerformanceMetric(env.DB, {
        id: `${asset.id}_${horizon}_ALL`, assetId: asset.id, horizon, regime: null,
        samples: perf.samples, status: perf.status,
        winRate: perf.winRate, avgReturn: perf.avgReturn, medianReturn: perf.medianReturn,
        bestReturn: perf.bestReturn, worstReturn: perf.worstReturn,
      });
    }
  }
}
