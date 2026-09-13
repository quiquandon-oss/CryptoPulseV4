// tests/market_pulse.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAggregatedRegime, computeCyclePosition, computeHalvingPhase, computeMarketPulse,
  reconcileV1HistoryImport, classifyAlignment, explainMarketPulse, alignMarketPulseWithBtc,
  CYCLE_ATH, HALVING_DATE_MS,
} from '../engine/market_pulse.js';

// --- computeAggregatedRegime ---

test('computeAggregatedRegime: 2 bullish, 1 bearish of 3 gives +1/3', () => {
  const r = computeAggregatedRegime([
    { asset: 'BTC', regime: 'TRENDING_BULLISH' },
    { asset: 'ETH', regime: 'TRENDING_BULLISH' },
    { asset: 'LINK', regime: 'TRENDING_BEARISH' },
  ]);
  assert.ok(Math.abs(r.norm - 1 / 3) < 1e-9);
  assert.equal(r.bullishCount, 2);
  assert.equal(r.bearishCount, 1);
});

test('computeAggregatedRegime: UNKNOWN regimes are excluded from the denominator, not counted as neutral zeros', () => {
  const r = computeAggregatedRegime([
    { asset: 'BTC', regime: 'TRENDING_BULLISH' },
    { asset: 'ETH', regime: 'UNKNOWN' },
    { asset: 'LINK', regime: 'RANGE_BOUND' },
  ]);
  assert.equal(r.total, 2, 'UNKNOWN should not count toward total');
  assert.ok(Math.abs(r.norm - 0.5) < 1e-9);
});

test('computeAggregatedRegime: all UNKNOWN or empty returns null, not a fabricated neutral', () => {
  assert.equal(computeAggregatedRegime([{ asset: 'BTC', regime: 'UNKNOWN' }]), null);
  assert.equal(computeAggregatedRegime([]), null);
  assert.equal(computeAggregatedRegime(null), null);
});

// --- computeCyclePosition ---

test('computeCyclePosition: at the real ATH price, position is fully bullish (+1)', () => {
  const p = computeCyclePosition(CYCLE_ATH.price);
  assert.ok(Math.abs(p.norm - 1) < 1e-9);
  assert.ok(Math.abs(p.drawdownPct - 0) < 1e-9);
});

test('computeCyclePosition: at the historical-bottom-band midpoint (-81.5%), position is fully bearish (-1)', () => {
  const priceAtBandMid = CYCLE_ATH.price * (1 - 0.815);
  const p = computeCyclePosition(priceAtBandMid);
  assert.ok(Math.abs(p.norm - -1) < 1e-6);
});

test('computeCyclePosition: a crash deeper than any historical bottom clamps at -1, never goes below', () => {
  const p = computeCyclePosition(CYCLE_ATH.price * 0.05); // -95% drawdown, deeper than -86%
  assert.equal(p.norm, -1);
});

test('computeCyclePosition: null price returns null rather than a fabricated reading', () => {
  assert.equal(computeCyclePosition(null), null);
  assert.equal(computeCyclePosition(undefined), null);
});

// --- computeHalvingPhase ---

test('computeHalvingPhase: days-since-halving is computed from the real, documented 2024-04-20 date', () => {
  const oneDayAfterHalving = HALVING_DATE_MS + 86_400_000;
  const h = computeHalvingPhase(oneDayAfterHalving);
  assert.equal(h.daysSinceHalving, 1);
  assert.equal(h.phase, 'PRE_MID_BULL_RUN');
});

test('computeHalvingPhase: phase boundaries match V1\u2019s documented thresholds (548d, 1096d)', () => {
  assert.equal(computeHalvingPhase(HALVING_DATE_MS + 548 * 86_400_000).phase, 'PRE_MID_BULL_RUN');
  assert.equal(computeHalvingPhase(HALVING_DATE_MS + 549 * 86_400_000).phase, 'POST_PEAK_CORRECTION');
  assert.equal(computeHalvingPhase(HALVING_DATE_MS + 1097 * 86_400_000).phase, 'LATE_CYCLE_CONSOLIDATION');
});

// --- computeMarketPulse (the composite itself) ---

