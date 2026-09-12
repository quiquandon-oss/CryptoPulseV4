// engine/portfolio.js
//
// Pure functions only — no I/O, no fetch, no D1. Parsing and calculation are
// kept separate and testable, per spec section 27 ("Testing: Portfolio
// calculations", "Transactions"). The Worker layer (worker/portfolio.js)
// handles persistence; the frontend handles file reading.
//
// Scope is deliberately fixed to the 5 assets V1 already tracks — confirmed
// explicitly rather than assumed. Anything else in an uploaded statement
// (other altcoins, stablecoin conversions, fiat deposits) is ignored for
// portfolio purposes, not silently included.

export const TRACKED_ASSETS = Object.freeze(['BTC', 'ETH', 'SOL', 'LINK', 'HYPE']);

/**
 * Parses rows from a Neverless-style CSV export.
 */
export function parseNeverlessCSV(rows) {
  const tracked = new Set(TRACKED_ASSETS);
  const out = [];

  for (const row of rows) {
    if (row['Type'] !== 'Trade') continue;
    const ts = Date.parse(row['Date']);
    if (Number.isNaN(ts)) continue;

    const assetReceived = row['Asset received'];
    const assetSent = row['Asset sent'];

    if (tracked.has(assetReceived)) {
      const qty = parseFloat(row['Amount received']);
      const priceUsd = parseFloat(row['USD price of asset received']);
      if (qty > 0 && Number.isFinite(priceUsd)) {
        out.push({
          sourceId: `nvl_${row['ID']}`, asset: assetReceived, account: 'Neverless',
          type: 'BUY', quantity: qty, unitPriceUsd: priceUsd, timestamp: ts, source: 'CSV_NEVERLESS',
        });
      }
    } else if (tracked.has(assetSent)) {
      const qty = parseFloat(row['Amount sent']);
      const priceUsd = parseFloat(row['USD price of asset sent']);
      if (qty > 0 && Number.isFinite(priceUsd)) {
        out.push({
          sourceId: `nvl_${row['ID']}`, asset: assetSent, account: 'Neverless',
          type: 'SELL', quantity: qty, unitPriceUsd: priceUsd, timestamp: ts, source: 'CSV_NEVERLESS',
        });
      }
    }
  }

  return out;
}

function parseMoneyString(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  return cleaned === '' || cleaned === '-' ? NaN : parseFloat(cleaned);
}

function parseFlexibleDate(raw) {
  if (raw instanceof Date) return raw.getTime();
  const cleaned = String(raw).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  return Date.parse(cleaned);
}

function classifyRevolutType(rawType) {
  const t = String(rawType || '').toUpperCase();
  if (t.startsWith('BUY')) return 'BUY';
  if (t.startsWith('SELL')) return 'SELL';
  if (t === 'STAKING REWARD') return 'TRANSFER_IN';
  return null;
}

function parseRevolutMoneyToUsd(raw, eurUsdRate) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (str === '') return null;
  if (str.startsWith('$')) {
    const val = parseMoneyString(str);
    return Number.isFinite(val) ? val : null;
  }
  if (/[A-Z]{3}$/.test(str)) {
    return null;
  }
  const val = parseMoneyString(str);
  return Number.isFinite(val) ? val * eurUsdRate : null;
}

export function parseRevolutRows(rows, eurUsdRate) {
  const tracked = new Set(TRACKED_ASSETS);
  const out = [];

  rows.forEach((row) => {
    const asset = row['Symbol'];
    if (!tracked.has(asset)) return;
    const type = classifyRevolutType(row['Type']);
    if (!type) return;

    const qty = parseMoneyString(row['Quantity']);
    const ts = parseFlexibleDate(row['Date']);
    if (!(qty > 0) || Number.isNaN(ts)) return;

    const priceUsd = type === 'TRANSFER_IN' ? (parseRevolutMoneyToUsd(row['Price'], eurUsdRate) ?? 0) : parseRevolutMoneyToUsd(row['Price'], eurUsdRate);
    if (type !== 'TRANSFER_IN' && !Number.isFinite(priceUsd)) return;

    out.push({
      sourceId: `rev_${asset}_${ts}_${qty}_${priceUsd}`,
      asset, account: 'Revolut',
      type,
      quantity: qty,
      unitPriceUsd: priceUsd,
      timestamp: ts,
      source: 'REVOLUT',
      priceApproximation: type === 'TRANSFER_IN'
        ? 'Staking reward — Revolut does not report a price for these, so cost basis is $0, not an estimated fair-market-value'
        : 'Non-USD amounts converted using a single supplied EUR->USD rate, not historical FX at time of purchase',
    });
  });

  return out;
}

