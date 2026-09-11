import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIndicators, computeAgreement, DIRECTION } from '../engine/evidence.js';

const fullBullishSnapshot = {
  price: 110,
  sma20: 100, sma50: 95,
  ema12: 108, ema26: 102,
  rsi14: 65,
  macd: 1.5, macdSignal: 0.5,
  ichimokuTenkan: 105, ichimokuKijun: 100, ichimokuSpanA: 102, ichimokuSpanB: 98,
  momentum10: 4,
  volatility20: 2,
};

test('evaluateIndicators: marks indicators unavailable (not fabricated) when null', () => {
  const facts = evaluateIndicators({ price: 100, sma20: null, sma50: null, ema12: null, ema26: null, rsi14: null, macd: null, macdSignal: null, ichimokuTenkan: null, ichimokuKijun: null, ichimokuSpanA: null, ichimokuSpanB: null, momentum10: null, volatility20: null });
  for (const f of facts.filter((f) => f.indicator !== 'Volatility')) {
    assert.equal(f.applicable, false);
    assert.equal(f.value, null);
  }
});

test('evaluateIndicators: a clearly bullish snapshot classifies every directional indicator as BULLISH', () => {
  const facts = evaluateIndicators(fullBullishSnapshot);
  const directional = facts.filter((f) => f.directional !== false);
  assert.ok(directional.every((f) => f.direction === DIRECTION.BULLISH), JSON.stringify(directional, null, 2));
});

test('evaluateIndicators: volatility is excluded from directional evaluation', () => {
  const facts = evaluateIndicators(fullBullishSnapshot);
  const vol = facts.find((f) => f.indicator === 'Volatility');
  assert.equal(vol.directional, false);
});

test('computeAgreement: full agreement across all directional indicators (spec\'s "N/N indicators bullish" example)', () => {
  const facts = evaluateIndicators(fullBullishSnapshot);
  const agreement = computeAgreement(facts);
  assert.equal(agreement.majorityDirection, DIRECTION.BULLISH);
  assert.equal(agreement.agreementRatio, 1);
  assert.equal(agreement.label, '6/6 indicators bullish');
});

test('computeAgreement: returns null ratio and an honest label with zero applicable indicators', () => {
  const agreement = computeAgreement([{ indicator: 'X', applicable: false, direction: DIRECTION.NEUTRAL }]);
  assert.equal(agreement.agreementRatio, null);
  assert.equal(agreement.label, 'Insufficient evidence');
});

test('computeAgreement: mixed signals produce a fractional ratio, not a false 100%', () => {
  const facts = [
    { indicator: 'A', applicable: true, direction: DIRECTION.BULLISH },
    { indicator: 'B', applicable: true, direction: DIRECTION.BULLISH },
    { indicator: 'C', applicable: true, direction: DIRECTION.BEARISH },
    { indicator: 'D', applicable: true, direction: DIRECTION.BULLISH },
  ];
  const agreement = computeAgreement(facts);
  assert.equal(agreement.bullish, 3);
  assert.equal(agreement.bearish, 1);
  assert.equal(agreement.agreementRatio, 0.75);
  assert.equal(agreement.label, '3/4 indicators bullish');
});
