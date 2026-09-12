// tests/data-source.test.js
//
// These exist specifically because fetchHistoricalEurUsdRate's URL was wrong
// (date as a path segment instead of a query param) for an entire backfill
// run and nothing caught it — the fallback made it "succeed" silently. A
// mock fetch that asserts on the exact URL requested is the only way this
// class of bug gets caught before it reaches production again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEurUsdRate, fetchHistoricalEurUsdRate } from '../worker/data-source.js';

test('fetchEurUsdRate: requests the current-rate endpoint with no date parameter', async () => {
  let requestedUrl = null;
  const mockFetch = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ base: 'EUR', quote: 'USD', rate: 1.1618 }) };
  };
  const rate = await fetchEurUsdRate(mockFetch);
  assert.equal(requestedUrl, 'https://api.frankfurter.dev/v2/rate/EUR/USD');
  assert.equal(rate, 1.1618);
});

test('fetchEurUsdRate: falls back to the hardcoded FX0 rate if the live fetch fails', async () => {
  const mockFetch = async () => ({ ok: false, status: 500 });
  const rate = await fetchEurUsdRate(mockFetch);
  assert.equal(rate, 1.1385);
});

test('fetchHistoricalEurUsdRate: passes the date as a query parameter, not a path segment', async () => {
  let requestedUrl = null;
  const mockFetch = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ base: 'EUR', quote: 'USD', rate: 1.16, date: '2026-06-01' }) };
  };
  const rate = await fetchHistoricalEurUsdRate('2026-06-01', mockFetch);
  assert.equal(requestedUrl, 'https://api.frankfurter.dev/v2/rate/EUR/USD?date=2026-06-01');
  assert.equal(rate, 1.16);
});

test('fetchHistoricalEurUsdRate: falls back to V1\u2019s monthly-bucket approximation if the live fetch fails', async () => {
  const mockFetch = async () => ({ ok: false, status: 404 });
  assert.equal(await fetchHistoricalEurUsdRate('2026-04-15', mockFetch), 1.175);
  assert.equal(await fetchHistoricalEurUsdRate('2026-05-15', mockFetch), 1.16);
  assert.equal(await fetchHistoricalEurUsdRate('2026-08-15', mockFetch), 1.145);
});

test('fetchHistoricalEurUsdRate: also falls back on an unexpected response shape, not just a network error', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ unexpected: true }) });
  assert.equal(await fetchHistoricalEurUsdRate('2026-04-15', mockFetch), 1.175);
});