export function parseV1Export(txs) {
  const tracked = new Set(TRACKED_ASSETS);
  const out = [];

  for (const t of txs) {
    if (!tracked.has(t.asset)) continue;
    if (t.type !== 'buy') continue;
    const ts = Date.parse(t.date);
    const qty = Number(t.qty);
    if (Number.isNaN(ts) || !(qty > 0)) continue;

    const isReward = !!t.isReward;
    const unitPriceUsd = isReward ? 0 : Number(t.usd);
    if (!isReward && !Number.isFinite(unitPriceUsd)) continue;

    out.push({
      sourceId: `v1_${t.id}`,
      asset: t.asset,
      account: t.acct,
      type: isReward ? 'TRANSFER_IN' : 'BUY',
      quantity: qty,
      unitPriceUsd,
      timestamp: ts,
      source: 'V1_EXPORT',
      priceApproximation: isReward ? 'Reward — V1 does not report a price for these, cost basis is $0, not a fabricated fair-market-value' : null,
    });
  }

  return out;
}

export function computeHoldings(transactions) {
  const holdings = {};
  const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

  for (const tx of sorted) {
    if (!holdings[tx.asset]) holdings[tx.asset] = { quantity: 0, investedCost: 0 };
    const h = holdings[tx.asset];

    if (tx.type === 'BUY' || tx.type === 'TRANSFER_IN') {
      h.quantity += tx.quantity;
      h.investedCost += tx.quantity * (tx.unitPriceUsd || 0);
    } else if (tx.type === 'SELL' || tx.type === 'TRANSFER_OUT') {
      const avgCost = h.quantity > 0 ? h.investedCost / h.quantity : 0;
      const qty = Math.min(tx.quantity, h.quantity);
      h.investedCost -= qty * avgCost;
      h.quantity -= qty;
    }
  }

  return holdings;
}

export function computePortfolioSummary(holdings, currentPrices) {
  const assets = Object.keys(holdings).filter((a) => holdings[a].quantity > 1e-12);
  let totalValue = 0;
  let investedCapital = 0;
  let allPricesKnown = true;
  const byAsset = [];

  for (const asset of assets) {
    const h = holdings[asset];
    const price = currentPrices[asset] ?? null;
    if (price == null) allPricesKnown = false;
    const value = price != null ? h.quantity * price : null;
    const avgCost = h.quantity > 0 ? h.investedCost / h.quantity : null;
    const pnl = value != null ? value - h.investedCost : null;
    const pnlPct = value != null && h.investedCost > 0 ? pnl / h.investedCost : null;

    if (value != null) totalValue += value;
    investedCapital += h.investedCost;

    byAsset.push({ asset, quantity: h.quantity, avgCost, currentPrice: price, value, investedCost: h.investedCost, pnl, pnlPct, allocationPct: null });
  }

  for (const row of byAsset) {
    row.allocationPct = row.value != null && totalValue > 0 ? row.value / totalValue : null;
  }

  const unrealizedPnl = allPricesKnown ? totalValue - investedCapital : null;
  const unrealizedPnlPct = unrealizedPnl != null && investedCapital > 0 ? unrealizedPnl / investedCapital : null;
  const scored = byAsset.filter((r) => r.pnlPct != null);
  const best = scored.length ? scored.reduce((a, b) => (b.pnlPct > a.pnlPct ? b : a)) : null;
  const worst = scored.length ? scored.reduce((a, b) => (b.pnlPct < a.pnlPct ? b : a)) : null;

  return {
    totalValue: allPricesKnown ? totalValue : null,
    investedCapital,
    unrealizedPnl,
    unrealizedPnlPct,
    byAsset,
    bestPerformer: best?.asset ?? null,
    worstPerformer: worst?.asset ?? null,
    pricesComplete: allPricesKnown,
  };
}

