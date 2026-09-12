import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNeverlessCSV, parseRevolutRows, parseV1Export, computeHoldings, computePortfolioSummary,
  dedupeTransactions, TRACKED_ASSETS, computeAccruedInterestEur, INTEREST_EUR_TABLE,
} from '../engine/portfolio.js';

test('parseNeverlessCSV: extracts a BUY when a tracked asset is received', () => {
  const rows = [{
    Type: 'Trade', Date: '2026-04-11T00:00:00Z',
    'Amount received': '0.019379', 'Asset received': 'BTC',
    'Amount sent': '99540.30', 'Asset sent': 'EUR',
    'USD price of asset received': '5137000', 'USD price of asset sent': '1',
    ID: 'abc123',
  }];
  const [tx] = parseNeverlessCSV(rows);
  assert.equal(tx.asset, 'BTC');
  assert.equal(tx.type, 'BUY');
  assert.equal(tx.account, 'Neverless');
  assert.equal(tx.sourceId, 'nvl_abc123');
});

test('parseNeverlessCSV: extracts a SELL when a tracked asset is sent', () => {
  const rows = [{
    Type: 'Trade', Date: '2026-05-01T00:00:00Z',
    'Amount received': '100', 'Asset received': 'USDC',
    'Amount sent': '0.05', 'Asset sent': 'ETH',
    'USD price of asset received': '1', 'USD price of asset sent': '2000',
    ID: 'sell1',
  }];
  const [tx] = parseNeverlessCSV(rows);
  assert.equal(tx.asset, 'ETH');
  assert.equal(tx.type, 'SELL');
});

test('parseNeverlessCSV: ignores trades between two non-tracked assets (e.g. USDC <-> EURC)', () => {
  const rows = [{
    Type: 'Trade', Date: '2026-04-11T00:00:00Z',
    'Amount received': '20', 'Asset received': 'USDC',
    'Amount sent': '20', 'Asset sent': 'EURC',
    'USD price of asset received': '1', 'USD price of asset sent': '1.17',
    ID: 'noise1',
  }];
  assert.deepEqual(parseNeverlessCSV(rows), []);
});

test('parseNeverlessCSV: ignores Deposit/Withdrawal rows', () => {
  const rows = [{ Type: 'Deposit', Date: '2026-04-11T00:00:00Z', 'Amount received': '20', 'Asset received': 'EUR', ID: 'dep1' }];
  assert.deepEqual(parseNeverlessCSV(rows), []);
});

test('parseNeverlessCSV: never fabricates a transaction from an unparseable row', () => {
  const rows = [{ Type: 'Trade', Date: 'not-a-date', 'Amount received': '1', 'Asset received': 'BTC', ID: 'bad1' }];
  assert.deepEqual(parseNeverlessCSV(rows), []);
});

test('parseRevolutRows: converts EUR price to USD using the supplied rate, and labels it as an approximation', () => {
  const rows = [{ Symbol: 'ETH', Type: 'Buy', Quantity: 0.001, Price: 2000, Value: 2, Fees: 0, Date: '2026-04-10T15:41:03Z' }];
  const [tx] = parseRevolutRows(rows, 1.1);
  assert.equal(tx.asset, 'ETH');
  assert.equal(tx.unitPriceUsd, 2200);
  assert.equal(tx.account, 'Revolut');
  assert.ok('priceApproximation' in tx);
});

test('parseRevolutRows: handles the real-world CSV export format — currency-formatted strings with corrupted encoding, human-readable dates with corrupted whitespace', () => {
  // Actual bytes seen from a real Revolut CSV export: the € sign double-encoded,
  // and a narrow-no-break-space before AM/PM similarly mangled.
  const rows = [{ Symbol: 'ETH', Type: 'Buy', Quantity: '0.00001048', Price: '\u00e2\u00ac1,908.30', Value: '\u00e2\u00ac0.02', Fees: '\u00e2\u00ac0.00', Date: 'Apr 10, 2026, 3:41:03\u00e2\u0080\u00afPM' }];
  const [tx] = parseRevolutRows(rows, 1.0);
  assert.equal(tx.asset, 'ETH');
  assert.equal(tx.quantity, 0.00001048);
  assert.equal(tx.unitPriceUsd, 1908.30);
  assert.equal(tx.timestamp, Date.parse('2026-04-10T15:41:03Z'));
});

