// worker/portfolio.js
//
// I/O layer for the portfolio feature. Pure calculation lives in
// engine/portfolio.js; this file only touches D1 and the market data source.

import { TRACKED_ASSETS, computeHoldings, computePortfolioSummary, dedupeTransactions, computeAccruedInterestEur } from '../engine/portfolio.js';
import { fetchCandles, fetchEurUsdRate } from './data-source.js';

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
export async function getCashInterest(now = Date.now()) {
  const dateStr = new Date(now).toISOString().slice(0, 10);
  const eur = computeAccruedInterestEur(dateStr);
  const fx = await fetchEurUsdRate();
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
  const [prices, cashInterest] = await Promise.all([getCurrentPrices(env), getCashInterest(now)]);
  return computePortfolioSummary(holdings, prices, cashInterest);
}

export async function insertTransactions(db, transactions) {
  const deduped = dedupeTransactions(transactions);
  if (!deduped.length) return { inserted: 0, received: transactions.length };

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
  const inserted = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  return { inserted, received: transactions.length, deduped: deduped.length };
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
