// worker/db.js
//
// Thin, explicit D1 helpers. No ORM — every query is visible and auditable,
// matching the project's existing convention (see docs/ARCHITECTURE.md).

export async function listAssets(db) {
  const { results } = await db.prepare('SELECT * FROM assets WHERE active = 1').all();
  return results;
}

export async function insertObservations(db, assetId, candles, source) {
  if (!candles.length) return;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO market_observations (id, asset_id, ts, open, high, low, close, volume, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const batch = candles.map((c) =>
    stmt.bind(`${assetId}_${c.ts}`, assetId, c.ts, c.open, c.high, c.low, c.close, c.volume, source));
  await db.batch(batch);
}

export async function getRecentObservations(db, assetId, sinceTs) {
  const { results } = await db
    .prepare('SELECT ts, close FROM market_observations WHERE asset_id = ? AND ts >= ? ORDER BY ts ASC')
    .bind(assetId, sinceTs)
    .all();
  return results;
}

export async function insertIndicatorSnapshot(db, assetId, ts, snapshot) {
  await db.prepare(
    `INSERT OR REPLACE INTO technical_indicators
      (id, asset_id, ts, price, sma20, sma50, ema12, ema26, rsi14, macd, macd_signal,
       bollinger_upper, bollinger_lower, atr14, ichimoku_tenkan, ichimoku_kijun,
       ichimoku_span_a, ichimoku_span_b, momentum10, volatility20)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    `${assetId}_${ts}`, assetId, ts, snapshot.price, snapshot.sma20, snapshot.sma50,
    snapshot.ema12, snapshot.ema26, snapshot.rsi14, snapshot.macd, snapshot.macdSignal,
    snapshot.bollingerUpper, snapshot.bollingerLower, snapshot.atr14,
    snapshot.ichimokuTenkan, snapshot.ichimokuKijun, snapshot.ichimokuSpanA, snapshot.ichimokuSpanB,
    snapshot.momentum10, snapshot.volatility20,
  ).run();
}

export async function insertRegime(db, assetId, ts, regimeResult) {
  await db.prepare(
    `INSERT OR REPLACE INTO market_regimes (id, asset_id, ts, regime, basis) VALUES (?,?,?,?,?)`,
  ).bind(`${assetId}_${ts}`, assetId, ts, regimeResult.regime, regimeResult.basis).run();
}

export async function insertSignal(db, assetId, ts, signal, indicatorFacts) {
  const id = `${assetId}_${ts}`;
  await db.prepare(
    `INSERT OR REPLACE INTO signals
      (id, asset_id, ts, direction, score, evidence_bullish, evidence_bearish, evidence_applicable,
       agreement_ratio, evidence_label, regime, risk, persistence_count, stability)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, assetId, ts, signal.direction, signal.score, signal.evidenceBullish, signal.evidenceBearish,
    signal.evidenceApplicable, signal.agreementRatio, signal.evidenceLabel, signal.regime, signal.risk,
    signal.persistenceCount, signal.stability,
  ).run();

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO signal_indicators (signal_id, indicator, value, state, direction, applicable, interpretation)
     VALUES (?,?,?,?,?,?,?)`,
  );
  await db.batch(indicatorFacts.map((f) =>
    stmt.bind(id, f.indicator, f.value, f.state, f.direction, f.applicable ? 1 : 0, f.interpretation)));

  return id;
}

export async function getLastSignal(db, assetId) {
  const row = await db
    .prepare('SELECT * FROM signals WHERE asset_id = ? ORDER BY ts DESC LIMIT 1')
    .bind(assetId)
    .first();
  return row ?? null;
}

export async function getRecentSignalDirections(db, assetId, limit = 5) {
  const { results } = await db
    .prepare('SELECT direction FROM signals WHERE asset_id = ? ORDER BY ts DESC LIMIT ?')
    .bind(assetId, limit)
    .all();
  return results.map((r) => r.direction);
}

export async function insertPendingOutcomes(db, rows) {
  if (!rows.length) return;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO signal_outcomes (id, signal_id, asset_id, horizon, target_ts, entry_price, direction, status)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  await db.batch(rows.map((r) =>
    stmt.bind(r.id, r.signalId, r.assetId, r.horizon, r.targetTs, r.entryPrice, r.direction, r.status)));
}

export async function getPendingOutcomes(db, beforeOrEqualTs) {
  const { results } = await db
    .prepare(`SELECT * FROM signal_outcomes WHERE status IN ('GENERATED','UNRESOLVED') AND target_ts <= ?`)
    .bind(beforeOrEqualTs)
    .all();
  return results;
}

export async function updateOutcome(db, id, resolution) {
  await db.prepare(
    `UPDATE signal_outcomes SET status = ?, future_price = ?, actual_return = ?, success = ?, resolved_at = datetime('now')
     WHERE id = ?`,
  ).bind(
    resolution.status, resolution.futurePrice, resolution.actualReturn,
    resolution.success === null ? null : (resolution.success ? 1 : 0), id,
  ).run();
}

export async function getResolvedOutcomes(db, filters = {}) {
  const clauses = [`status = 'RESOLVED'`];
  const params = [];
  if (filters.assetId) { clauses.push('asset_id = ?'); params.push(filters.assetId); }
  if (filters.horizon) { clauses.push('horizon = ?'); params.push(filters.horizon); }
  const { results } = await db
    .prepare(`SELECT * FROM signal_outcomes WHERE ${clauses.join(' AND ')} ORDER BY target_ts DESC`)
    .bind(...params)
    .all();
  return results;
}

export async function upsertPerformanceMetric(db, row) {
  await db.prepare(
    `INSERT OR REPLACE INTO performance_metrics (id, asset_id, horizon, regime, samples, status, win_rate, avg_return, median_return, best_return, worst_return)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    row.id, row.assetId, row.horizon, row.regime, row.samples, row.status,
    row.winRate ?? null, row.avgReturn ?? null, row.medianReturn ?? null, row.bestReturn ?? null, row.worstReturn ?? null,
  ).run();
}

export async function getPerformanceMetrics(db, assetId) {
  const { results } = await db
    .prepare('SELECT * FROM performance_metrics WHERE asset_id = ? OR asset_id IS NULL ORDER BY horizon')
    .bind(assetId)
    .all();
  return results;
}

export async function upsertHealth(db, id, component, status, detail, lastSuccessAt) {
  await db.prepare(
    `INSERT OR REPLACE INTO system_health (id, component, status, detail, last_success_at, updated_at)
     VALUES (?,?,?,?,?, datetime('now'))`,
  ).bind(id, component, status, detail, lastSuccessAt).run();
}

export async function getAllHealth(db) {
  const { results } = await db.prepare('SELECT * FROM system_health').all();
  return results;
}

export async function insertAIExplanation(db, signalId, explanation) {
  await db.prepare(
    `INSERT OR REPLACE INTO ai_explanations (id, signal_id, supports, contradicts, risks, invalidation, model, ai_error)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(
    signalId, signalId,
    JSON.stringify(explanation.supports ?? []), JSON.stringify(explanation.contradicts ?? []),
    JSON.stringify(explanation.risks ?? []), explanation.invalidation ?? null,
    explanation.model, explanation.aiError ?? null,
  ).run();
}