test('parseRevolutRows: sourceId is stable across re-exports regardless of row position (content-based, not index-based)', () => {
  const row = { Symbol: 'LINK', Type: 'Buy', Quantity: 5, Price: 10, Date: '2026-05-01T00:00:00Z' };
  const [firstPosition] = parseRevolutRows([row, { Symbol: 'BTC', Type: 'Buy', Quantity: 1, Price: 50000, Date: '2026-05-02T00:00:00Z' }], 1.0);
  const [, secondPosition] = parseRevolutRows([{ Symbol: 'BTC', Type: 'Buy', Quantity: 1, Price: 50000, Date: '2026-05-02T00:00:00Z' }, row], 1.0);
  assert.equal(firstPosition.sourceId, secondPosition.sourceId);
});

test('parseRevolutRows: rejects a row with no usable numeric price rather than fabricating one', () => {
  const rows = [{ Symbol: 'ETH', Type: 'Buy', Quantity: '0.001', Price: 'n/a', Date: '2026-04-10T00:00:00Z' }];
  assert.deepEqual(parseRevolutRows(rows, 1.1), []);
});

test('parseRevolutRows: skips non-tracked symbols', () => {
  const rows = [{ Symbol: 'DOGE', Type: 'Buy', Quantity: 100, Price: 0.1, Date: '2026-04-10T00:00:00Z' }];
  assert.deepEqual(parseRevolutRows(rows, 1.1), []);
});

test('parseRevolutRows: "Buy - Revolut X" is a real purchase, not a type to drop', () => {
  const rows = [{ Symbol: 'LINK', Type: 'Buy - Revolut X', Quantity: '2.057306', Price: '$7.75', Date: 'Jul 2, 2026, 6:32:44\u00e2\u0080\u00afPM' }];
  const [tx] = parseRevolutRows(rows, 1.0);
  assert.equal(tx.type, 'BUY');
  assert.equal(tx.unitPriceUsd, 7.75);
});

test('parseRevolutRows: a $-prefixed price is already USD and must NOT be multiplied by the EUR rate again', () => {
  const rows = [{ Symbol: 'LINK', Type: 'Buy - Revolut X', Quantity: '2.057306', Price: '$7.75', Date: 'Jul 2, 2026, 6:32:44\u00e2\u0080\u00afPM' }];
  const [tx] = parseRevolutRows(rows, 1.35); // a deliberately non-1.0 rate to catch accidental double-conversion
  assert.equal(tx.unitPriceUsd, 7.75, 'a USD-prefixed price must pass through unchanged regardless of the EUR rate supplied');
});

test('parseRevolutRows: excludes rows priced in a currency with no reliable conversion (IDR seen in practice), rather than fabricating a rate', () => {
  // Real row found in an actual export: a tiny fractional buy priced in Indonesian Rupiah,
  // not EUR — treating the raw number as EUR would inflate it by roughly 100,000x.
  const rows = [{ Symbol: 'LINK', Type: 'Buy', Quantity: '0.00000475', Price: '138,920.02 IDR', Value: '0.66 IDR', Date: 'Jul 8, 2026, 10:34:26\u00e2\u0080\u00afAM' }];
  assert.deepEqual(parseRevolutRows(rows, 1.10), []);
});

test('parseRevolutRows: "Staking reward" is a real quantity increase with an honest $0 cost basis, not fabricated FMV', () => {
  const rows = [{ Symbol: 'ETH', Type: 'Staking reward', Quantity: '0.00000402', Price: '', Date: 'Jul 22, 2026, 9:41:17\u00e2\u0080\u00afAM' }];
  const [tx] = parseRevolutRows(rows, 1.1);
  assert.equal(tx.type, 'TRANSFER_IN');
  assert.equal(tx.unitPriceUsd, 0);
  assert.match(tx.priceApproximation, /does not report a price/);
});

