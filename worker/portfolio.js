// worker/portfolio.js
//
// I/O layer for the portfolio feature. Pure calculation lives in
// engine/portfolio.js; this file only touches D1 and the market data source.

import { TRACKED_ASSETS, computeHoldings, computePortfolioSummary, dedupeTransactions, computeAccruedInterestEur, reconstructHistoricalSnapshots } from '../engine/portfolio.js';
import { fetchCandles, fetchHistoricalEurUsdRate } from './data-source.js';
import { getOrRefreshEurUsdRate } from './fx.js';

export async function getCurrentPrices(env) {
  const prices = {};

  await Promise.all(TRACKED_ASSETS.map(async (asset) => {
    try {
      const candles = await fetchCandles(asset, '1h', 3 * 3_600_000);
      prices[asset] = candles.length ? candles[candles.length - 1].close : null;
    } catch {
      prices[asset] = null;
    }
  }));

  for (const asset of TRACKED_ASSETS) if (!(asset in prices)) prices[asset] = null;
  return prices;
}

/** Ported cash-interest figure (see engine/portfolio.js) converted to USD at a live rate. */
export async function getCashInterest(env, now = Date.now()) {
  const dateStr = new Date(now).toISOString().slice(0, 10);
  const eur = computeAccruedInterestEur(dateStr);
  const { rate: fx } = await getOrRefreshEurUsdRate(env, now);
  return { eur, usd: eur * fx, fx };
}

/**
 * The single place that assembles a portfolio summary: transactions -> holdings
 * -> live prices -> live cash interest -> summary. Used by every route that
 * needs "the current portfolio" instead of each repeating the same 4 calls.
 */
export async function buildPortfolioSummary(env, now = Date.now()) {
  const transactions = await getAllTransactions(env.DB);
  const holdings = computeHoldings(transactions);
  const [prices, cashInterest] = await Promise.all([getCurrentPrices(env), getCashInterest(env, now)]);
  return computePortfolioSummary(holdings, prices, cashInterest);
}

