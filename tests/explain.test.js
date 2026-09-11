import test from 'node:test';
import assert from 'node:assert/strict';
import { explainSignal, buildDeterministicExplanation, buildExplanationPrompt } from '../engine/explain.js';

const facts = {
  asset: 'BTC',
  price: 65000,
  indicators: [
    { indicator: 'RSI', applicable: true, direction: 'BULLISH', interpretation: 'RSI 62 — neutral, bullish of the midline' },
    { indicator: 'SMA', applicable: true, direction: 'BULLISH', interpretation: 'Price above SMA20' },
    { indicator: 'MACD', applicable: true, direction: 'BEARISH', interpretation: 'MACD histogram negative' },
  ],
  regime: { regime: 'TRENDING_BULLISH', basis: 'price > SMA20 > SMA50' },
  signal: { direction: 'BULLISH', score: 1, evidenceLabel: '2/3 indicators bullish', risk: 'MEDIUM', persistenceCount: 2, stability: 'STABLE' },
};

test('explainSignal: without an API key, uses the deterministic fallback and never calls fetch', async () => {
  let called = false;
  const result = await explainSignal(facts, null, async () => { called = true; });
  assert.equal(called, false);
  assert.equal(result.model, 'deterministic-fallback');
});

test('buildDeterministicExplanation: supports/contradicts are drawn only from real indicator facts', () => {
  const result = buildDeterministicExplanation(facts);
  assert.equal(result.supports.length, 2); // RSI, SMA
  assert.equal(result.contradicts.length, 1); // MACD
  assert.ok(result.supports.every((s) => facts.indicators.some((i) => i.interpretation === s)));
});

test('explainSignal: falls back deterministically (without throwing) if the AI call fails', async () => {
  const failingFetch = async () => ({ ok: false, status: 500 });
  const result = await explainSignal(facts, 'fake-key', failingFetch);
  assert.equal(result.model, 'deterministic-fallback');
  assert.ok('aiError' in result);
});

test('explainSignal: parses a successful Gemini-style response into the four fields', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '1. RSI and SMA both bullish.\n2. MACD histogram is negative.\n3. Risk is MEDIUM given 2/3 agreement.\n4. A close back below SMA20 would invalidate this.' }] } }],
    }),
  });
  const result = await explainSignal(facts, 'fake-key', fakeFetch);
  assert.equal(result.model, 'gemini-3.6-flash');
  assert.equal(result.supports[0], 'RSI and SMA both bullish.');
  assert.equal(result.invalidation, 'A close back below SMA20 would invalidate this.');
});

test('buildExplanationPrompt: only includes facts that were actually passed in, never invents figures', () => {
  const prompt = buildExplanationPrompt(facts);
  assert.match(prompt, /Do not invent numbers/);
  assert.match(prompt, /BTC/);
  assert.match(prompt, /65000/);
});