test('computeMarketPulse: both halves present, equal-weighted 50/50 as documented', () => {
  // deterministic half: regime +0.5, cyclePosition +0.5 -> avg +0.5
  // disclosed half: sentiment 75 (norm +0.5), conviction +0.5 -> avg +0.5
  // raw = 0.5*0.5 + 0.5*0.5 = 0.5 -> (0.5+1)/2*100 = 75
  const r = computeMarketPulse({
    v4RegimeNorm: 0.5, v4CyclePositionNorm: 0.5,
    sentimentScore0to100: 75, cycleConvictionNeg1to1: 0.5,
  });
  assert.equal(r.marketPulse, 75);
  assert.equal(r.label, 'BULLISH');
  assert.equal(r.partial, false);
  assert.ok(r.disclosure, 'must always disclose when the disclosed half is used');
});

test('computeMarketPulse: BULLISH/NEUTRAL/BEARISH thresholds are 60/40 as documented', () => {
  assert.equal(computeMarketPulse({ sentimentScore0to100: 100 }).label, 'BULLISH'); // norm=1 -> pulse=100
  assert.equal(computeMarketPulse({ sentimentScore0to100: 50 }).label, 'NEUTRAL'); // norm=0 -> pulse=50
  assert.equal(computeMarketPulse({ sentimentScore0to100: 0 }).label, 'BEARISH'); // norm=-1 -> pulse=0
});

test('computeMarketPulse: missing deterministic half falls back to disclosed alone, flagged partial with a stated reason', () => {
  const r = computeMarketPulse({ sentimentScore0to100: 80, cycleConvictionNeg1to1: 0.4 });
  assert.equal(r.partial, true);
  assert.match(r.partialReason, /deterministic half.*unavailable/i);
  assert.ok(r.marketPulse != null);
});

test('computeMarketPulse: missing disclosed half falls back to deterministic alone, flagged partial, no disclosure text', () => {
  const r = computeMarketPulse({ v4RegimeNorm: 0.6, v4CyclePositionNorm: 0.2 });
  assert.equal(r.partial, true);
  assert.match(r.partialReason, /disclosed half.*unavailable/i);
  assert.equal(r.disclosure, null, 'no disclosure needed when the disclosed half was not actually used');
});

test('computeMarketPulse: a single missing field within a half is excluded from that half\u2019s average, not treated as 0', () => {
  // deterministic half has only v4RegimeNorm=1 (cyclePosition missing) -> half = 1, not (1+0)/2=0.5
  const r = computeMarketPulse({ v4RegimeNorm: 1, sentimentScore0to100: 50, cycleConvictionNeg1to1: 0 });
  assert.equal(r.deterministicHalf, 1);
});

test('computeMarketPulse: everything missing returns null with the exact spec-mandated insufficient-evidence message', () => {
  const r = computeMarketPulse({});
  assert.equal(r.marketPulse, null);
  assert.equal(r.reason, 'Insufficient evidence to determine the current Market Pulse.');
});

test('computeMarketPulse: never claims a label when marketPulse is null', () => {
  const r = computeMarketPulse({});
  assert.equal(r.label, null);
});

// --- reconcileV1HistoryImport ---

test('reconcileV1HistoryImport: new rows get inserted with source tagged V1_HISTORY_IMPORT', () => {
  const { toInsert, duplicates } = reconcileV1HistoryImport([], [{ ts: 1000, score: 55, regimeMag: 0.1, btcPrice: 90000 }]);
  assert.equal(toInsert.length, 1);
  assert.equal(toInsert[0].source, 'V1_HISTORY_IMPORT');
  assert.equal(duplicates, 0);
});

test('reconcileV1HistoryImport: a timestamp already imported is skipped as a duplicate, not re-inserted', () => {
  const existing = [{ ts: 1000, score: 55 }];
  const { toInsert, duplicates } = reconcileV1HistoryImport(existing, [{ ts: 1000, score: 55, regimeMag: 0.1 }]);
  assert.equal(toInsert.length, 0);
  assert.equal(duplicates, 1);
});

test('reconcileV1HistoryImport: a candidate row with no score is skipped rather than importing a useless/fabricated row', () => {
  const { toInsert, receivedCount } = reconcileV1HistoryImport([], [{ ts: 1000, score: null }]);
  assert.equal(toInsert.length, 0);
  assert.equal(receivedCount, 1);
});