test('parseRevolutRows: "Stake" is excluded — moves an existing balance, not a new acquisition', () => {
  const rows = [{ Symbol: 'ETH', Type: 'Stake', Quantity: '0.01819434', Price: '\u00e2\u00ac1,654.64', Date: 'Jul 19, 2026, 2:22:47\u00e2\u0080\u00afPM' }];
  assert.deepEqual(parseRevolutRows(rows, 1.1), []);
});

test('computeHoldings: weighted-average cost across multiple buys', () => {
  const txs = [
    { asset: 'BTC', type: 'BUY', quantity: 1, unitPriceUsd: 50000, timestamp: 1 },
    { asset: 'BTC', type: 'BUY', quantity: 1, unitPriceUsd: 70000, timestamp: 2 },
  ];
  const holdings = computeHoldings(txs);
  assert.equal(holdings.BTC.quantity, 2);
  assert.equal(holdings.BTC.investedCost, 120000);
});

test('computeHoldings: a sell reduces quantity and invested cost at the running average', () => {
  const txs = [
    { asset: 'ETH', type: 'BUY', quantity: 2, unitPriceUsd: 1000, timestamp: 1 }, // avg cost 1000
    { asset: 'ETH', type: 'SELL', quantity: 1, unitPriceUsd: 1500, timestamp: 2 },
  ];
  const holdings = computeHoldings(txs);
  assert.equal(holdings.ETH.quantity, 1);
  assert.equal(holdings.ETH.investedCost, 1000); // 1 remaining unit at the 1000 avg cost
});

test('computeHoldings: a sell larger than the position never goes negative', () => {
  const txs = [
    { asset: 'SOL', type: 'BUY', quantity: 1, unitPriceUsd: 100, timestamp: 1 },
    { asset: 'SOL', type: 'SELL', quantity: 5, unitPriceUsd: 200, timestamp: 2 },
  ];
  const holdings = computeHoldings(txs);
  assert.equal(holdings.SOL.quantity, 0);
  assert.equal(holdings.SOL.investedCost, 0);
});

test('computePortfolioSummary: totals, P&L, and allocation across two assets', () => {
  const holdings = { BTC: { quantity: 1, investedCost: 50000 }, ETH: { quantity: 10, investedCost: 20000 } };
  const summary = computePortfolioSummary(holdings, { BTC: 60000, ETH: 2500 });
  assert.equal(summary.totalValue, 60000 + 25000);
  assert.equal(summary.investedCapital, 70000);
  assert.equal(summary.unrealizedPnl, 85000 - 70000);
  assert.equal(summary.bestPerformer, 'ETH'); // ETH: +25%, BTC: +20%
  const btcRow = summary.byAsset.find((r) => r.asset === 'BTC');
  assert.ok(Math.abs(btcRow.allocationPct - 60000 / 85000) < 1e-9);
});

test('computePortfolioSummary: never fabricates a total when a price is missing', () => {
  const holdings = { BTC: { quantity: 1, investedCost: 50000 }, LINK: { quantity: 100, investedCost: 500 } };
  const summary = computePortfolioSummary(holdings, { BTC: 60000 }); // LINK price unavailable
  assert.equal(summary.totalValue, null);
  assert.equal(summary.unrealizedPnl, null);
  assert.equal(summary.pricesComplete, false);
});

test('computePortfolioSummary: zero holdings produce an empty, non-fabricated summary', () => {
  const summary = computePortfolioSummary({}, {});
  assert.equal(summary.totalValue, 0);
  assert.equal(summary.bestPerformer, null);
});

test('dedupeTransactions: repeated upload of the same rows is idempotent', () => {
  const txs = [{ sourceId: 'a', asset: 'BTC' }, { sourceId: 'a', asset: 'BTC' }, { sourceId: 'b', asset: 'ETH' }];
  assert.equal(dedupeTransactions(txs).length, 2);
});

test('TRACKED_ASSETS: fixed to the 5 V1 assets, confirmed in scope rather than assumed', () => {
  assert.deepEqual([...TRACKED_ASSETS].sort(), ['BTC', 'ETH', 'HYPE', 'LINK', 'SOL']);
});

