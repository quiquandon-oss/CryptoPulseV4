import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileHistoricalMarketData } from '../engine/historical_import.js';

test('reconcileHistoricalMarketData: identical OHLCV is classified as duplicate', () => {
  const existing = [
    { ts: 1000, open: 100, high: 105, low: 99, close: 102, volume: 50, source: 'v4_native' },
  ];
  const candidate = [
    { ts: 1000, open: 100, high: 105, low: 99, close: 102, volume: 50 },
    { ts: 2000, open: 102, high: 108, low: 101, close: 107, volume: 60 },
  ];

  const result = reconcileHistoricalMarketData(existing, candidate, 'hyperliquid_historical');
  assert.equal(result.receivedCount, 2);
  assert.equal(result.insertedCount, 1);
  assert.equal(result.duplicatesCount, 1);
  assert.equal(result.conflictCount, 0);
  assert.equal(result.toInsert[0].ts, 2000);
});

test('reconcileHistoricalMarketData: same close but different OHLC is classified as CONFLICT', () => {
  const existing = [
    { ts: 1000, open: 100, high: 105, low: 99, close: 102, volume: 50, source: 'v4_native' },
  ];
  const candidate = [
    // Open is 101 instead of 100
    { ts: 1000, open: 101, high: 105, low: 99, close: 102, volume: 50 },
  ];

  const result = reconcileHistoricalMarketData(existing, candidate, 'hyperliquid_historical');
  assert.equal(result.insertedCount, 0);
  assert.equal(result.duplicatesCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.conflicts[0].fieldDiscrepancies.open, true);
  assert.equal(result.conflicts[0].fieldDiscrepancies.close, false);
});

test('reconcileHistoricalMarketData: different volume is classified as CONFLICT', () => {
  const existing = [
    { ts: 1000, open: 100, high: 105, low: 99, close: 102, volume: 50, source: 'v4_native' },
  ];
  const candidate = [
    { ts: 1000, open: 100, high: 105, low: 99, close: 102, volume: 75 },
  ];

  const result = reconcileHistoricalMarketData(existing, candidate, 'hyperliquid_historical');
  assert.equal(result.insertedCount, 0);
  assert.equal(result.duplicatesCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.conflicts[0].fieldDiscrepancies.volume, true);
});

test('reconcileHistoricalMarketData: genuine conflict preserves existing V4 record', () => {
  const existing = [
    { ts: 1000, open: 100, high: 105, low: 99, close: 102, volume: 50, source: 'v4_native' },
  ];
  const candidate = [
    { ts: 1000, open: 105, high: 110, low: 100, close: 108, volume: 80 },
  ];

  const result = reconcileHistoricalMarketData(existing, candidate, 'hyperliquid_historical');
  assert.equal(result.insertedCount, 0);
  assert.equal(result.duplicatesCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.conflicts[0].existing.close, 102);
  assert.equal(result.conflicts[0].candidate.close, 108);
});
