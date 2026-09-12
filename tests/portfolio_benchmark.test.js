import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNormalizedBenchmark } from '../engine/portfolio.js';

test('computeNormalizedBenchmark: matches exact timestamp benchmark', () => {
  const port = [
    { ts: 1000, total_value_usd: 1000 },
    { ts: 2000, total_value_usd: 1100 },
  ];
  const btc = [
    { ts: 1000, close: 50000 },
    { ts: 2000, close: 55000 },
  ];

  const res = computeNormalizedBenchmark(port, btc);
  assert.equal(res.status, 'OK');
  assert.equal(res.points[0].btcNormalized, 100);
  assert.equal(res.points[1].btcNormalized, 110);
});

test('computeNormalizedBenchmark: matches acceptable nearby timestamp within tolerance', () => {
  const port = [{ ts: 100000, total_value_usd: 1000 }];
  const btc = [{ ts: 100000 + 15 * 60 * 1000, close: 50000 }];

  const res = computeNormalizedBenchmark(port, btc);
  assert.equal(res.status, 'OK');
  assert.equal(res.points[0].btcNormalized, 100);
  assert.equal(res.points[0].btcPrice, 50000);
});

test('computeNormalizedBenchmark: returns INSUFFICIENT_DATA when outside time tolerance', () => {
  const port = [{ ts: 100000, total_value_usd: 1000 }];
  const btc = [{ ts: 100000 + 10 * 3600 * 1000, close: 50000 }];

  const res = computeNormalizedBenchmark(port, btc);
  assert.equal(res.status, 'INSUFFICIENT_DATA');
  assert.match(res.message, /tolerance/);
});

test('computeNormalizedBenchmark: handles missing benchmark data gracefully', () => {
  const port = [{ ts: 100000, total_value_usd: 1000 }];
  const res = computeNormalizedBenchmark(port, []);
  assert.equal(res.status, 'INSUFFICIENT_DATA');
  assert.equal(res.points.length, 0);
});