test('parseV1Export: a normal buy uses the pre-resolved per-unit USD price directly', () => {
  const txs = [{ id: 'abc123', date: '2026-04-11', asset: 'BTC', acct: 'Neverless', type: 'buy', qty: 0.019379, price: 84715.15, ccy: 'EUR', usd: 99540.30125, eur: 84715.15 }];
  const [tx] = parseV1Export(txs);
  assert.equal(tx.asset, 'BTC');
  assert.equal(tx.type, 'BUY');
  assert.equal(tx.unitPriceUsd, 99540.30125);
  assert.equal(tx.sourceId, 'v1_abc123');
});

test('parseV1Export: a reward row maps to TRANSFER_IN with $0 cost basis, not a fabricated value', () => {
  const txs = [{ id: 'rwd1', date: '2026-09-11', asset: 'ETH', acct: 'Revolut', type: 'buy', qty: 1.7e-6, price: 0, ccy: 'EUR', eur: 0, usd: 0, isReward: true }];
  const [tx] = parseV1Export(txs);
  assert.equal(tx.type, 'TRANSFER_IN');
  assert.equal(tx.unitPriceUsd, 0);
});

test('parseV1Export: skips non-tracked assets and non-buy types', () => {
  const txs = [
    { id: 'x1', date: '2026-05-01', asset: 'DOGE', acct: 'Neverless', type: 'buy', qty: 100, usd: 0.1 },
    { id: 'x2', date: '2026-05-01', asset: 'BTC', acct: 'Neverless', type: 'sell', qty: 1, usd: 90000 },
  ];
  assert.deepEqual(parseV1Export(txs), []);
});

test('computeAccruedInterestEur: returns the exact embedded value for a date within the table', () => {
  assert.equal(computeAccruedInterestEur('2026-06-26'), 15.67);
  assert.equal(computeAccruedInterestEur('2026-04-11'), 0.0);
});

test('computeAccruedInterestEur: extrapolates linearly past the last embedded date using the last 5 days\u2019 daily rate', () => {
  const ks = Object.keys(INTEREST_EUR_TABLE).sort();
  const last = ks[ks.length - 1];
  const dailyRate = (INTEREST_EUR_TABLE[last] - INTEREST_EUR_TABLE[ks[ks.length - 6]]) / 5;
  const oneDayPast = computeAccruedInterestEur('2026-06-27');
  assert.ok(Math.abs(oneDayPast - (INTEREST_EUR_TABLE[last] + dailyRate)) < 1e-9);
});

test('computeAccruedInterestEur: matches V1\u2019s confirmed live extrapolation for 2026-09-12 (\u20ac31.75, ~$36.89 at fx 1.1618)', () => {
  const eur = computeAccruedInterestEur('2026-09-12');
  assert.ok(Math.abs(eur - 31.752) < 0.01, `expected ~31.752, got ${eur}`);
});

test('computePortfolioSummary: cash interest adds to total value and P&L but never to invested capital', () => {
  const holdings = { BTC: { quantity: 1, investedCost: 50000 } };
  const prices = { BTC: 60000 };
  const withoutInterest = computePortfolioSummary(holdings, prices);
  const withInterest = computePortfolioSummary(holdings, prices, { usd: 100, eur: 86, fx: 1.1628 });
  assert.equal(withoutInterest.totalValue, 60000);
  assert.equal(withInterest.totalValue, 60100);
  assert.equal(withInterest.cryptoValue, 60000, 'cryptoValue should stay the crypto-only figure');
  assert.equal(withInterest.investedCapital, 50000, 'interest must never inflate invested capital');
  assert.equal(withInterest.unrealizedPnl, 10100);
  assert.equal(withInterest.cashInterestUsd, 100);
});

test('computePortfolioSummary: with no cash interest supplied, behaves exactly as before (backward compatible)', () => {
  const holdings = { ETH: { quantity: 2, investedCost: 4000 } };
  const prices = { ETH: 2500 };
  const summary = computePortfolioSummary(holdings, prices);
  assert.equal(summary.totalValue, 5000);
  assert.equal(summary.cashInterestUsd, 0);
});
