// worker/portfolio.js
//
// I/O layer for the portfolio feature. Pure calculation lives in
// engine/portfolio.js; this file only touches D1 and the market data source.

import { TRACKED_ASSETS, computeHoldings, computePortfolioSummary, dedupeTransactions } from '../engine/portfolio.js';
import { fetchCandles } from './data-source.js';

/**
 * Current prices for all 5 tracked portfolio assets. BTC/ETH/LINK reuse the
 * price the signal engine already computed this cycle (technical_indicators)
 * rather than re-fetching. SOL/HYPE aren't part of the V4 signal engine
 * (spec section 4 scopes that to BTC/ETH/LINK), so they get a small, direct
 * Hyperliquid fetch here — for portfolio valuation only, not signal generation.
 */
export async function getCurrentPrices(env) {
  const prices = {};

  const { results } = await env.DB.prepare(
    `SELECT ti.asset_id, ti.price FROM technical_indicators ti
     INNER JOIN (SELECT asset_id, MAX(ts) AS max_ts FROM technical_indicators GROUP BY asset_id) latest
       ON ti.asset_id = latest.asset_id AND ti.ts = latest.max_ts`,
  ).all();
  for (const row of results) prices[row.asset_id] = row.price;

  for (const asset of TRACKED_ASSETS) {
    if (prices[asset] != null) continue;
    try {
      const candles = await fetchCandles(asset, '1h', 3 * 3_600_000);
      if (candles.length) prices[asset] = candles[candles.length - 1].close;
    } catch {
      prices[asset] = null; // unavailable stays unavailable — never guessed
    }
  }

  for (const asset of TRACKED_ASSETS) if (!(asset in prices)) prices[asset] = null;
  return prices;
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

/** Computes the current summary from stored transactions + live prices, and persists a snapshot. */
export async function computeAndStoreSnapshot(env, now = Date.now()) {
  const transactions = await getAllTransactions(env.DB);
  const holdings = computeHoldings(transactions);
  const prices = await getCurrentPrices(env);
  const summary = computePortfolioSummary(holdings, prices);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO portfolio_snapshots (id, ts, total_value_usd, invested_capital_usd, unrealized_pnl_usd, unrealized_pnl_pct, prices_complete)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(String(now), now, summary.totalValue, summary.investedCapital, summary.unrealizedPnl, summary.unrealizedPnlPct, summary.pricesComplete ? 1 : 0).run();

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
  return { transactions: txRange, snapshots: snapRange, bySource };
}