export function dedupeTransactions(transactions) {
  const seen = new Set();
  const out = [];
  for (const tx of transactions) {
    if (seen.has(tx.sourceId)) continue;
    seen.add(tx.sourceId);
    out.push(tx);
  }
  return out;
}

/**
 * Computes a normalized benchmark comparison (Base = 100) between portfolio snapshots
 * and a benchmark asset (e.g. BTC) over their overlapping verified time range.
 *
 * @param {Array<Object>} portfolioPoints Array of [{ ts, total_value_usd }]
 * @param {Array<Object>} benchmarkPoints Array of [{ ts, close }] (e.g. BTC candles)
 * @returns {Object} Normalized benchmark series and metadata.
 */
export function computeNormalizedBenchmark(portfolioPoints, benchmarkPoints) {
  const validPort = portfolioPoints.filter((p) => p.total_value_usd != null && p.total_value_usd > 0);
  const validBtc = benchmarkPoints.filter((b) => b.close != null && b.close > 0);

  if (!validPort.length || !validBtc.length) {
    return {
      status: 'INSUFFICIENT_DATA',
      message: 'No overlapping verified portfolio and benchmark data available.',
      points: [],
    };
  }

  const basePort = validPort[0].total_value_usd;
  const startTs = validPort[0].ts;

  // Find benchmark price at or nearest to startTs
  const btcSorted = [...validBtc].sort((a, b) => Math.abs(a.ts - startTs) - Math.abs(b.ts - startTs));
  const baseBtc = btcSorted[0].close;

  const points = validPort.map((p) => {
    // find matching btc point near p.ts
    const matchBtc = [...validBtc].sort((a, b) => Math.abs(a.ts - p.ts) - Math.abs(b.ts - p.ts))[0];
    const portNorm = (p.total_value_usd / basePort) * 100;
    const btcNorm = matchBtc ? (matchBtc.close / baseBtc) * 100 : null;
    return {
      ts: p.ts,
      portfolioNormalized: Number(portNorm.toFixed(2)),
      btcNormalized: btcNorm != null ? Number(btcNorm.toFixed(2)) : null,
      portfolioValue: p.total_value_usd,
      btcPrice: matchBtc?.close ?? null,
    };
  });

  return {
    status: 'OK',
    baseTimestamp: startTs,
    points,
  };
}

/**
 * Computes portfolio intelligence / informational insights based on holdings & allocation.
 * Purely analytical observation — NO automated trading or financial execution.
 *
 * @param {Object} summary Result from computePortfolioSummary
 * @returns {Array<Object>} Array of insight objects [{ type, level, title, description }]
 */
export function computePortfolioInsights(summary) {
  const insights = [];
  if (!summary || !summary.byAsset || !summary.byAsset.length) {
    return insights;
  }

  // Concentration observation
  const sorted = [...summary.byAsset].sort((a, b) => (b.allocationPct ?? 0) - (a.allocationPct ?? 0));
  const topAsset = sorted[0];
  if (topAsset && topAsset.allocationPct > 0.40) {
    insights.push({
      type: 'CONCENTRATION',
      level: 'INFO',
      title: `High Concentration in ${topAsset.asset}`,
      description: `${topAsset.asset} makes up ${(topAsset.allocationPct * 100).toFixed(1)}% of total portfolio value.`,
    });
  }

  // Diversification observation
  if (summary.byAsset.length >= 3) {
    insights.push({
      type: 'DIVERSIFICATION',
      level: 'INFO',
      title: 'Multi-Asset Exposure',
      description: `Portfolio holds ${summary.byAsset.length} tracked assets across Layer 1 and Infrastructure categories.`,
    });
  }

  // Performance contribution
  if (summary.bestPerformer && summary.worstPerformer) {
    const best = summary.byAsset.find((a) => a.asset === summary.bestPerformer);
    const worst = summary.byAsset.find((a) => a.asset === summary.worstPerformer);
    if (best && worst) {
      insights.push({
        type: 'PERFORMANCE_CONTRIBUTION',
        level: 'INFO',
        title: 'Relative Performance Insight',
        description: `Top performing position is ${best.asset} (${(best.pnlPct * 100).toFixed(1)}%), while ${worst.asset} is at ${(worst.pnlPct * 100).toFixed(1)}%.`,
      });
    }
  }

  return insights;
}