export async function insertTransactions(db, transactions) {
  const deduped = dedupeTransactions(transactions);
  if (!deduped.length) return { inserted: 0, received: transactions.length, newTransactions: [] };

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO portfolio_transactions
      (id, asset_id, account, transaction_type, quantity, unit_price_usd, fees, transaction_timestamp, source, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const batch = deduped.map((tx) => stmt.bind(
    tx.sourceId, tx.asset, tx.account, tx.type, tx.quantity, tx.unitPriceUsd,
    tx.fees ?? 0, tx.timestamp, tx.source, tx.priceApproximation ?? null,
  ));
  const results = await db.batch(batch);
  // D1's batch results are one-to-one with the statements sent, in order —
  // meta.changes on each tells us whether THAT SPECIFIC row was actually
  // inserted (1) or silently ignored as an existing duplicate (0), not just
  // an aggregate count. This is what lets the import UI say exactly which
  // transactions are new, matching V1's "show the result immediately."
  const newTransactions = deduped.filter((_, i) => (results[i]?.meta?.changes ?? 0) > 0);
  const inserted = newTransactions.length;
  return { inserted, received: transactions.length, deduped: deduped.length, newTransactions };
}

export async function getAllTransactions(db) {
  const { results } = await db.prepare('SELECT * FROM portfolio_transactions ORDER BY transaction_timestamp ASC').all();
  return results.map((r) => ({
    sourceId: r.id, asset: r.asset_id, account: r.account, type: r.transaction_type,
    quantity: r.quantity, unitPriceUsd: r.unit_price_usd, fees: r.fees, timestamp: r.transaction_timestamp, source: r.source,
  }));
}

export async function computeAndStoreSnapshot(env, now = Date.now()) {
  const summary = await buildPortfolioSummary(env, now);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO portfolio_snapshots (id, ts, total_value_usd, invested_capital_usd, unrealized_pnl_usd, unrealized_pnl_pct, prices_complete, cash_interest_usd, cash_interest_eur, eur_usd_fx)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    String(now), now, summary.totalValue, summary.investedCapital, summary.unrealizedPnl, summary.unrealizedPnlPct,
    summary.pricesComplete ? 1 : 0, summary.cashInterestUsd, summary.cashInterestEur, summary.eurUsdFx,
  ).run();

  if (summary.byAsset.length) {
    const stmt = env.DB.prepare(
      `INSERT OR REPLACE INTO portfolio_asset_snapshots (id, ts, asset_id, quantity, price_usd, value_usd, invested_value_usd, unrealized_pnl_usd, allocation_pct)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    await env.DB.batch(summary.byAsset.map((row) =>
      stmt.bind(`${row.asset}_${now}`, now, row.asset, row.quantity, row.currentPrice, row.value, row.investedCost, row.pnl, row.allocationPct)));
  }

  return summary;
}

/**
 * One-time (idempotent — safe to re-run) reconstruction of the equity curve
 * from the earliest transaction up to yesterday. "Today" is deliberately
 * excluded: the live ingest/portfolio path already covers it with a genuinely
 * live intraday price, and re-deriving it here from a daily close would be a
 * downgrade, not an improvement.
 *
 * Historical FX is fetched once per calendar month in range (not once per
 * day) to keep this to a handful of requests rather than ~150.
 */
export async function backfillHistoricalSnapshots(env, now = Date.now()) {
  const transactions = await getAllTransactions(env.DB);
  if (!transactions.length) return { backfilled: 0, message: 'No transactions to backfill from.' };

  const earliestTs = Math.min(...transactions.map((t) => t.timestamp));
  const startDate = new Date(earliestTs); startDate.setUTCHours(0, 0, 0, 0);
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);

  const dates = [];
  for (const d = new Date(startDate); d < today; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  if (!dates.length) return { backfilled: 0, message: 'Nothing to backfill — earliest transaction is today or later.' };

  const lookbackMs = (now - earliestTs) + 2 * 86_400_000;
  const dailyPricesByAssetDate = {};
  const priceFetchIssues = [];
  for (const asset of TRACKED_ASSETS) {
    dailyPricesByAssetDate[asset] = {};
    try {
      const candles = await fetchCandles(asset, '1d', lookbackMs);
      for (const c of candles) dailyPricesByAssetDate[asset][new Date(c.ts).toISOString().slice(0, 10)] = c.close;
    } catch (err) {
      priceFetchIssues.push(`${asset}: ${err}`);
    }
  }

  const fxByMonth = {};
  for (const dateStr of dates) {
    const monthKey = dateStr.slice(0, 7);
    if (!(monthKey in fxByMonth)) {
      fxByMonth[monthKey] = await fetchHistoricalEurUsdRate(`${monthKey}-01`);
    }
  }
  const interestForDate = (dateStr) => {
    const eur = computeAccruedInterestEur(dateStr);
    const fx = fxByMonth[dateStr.slice(0, 7)];
    return { eur, usd: eur * fx, fx };
  };

  const snapshots = reconstructHistoricalSnapshots(transactions, dailyPricesByAssetDate, dates, interestForDate);

  const snapStmt = env.DB.prepare(
    `INSERT OR IGNORE INTO portfolio_snapshots (id, ts, total_value_usd, invested_capital_usd, unrealized_pnl_usd, unrealized_pnl_pct, prices_complete, cash_interest_usd, cash_interest_eur, eur_usd_fx, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  await env.DB.batch(snapshots.map((s) =>
    snapStmt.bind(`backfill_${s.dateStr}`, s.ts, s.totalValue, s.investedCapital, s.unrealizedPnl, s.unrealizedPnlPct,
      s.pricesComplete ? 1 : 0, s.cashInterestUsd, s.cashInterestEur, s.eurUsdFx, 'V4_BACKFILL')));

  const assetStmt = env.DB.prepare(
    `INSERT OR IGNORE INTO portfolio_asset_snapshots (id, ts, asset_id, quantity, price_usd, value_usd, invested_value_usd, unrealized_pnl_usd, allocation_pct, source)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const assetBinds = snapshots.flatMap((s) => s.byAsset.map((row) =>
    assetStmt.bind(`backfill_${row.asset}_${s.dateStr}`, s.ts, row.asset, row.quantity, row.currentPrice, row.value, row.investedCost, row.pnl, row.allocationPct, 'V4_BACKFILL')));
  if (assetBinds.length) await env.DB.batch(assetBinds);

  const incompleteDays = snapshots.filter((s) => !s.pricesComplete).length;
  return {
    backfilled: snapshots.length,
    dateRange: [dates[0], dates[dates.length - 1]],
    incompleteDays,
    priceFetchIssues,
  };
}

export async function getPortfolioHistory(db, sinceTs) {
  const { results } = await db
    .prepare('SELECT ts, total_value_usd, invested_capital_usd, unrealized_pnl_usd, unrealized_pnl_pct, prices_complete FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts ASC')
    .bind(sinceTs).all();
  return results;
}

export async function getDataHealth(db) {
  const txRange = await db.prepare('SELECT MIN(transaction_timestamp) as earliest, MAX(transaction_timestamp) as latest, COUNT(*) as n FROM portfolio_transactions').first();
  const snapRange = await db.prepare('SELECT MIN(ts) as earliest, MAX(ts) as latest, COUNT(*) as n FROM portfolio_snapshots').first();
  const { results: bySource } = await db.prepare('SELECT source, COUNT(*) as n, MIN(transaction_timestamp) as earliest, MAX(transaction_timestamp) as latest FROM portfolio_transactions GROUP BY source').all();

  let importLogs = { conflictCount: 0, duplicateCount: 0, insertedCount: 0, receivedCount: 0 };
  try {
    const logSummary = await db.prepare('SELECT SUM(conflict_count) as conflicts, SUM(duplicate_count) as duplicates, SUM(inserted_count) as inserted, SUM(received_count) as received FROM historical_import_logs').first();
    if (logSummary) {
      importLogs = {
        conflictCount: logSummary.conflicts ?? 0,
        duplicateCount: logSummary.duplicates ?? 0,
        insertedCount: logSummary.inserted ?? 0,
        receivedCount: logSummary.received ?? 0,
      };
    }
  } catch {
    // Table may be empty or newly created
  }

  return { transactions: txRange, snapshots: snapRange, bySource, importLogs };
}
