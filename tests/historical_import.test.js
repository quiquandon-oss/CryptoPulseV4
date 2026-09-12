import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileHistoricalMarketData } from '../engine/historical_import.js';

test('reconcileHistoricalMarketData: inserts only missing candles', () => {
  const existing = [
    { ts: 1000, close: 100, source: 'hyperliquid' },
    { ts: 2000, close: 105, source: 'hyperliquid' },
  ];
  const candidate = [
    { ts: 1000, open: 98, high: 101, low: 97, close: 100, volume: 10 },
    { ts: 2000, open: 101, high: 106, low: 100, close: 105, volume: 12 },
    { ts: 3000, open: 105, high: 110, low: 104, close: 108, volume: 15 },
  ];

  const result = reconcileHistoricalMarketData(existing, candidate, 'hyperliquid_historical');
  assert.equal(result.receivedCount, 3);
  assert.equal(result.insertedCount, 1);
  assert.equal(result.duplicatesCount, 2);
  assert.equal(result.conflictCount, 0);
  assert.equal(result.toInsert[0].ts, 3000);
});

test('reconcileHistoricalMarketData: preserves existing records on conflict and logs discrepancy', () => {
  const existing = [
    { ts: 1000, close: 100.0, source: 'v4_native' },
  ];
  const candidate = [
    { ts: 1000, open: 98, high: 103, low: 97, close: 102.5, volume: 10 },
  ];

  const result = reconcileHistoricalMarketData(existing, candidate, 'hyperliquid_historical');
  assert.equal(result.insertedCount, 0);
  assert.equal(result.duplicatesCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.conflicts[0].existingClose, 100.0);
  assert.equal(result.conflicts[0].candidateClose, 102.5);
});
