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
 * Parses a Revolut Price field into a USD amount, detecting the actual currency
 * rather than assuming EUR for everything. Real exports mix three cases:
 *   - '$7.75'           -> already USD (seen on 'Buy - Revolut X' rows), no conversion
 *   - '\u00e2\u00ac1,908.30' or a plain number -> EUR (mangled \u20ac prefix, or a raw
 *                          number from some XLSX exports), needs eurUsdRate
 *   - '138,920.02 IDR'  -> a currency actually seen in this export with no reliable
 *                          conversion rate available here. Returns null rather than
 *                          fabricating a rate, so the row gets excluded, not corrupted.
 */
function parseRevolutMoneyToUsd(raw, eurUsdRate) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (str === '') return null;
  if (str.startsWith('$')) {
    const val = parseMoneyString(str);
    return Number.isFinite(val) ? val : null;
  }
  if (/[A-Z]{3}$/.test(str)) {
    return null; // e.g. IDR — no reliable conversion rate available, don't guess
  }
  const val = parseMoneyString(str);
  return Number.isFinite(val) ? val * eurUsdRate : null;
}

/**
 * Parses rows from a Revolut export — CSV or XLSX, both seen in practice. Handles
 * currency-formatted strings with corrupted symbols (mangled \u20ac), a genuine mix of
 * USD/EUR/other currencies within the same file (see parseRevolutMoneyToUsd), and
 * human-readable dates with corrupted whitespace (the CSV export format encountered).
 * `eurUsdRate` is an explicit, injected approximation for the EUR rows — never assumed.
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
    const priceUsd = type === 'TRANSFER_IN' ? (parseRevolutMoneyToUsd(row['Price'], eurUsdRate) ?? 0) : parseRevolutMoneyToUsd(row['Price'], eurUsdRate);
    if (type !== 'TRANSFER_IN' && !Number.isFinite(priceUsd)) return;

    out.push({
      // Content-based, not position-based: stable across re-exports that add/reorder
      // rows, unlike an array-index suffix would be.
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

/**
 * Parses V1's own authoritative transaction export (cryptopulse-data.json format:
 * { txs: [{ id, date, asset, acct, type, qty, price, ccy, usd, eur, isReward? }], meta }).
 * This is a better source than reconstructing from raw Neverless/Revolut statements
 * where possible — V1 already resolved per-unit USD pricing (with a real, time-varying
 * EUR->USD rate, not a single approximation) and explicitly flags reward transactions.
 * Confirmed against a real export: all rows are type 'buy'; isReward rows have price 0
 * (V1 doesn't report a value for these — mapped to $0 cost basis, not fabricated).
 */
export function parseV1Export(txs) {
  const tracked = new Set(TRACKED_ASSETS);
  const out = [];

  for (const t of txs) {
    if (!tracked.has(t.asset)) continue;
    if (t.type !== 'buy') continue; // only 'buy' seen in practice; guards against future export changes
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
