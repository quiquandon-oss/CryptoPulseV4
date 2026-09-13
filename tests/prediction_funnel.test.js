// tests/prediction_funnel.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectAssetPriceRange, projectPortfolioFunnel, evaluateModelSufficiency, MIN_RESOLVED_SAMPLES,
} from '../engine/prediction_funnel.js';

// --- projectAssetPriceRange ---

test('projectAssetPriceRange: applies percent returns correctly against the current price', () => {
  const r = projectAssetPriceRange(100, -2, 1, 3);
  assert.ok(Math.abs(r.p25 - 98) < 1e-9);
  assert.ok(Math.abs(r.median - 101) < 1e-9);
  assert.ok(Math.abs(r.p75 - 103) < 1e-9);
});

test('projectAssetPriceRange: matches a real k-NN row from V2 (BTC, -0.71% median)', () => {
  // Real row pulled from V2's `predictions` table this session.
  const r = projectAssetPriceRange(77284, -1.492388817033131, -0.7136909568025801, 0.4858771702513604);
  assert.ok(Math.abs(r.median - 76732.43) < 1);
});

test('projectAssetPriceRange: null price returns null rather than fabricating a projection', () => {
  assert.equal(projectAssetPriceRange(null, -1, 0, 1), null);
  assert.equal(projectAssetPriceRange(0, -1, 0, 1), null);
});

test('projectAssetPriceRange: a missing individual percentile returns null for that field only', () => {
  const r = projectAssetPriceRange(100, null, 2, null);
  assert.equal(r.p25, null);
  assert.equal(r.median, 102);
  assert.equal(r.p75, null);
});

// --- projectPortfolioFunnel ---

test('projectPortfolioFunnel: single fully-modeled asset projects directly', () => {
  const holdings = { BTC: { quantity: 1 } };
  const prices = { BTC: 100 };
  const predictions = { BTC: { p25ReturnPct: -2, medianReturnPct: 1, p75ReturnPct: 3 } };
  const r = projectPortfolioFunnel(holdings, prices, predictions);
  assert.equal(r.currentValue, 100);
  assert.equal(r.p25Value, 98);
  assert.equal(r.medianValue, 101);
  assert.equal(r.p75Value, 103);
  assert.deepEqual(r.coverage.modeledAssets, ['BTC']);
  assert.deepEqual(r.coverage.flatAssets, []);
  assert.equal(r.coverage.coveragePct, 1);
});

test('projectPortfolioFunnel: unmodeled assets held flat, not assumed to move, and listed in coverage', () => {
  const holdings = { BTC: { quantity: 1 }, SOL: { quantity: 10 } };
  const prices = { BTC: 100, SOL: 5 };
  const predictions = { BTC: { p25ReturnPct: -10, medianReturnPct: 0, p75ReturnPct: 10 } };
  const r = projectPortfolioFunnel(holdings, prices, predictions);
  // BTC contributes 90/100/110; SOL contributes 50 flat at every percentile
  assert.equal(r.currentValue, 150);
  assert.equal(r.p25Value, 90 + 50);
  assert.equal(r.medianValue, 100 + 50);
  assert.equal(r.p75Value, 110 + 50);
  assert.deepEqual(r.coverage.modeledAssets, ['BTC']);
  assert.deepEqual(r.coverage.flatAssets, ['SOL']);
  assert.ok(Math.abs(r.coverage.coveragePct - 100 / 150) < 1e-9);
});

test('projectPortfolioFunnel: zero-quantity holdings are excluded entirely (fully sold position)', () => {
  const holdings = { BTC: { quantity: 1 }, ETH: { quantity: 0 } };
  const prices = { BTC: 100, ETH: 50 };
  const r = projectPortfolioFunnel(holdings, prices, { BTC: { p25ReturnPct: 0, medianReturnPct: 0, p75ReturnPct: 0 } });
  assert.equal(r.currentValue, 100);
});

test('projectPortfolioFunnel: a missing current price for any held asset returns null rather than guessing', () => {
  const holdings = { BTC: { quantity: 1 }, LINK: { quantity: 5 } };
  const prices = { BTC: 100 }; // LINK price missing
  const r = projectPortfolioFunnel(holdings, prices, {});
  assert.equal(r, null);
});

test('projectPortfolioFunnel: no holdings at all returns null, not a fabricated zero', () => {
  assert.equal(projectPortfolioFunnel({}, {}, {}), null);
  assert.equal(projectPortfolioFunnel(null, {}, {}), null);
});

test('projectPortfolioFunnel: always includes the methodology disclosure, never presented silently', () => {
  const r = projectPortfolioFunnel({ BTC: { quantity: 1 } }, { BTC: 100 }, { BTC: { p25ReturnPct: -1, medianReturnPct: 0, p75ReturnPct: 1 } });
  assert.ok(r.methodologyNote.length > 0);
  assert.match(r.methodologyNote, /independently/);
});

test('projectPortfolioFunnel: realistic 3-asset scenario matching this session\u2019s actual holdings shape', () => {
  const holdings = { BTC: { quantity: 0.0196 }, ETH: { quantity: 0.032 }, LINK: { quantity: 147.7 }, SOL: { quantity: 0.4 }, HYPE: { quantity: 0.47 } };
  const prices = { BTC: 77284, ETH: 2519, LINK: 11.48, SOL: 200, HYPE: 40 };
  const predictions = {
    BTC: { p25ReturnPct: -1.49, medianReturnPct: -0.71, p75ReturnPct: 0.49 },
    ETH: { p25ReturnPct: 0.41, medianReturnPct: 0.71, p75ReturnPct: 2.28 },
    LINK: { p25ReturnPct: -3.35, medianReturnPct: -3.05, p75ReturnPct: -3.01 },
  };
  const r = projectPortfolioFunnel(holdings, prices, predictions);
  assert.deepEqual(r.coverage.modeledAssets.sort(), ['BTC', 'ETH', 'LINK']);
  assert.deepEqual(r.coverage.flatAssets.sort(), ['HYPE', 'SOL']);
  assert.ok(r.coverage.coveragePct > 0.9, 'BTC+ETH+LINK should be the large majority of this portfolio shape');
});

// --- evaluateModelSufficiency ---

test('evaluateModelSufficiency: below the 20-sample gate is insufficient regardless of apparent accuracy', () => {
  const r = evaluateModelSufficiency(13, 5);
  assert.equal(r.sufficient, false);
  assert.match(r.message, /Insufficient data/);
  assert.match(r.message, /13 resolved/);
});

test('evaluateModelSufficiency: matches the real TimesFM track record confirmed live this session (13 resolved, 5 correct)', () => {
  const r = evaluateModelSufficiency(13, 5);
  assert.ok(Math.abs(r.accuracy - 5 / 13) < 1e-9);
  assert.equal(r.sufficient, false);
});

test('evaluateModelSufficiency: at or above the gate reports the actual accuracy percentage', () => {
  const r = evaluateModelSufficiency(25, 15);
  assert.equal(r.sufficient, true);
  assert.match(r.message, /60% accuracy over 25 resolved/);
});

test('evaluateModelSufficiency: zero resolved predictions never divides by zero into a fabricated accuracy', () => {
  const r = evaluateModelSufficiency(0, 0);
  assert.equal(r.accuracy, null);
  assert.equal(r.sufficient, false);
});

test('MIN_RESOLVED_SAMPLES is exported and matches the documented threshold', () => {
  assert.equal(MIN_RESOLVED_SAMPLES, 20);
});