// --- classifyAlignment ---

test('classifyAlignment: both rising together is Confirmation, in neutral analytical language', () => {
  const r = classifyAlignment(10, 15);
  assert.equal(r.label, 'Confirmation');
});

test('classifyAlignment: both falling together is also Confirmation', () => {
  const r = classifyAlignment(-10, -15);
  assert.equal(r.label, 'Confirmation');
});

test('classifyAlignment: Pulse up while BTC flat/down is Bullish divergence', () => {
  const r = classifyAlignment(8, -2);
  assert.equal(r.label, 'Bullish divergence');
});

test('classifyAlignment: Pulse down while BTC flat/up is Bearish divergence', () => {
  const r = classifyAlignment(-8, 2);
  assert.equal(r.label, 'Bearish divergence');
});

test('classifyAlignment: never returns a label containing trading-signal language', () => {
  const labels = [
    classifyAlignment(10, 15), classifyAlignment(-10, -15),
    classifyAlignment(8, -2), classifyAlignment(-8, 2), classifyAlignment(0, 0),
  ].map((r) => r.label.toLowerCase());
  for (const l of labels) {
    assert.ok(!l.includes('buy') && !l.includes('sell') && !l.includes('signal'));
  }
});

test('classifyAlignment: missing inputs return null rather than a fabricated relationship', () => {
  assert.equal(classifyAlignment(null, 5), null);
  assert.equal(classifyAlignment(5, undefined), null);
});

// --- explainMarketPulse ---

test('explainMarketPulse: insufficient-evidence result produces the exact reason with no invented points', () => {
  const r = computeMarketPulse({});
  const e = explainMarketPulse(r);
  assert.equal(e.summary, 'Insufficient evidence to determine the current Market Pulse.');
  assert.deepEqual(e.points, []);
});

test('explainMarketPulse: only cites facts actually supplied in context, never invents a cause', () => {
  const r = computeMarketPulse({ v4RegimeNorm: 0.5, sentimentScore0to100: 60 });
  const e = explainMarketPulse(r, { regimeCounts: { bullishCount: 2, bearishCount: 0, total: 3 } });
  assert.ok(e.points.some((p) => p.includes('2 of 3')));
  assert.ok(!e.points.some((p) => p.includes('halving')), 'should not mention halving when no halving context was given');
});

test('explainMarketPulse: a partial result includes the stated partial reason among its points', () => {
  const r = computeMarketPulse({ sentimentScore0to100: 70 });
  const e = explainMarketPulse(r);
  assert.ok(e.points.includes(r.partialReason));
});

// --- alignMarketPulseWithBtc ---

test('alignMarketPulseWithBtc: BTC becomes cumulative % return from the window start, Pulse stays 0-100', () => {
  const pulse = [{ ts: 1000, market_pulse: 60 }, { ts: 2000, market_pulse: 70 }];
  const btc = [{ ts: 1000, close: 100 }, { ts: 2000, close: 110 }];
  const { status, points } = alignMarketPulseWithBtc(pulse, btc);
  assert.equal(status, 'OK');
  assert.equal(points[0].marketPulse, 60);
  assert.equal(points[0].btcCumReturnPct, 0, 'first point is the base, 0% return');
  assert.equal(points[1].marketPulse, 70);
  assert.ok(Math.abs(points[1].btcCumReturnPct - 10) < 1e-9, 'a 100->110 move is +10%');
});

test('alignMarketPulseWithBtc: a Pulse point with no BTC observation within 2h tolerance is dropped, not guessed', () => {
  const pulse = [{ ts: 1000, market_pulse: 60 }, { ts: 1000 + 5 * 3_600_000, market_pulse: 70 }];
  const btc = [{ ts: 1000, close: 100 }]; // nothing near the second pulse point
  const { points } = alignMarketPulseWithBtc(pulse, btc);
  assert.equal(points.length, 1);
});

test('alignMarketPulseWithBtc: no overlapping data at all returns INSUFFICIENT_DATA, not an empty-but-OK result', () => {
  const r = alignMarketPulseWithBtc([], []);
  assert.equal(r.status, 'INSUFFICIENT_DATA');
  assert.deepEqual(r.points, []);
});
