import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNeverlessCSV, parseRevolutRows, computeHoldings, computePortfolioSummary,
  dedupeTransactions, TRACKED_ASSETS,
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

test('parseRevolutRows: skips non-tracked symbols', () => {
  const rows = [{ Symbol: 'DOGE', Type: 'Buy', Quantity: 100, Price: 0.1, Date: '2026-04-10T00:00:00Z' }];
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
