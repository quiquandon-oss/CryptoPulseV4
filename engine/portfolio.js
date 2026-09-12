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
 * Parses rows from a Neverless-style CSV export (the format actually seen:
 * Type, Date, Amount received, Asset received, Amount sent, Asset sent, Fee,
 * Asset of the fee, Description, USD price of asset received, USD price of
 * asset sent, USD price of fee asset, Blockchain address, Blockchain
 * transaction hash, ID). Only "Trade" rows touching a tracked asset produce
 * a transaction; deposits/withdrawals and non-tracked-asset trades (e.g.
 * USDC<->EURC) are skipped, not fabricated into something they aren't.
 *
 * @param rows array of row objects (already CSV-parsed, e.g. via PapaParse with header:true)
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
    // Neither side is a tracked asset (e.g. USDC -> EURC) — intentionally skipped.
  }

  return out;
}

/** Extracts a plain number from a currency-formatted string, robust to corrupted/mangled
 * currency symbols (seen in practice: Revolut's CSV export double-encodes the € sign) and
 * thousands separators. Returns NaN rather than guessing if nothing numeric is present. */
function parseMoneyString(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  return cleaned === '' || cleaned === '-' ? NaN : parseFloat(cleaned);
}

/** Parses a human-readable date string, tolerant of non-ASCII whitespace corruption
 * (seen in practice: a mangled narrow-no-break-space between time and AM/PM). */
function parseFlexibleDate(raw) {
  if (raw instanceof Date) return raw.getTime();
  const cleaned = String(raw).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  return Date.parse(cleaned);
}

/** Classifies a Revolut row's Type into what it actually means for holdings.
 * Real-world exports include variants beyond plain Buy/Sell:
 *   'Buy - Revolut X' -> BUY (a real purchase through a different order venue)
 *   'Staking reward'  -> TRANSFER_IN (a real quantity increase; Revolut leaves
 *                        Price blank for these, so cost basis is $0 rather
 *                        than a fabricated fair-market-value estimate)
 *   'Receive', 'Other' -> in practice only ever seen against fiat (EUR/USD),
 *                        which the tracked-asset filter already excludes
 *   'Stake'            -> excluded: moves an *existing* balance into staking,
 *                        not a new acquisition (confirmed against real data:
 *                        the staked quantity exactly matched the prior BUY
 *                        total for that asset — counting it too would double it)
 */
function classifyRevolutType(rawType) {
  const t = String(rawType || '').toUpperCase();
  if (t.startsWith('BUY')) return 'BUY';
  if (t.startsWith('SELL')) return 'SELL';
  if (t === 'STAKING REWARD') return 'TRANSFER_IN';
  return null;
}

/**
 * Parses rows from a Revolut export — CSV or XLSX, both seen in practice. Handles two
 * distinct real-world shapes for Price/Value/Fees and Date:
 *   - raw numbers / Date objects (some XLSX exports)
 *   - currency-formatted strings with corrupted symbols, and human-readable dates
 *     with corrupted whitespace (the CSV export format actually encountered)
 * `eurUsdRate` is an explicit, injected approximation — see note above on parseNeverlessCSV's
 * design philosophy; this function never assumes a rate itself.
 */
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

    // Staking rewards genuinely have no price in this export — $0 cost basis
    // reflects that honestly rather than fabricating a fair-market-value estimate.
    const priceEur = type === 'TRANSFER_IN' ? (parseMoneyString(row['Price']) || 0) : parseMoneyString(row['Price']);
    if (type !== 'TRANSFER_IN' && !Number.isFinite(priceEur)) return;

    out.push({
      // Content-based, not position-based: stable across re-exports that add/reorder
      // rows, unlike an array-index suffix would be.
      sourceId: `rev_${asset}_${ts}_${qty}_${priceEur}`,
      asset, account: 'Revolut',
      type,
      quantity: qty,
      unitPriceUsd: priceEur * eurUsdRate,
      timestamp: ts,
      source: 'REVOLUT',
      priceApproximation: type === 'TRANSFER_IN'
        ? 'Staking reward — Revolut does not report a price for these, so cost basis is $0, not an estimated fair-market-value'
        : 'EUR->USD converted using a single supplied rate, not historical FX at time of purchase',
    });
  });

  return out;
}

/**
 * Weighted-average-cost position tracking. BUY/TRANSFER_IN increase quantity
 * and invested cost; SELL/TRANSFER_OUT reduce both proportionally at the
 * running average cost. Never lets quantity go negative from a sell larger
 * than the recorded position (caps at what's actually held).
 */
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
 * @param holdings      output of computeHoldings
 * @param currentPrices { BTC: 65000, ETH: 3200, ... } — null/missing means "unavailable", never guessed
 */
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

/** De-duplicates by sourceId — makes repeated uploads of the same file idempotent, per spec section 26. */
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
