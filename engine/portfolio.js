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

// Maximum time distance allowed between a portfolio snapshot and a benchmark observation
export const MAX_BENCHMARK_TIME_DELTA_MS = 2 * 3600 * 1000; // 2 hours

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
  return Number.isFinite(val) && eurUsdRate != null ? val * eurUsdRate : null;
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

/**
 * Accrued EUR cash-balance interest, ported from V1's frontend (INTEREST_EUR /
 * interestEUR()). This tracks interest on a EUR cash balance sitting in
 * Neverless/Revolut — entirely separate from the 5 crypto assets and their
 * transaction ledger. Confirmed against V1's live D1 data: this is exactly
 * the ~$37 gap between V4's crypto-only total and V1's displayed total.
 *
 * The embedded table only has real daily values through 2026-06-26; V1's own
 * code extrapolates linearly beyond that using the last 5 known days' daily
 * increment, rather than re-deriving the rate. Ported faithfully, including
 * that same staleness — this is an estimate past June 26, not a live figure,
 * in V1 just as much as here.
 */
export const INTEREST_EUR_TABLE = {
  '2026-04-11': 0.0, '2026-04-12': 0.2062, '2026-04-13': 0.4124, '2026-04-14': 0.6186, '2026-04-15': 0.8247,
  '2026-04-16': 1.0309, '2026-04-17': 1.2371, '2026-04-18': 1.4433, '2026-04-19': 1.6495, '2026-04-20': 1.8557,
  '2026-04-21': 2.0618, '2026-04-22': 2.268, '2026-04-23': 2.4742, '2026-04-24': 2.6804, '2026-04-25': 2.8866,
  '2026-04-26': 3.0928, '2026-04-27': 3.2989, '2026-04-28': 3.5051, '2026-04-29': 3.7113, '2026-04-30': 3.9175,
  '2026-05-01': 4.1237, '2026-05-02': 4.3299, '2026-05-03': 4.5361, '2026-05-04': 4.7422, '2026-05-05': 4.9484,
  '2026-05-06': 5.1546, '2026-05-07': 5.3608, '2026-05-08': 5.567, '2026-05-09': 5.7732, '2026-05-10': 5.9793,
  '2026-05-11': 6.1855, '2026-05-12': 6.3917, '2026-05-13': 6.5979, '2026-05-14': 6.8041, '2026-05-15': 7.0103,
  '2026-05-16': 7.2164, '2026-05-17': 7.4226, '2026-05-18': 7.6288, '2026-05-19': 7.835, '2026-05-20': 8.0412,
  '2026-05-21': 8.2474, '2026-05-22': 8.4536, '2026-05-23': 8.6597, '2026-05-24': 8.8659, '2026-05-25': 9.0721,
  '2026-05-26': 9.2783, '2026-05-27': 9.4845, '2026-05-28': 9.6907, '2026-05-29': 9.8968, '2026-05-30': 10.103,
  '2026-05-31': 10.3092, '2026-06-01': 10.5154, '2026-06-02': 10.7216, '2026-06-03': 10.9278, '2026-06-04': 11.1339,
  '2026-06-05': 11.3401, '2026-06-06': 11.5463, '2026-06-07': 11.7525, '2026-06-08': 11.9587, '2026-06-09': 12.1649,
  '2026-06-10': 12.3711, '2026-06-11': 12.5772, '2026-06-12': 12.7834, '2026-06-13': 12.9896, '2026-06-14': 13.1958,
  '2026-06-15': 13.402, '2026-06-16': 13.6082, '2026-06-17': 13.8143, '2026-06-18': 14.0205, '2026-06-19': 14.2267,
  '2026-06-20': 14.4329, '2026-06-21': 14.6391, '2026-06-22': 14.8453, '2026-06-23': 15.0514, '2026-06-24': 15.2576,
  '2026-06-25': 15.4638, '2026-06-26': 15.67,
};

/** @param dateStr 'YYYY-MM-DD'. Exact port of V1's interestEUR(d). */
export function computeAccruedInterestEur(dateStr) {
  const ks = Object.keys(INTEREST_EUR_TABLE).sort();
  let v = 0;
  for (const k of ks) { if (k <= dateStr) v = INTEREST_EUR_TABLE[k]; else break; }
  const last = ks[ks.length - 1];
  if (dateStr > last) {
    const n = ks.length;
    const span = Math.min(5, n - 1);
    const inc = span > 0 ? (INTEREST_EUR_TABLE[ks[n - 1]] - INTEREST_EUR_TABLE[ks[n - 1 - span]]) / span : 0;
    const nd = Math.max(0, Math.round((new Date(dateStr) - new Date(last)) / 86_400_000));
    v = INTEREST_EUR_TABLE[last] + inc * nd;
  }
  return v;
}

export function computePortfolioSummary(holdings, currentPrices, cashInterest = null) {
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

  // Interest is real value but has no "cost" — it wasn't bought, so it flows
  // straight into total value and P&L without touching invested capital,
  // exactly matching V1's totals(): val+intr, cost unchanged.
  const interestUsd = cashInterest?.usd ?? 0;
  const totalValueWithInterest = totalValue + interestUsd;

  const unrealizedPnl = allPricesKnown ? totalValueWithInterest - investedCapital : null;
  const unrealizedPnlPct = unrealizedPnl != null && investedCapital > 0 ? unrealizedPnl / investedCapital : null;
  const scored = byAsset.filter((r) => r.pnlPct != null);
  const best = scored.length ? scored.reduce((a, b) => (b.pnlPct > a.pnlPct ? b : a)) : null;
  const worst = scored.length ? scored.reduce((a, b) => (b.pnlPct < a.pnlPct ? b : a)) : null;

  return {
    totalValue: allPricesKnown ? totalValueWithInterest : null,
    cryptoValue: allPricesKnown ? totalValue : null,
    cashInterestUsd: interestUsd,
    cashInterestEur: cashInterest?.eur ?? 0,
    eurUsdFx: cashInterest?.fx ?? null,
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
 * Strictly enforces MAX_BENCHMARK_TIME_DELTA_MS timestamp matching tolerance.
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

  const startTs = validPort[0].ts;

  // Find benchmark price at startTs within MAX_BENCHMARK_TIME_DELTA_MS
  const btcSortedForStart = [...validBtc].sort((a, b) => Math.abs(a.ts - startTs) - Math.abs(b.ts - startTs));
  const nearestStartBtc = btcSortedForStart[0];

  if (!nearestStartBtc || Math.abs(nearestStartBtc.ts - startTs) > MAX_BENCHMARK_TIME_DELTA_MS) {
    return {
      status: 'INSUFFICIENT_DATA',
      message: 'No benchmark observation exists within acceptable time tolerance of portfolio start date.',
      points: [],
    };
  }

  const basePort = validPort[0].total_value_usd;
  const baseBtc = nearestStartBtc.close;

  const points = validPort.map((p) => {
    // Find matching benchmark point within MAX_BENCHMARK_TIME_DELTA_MS tolerance
    const candidates = validBtc
      .map((b) => ({ ...b, delta: Math.abs(b.ts - p.ts) }))
      .filter((b) => b.delta <= MAX_BENCHMARK_TIME_DELTA_MS)
      .sort((a, b) => a.delta - b.delta);

    const matchBtc = candidates[0] ?? null;
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
