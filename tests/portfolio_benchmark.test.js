import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNormalizedBenchmark, computePortfolioInsights } from '../engine/portfolio.js';

test('computeNormalizedBenchmark: normalizes portfolio and BTC to base 100', () => {
  const port = [
    { ts: 1000, total_value_usd: 1000 },
    { ts: 2000, total_value_usd: 1100 },
    { ts: 3000, total_value_usd: 900 },
  ];
  const btc = [
    { ts: 1000, close: 50000 },
    { ts: 2000, close: 55000 },
    { ts: 3000, close: 45000 },
  ];

  const res = computeNormalizedBenchmark(port, btc);
  assert.equal(res.status, 'OK');
  assert.equal(res.points.length, 3);
  assert.equal(res.points[0].portfolioNormalized, 100);
  assert.equal(res.points[0].btcNormalized, 100);
  assert.equal(res.points[1].portfolioNormalized, 110);
  assert.equal(res.points[1].btcNormalized, 110);
  assert.equal(res.points[2].portfolioNormalized, 90);
  assert.equal(res.points[2].btcNormalized, 90);
});

test('computeNormalizedBenchmark: returns INSUFFICIENT_DATA when missing points', () => {
  const res = computeNormalizedBenchmark([], []);
  assert.equal(res.status, 'INSUFFICIENT_DATA');
});

test('computePortfolioInsights: identifies concentration, diversification and contribution', () => {
  const summary = {
    byAsset: [
      { asset: 'LINK', allocationPct: 0.50, pnlPct: -0.15 },
      { asset: 'BTC', allocationPct: 0.44, pnlPct: -0.21 },
      { asset: 'ETH', allocationPct: 0.03, pnlPct: 0.13 },
    ],
    bestPerformer: 'ETH',
    worstPerformer: 'BTC',
  };

  const insights = computePortfolioInsights(summary);
  assert.ok(insights.length >= 2);
  const concentration = insights.find((i) => i.type === 'CONCENTRATION');
  assert.ok(concentration);
  assert.match(concentration.title, /LINK/);
});
