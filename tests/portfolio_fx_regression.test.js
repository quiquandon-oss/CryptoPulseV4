import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRevolutRows } from '../engine/portfolio.js';

test('parseRevolutRows: regression test — missing FX rate excludes EUR rows rather than guessing a default rate', () => {
  const rows = [{ Symbol: 'ETH', Type: 'Buy', Quantity: 0.001, Price: '2000', Date: '2026-04-10T15:41:03Z' }];
  const resNull = parseRevolutRows(rows, null);
  assert.equal(resNull.length, 0);

  const resUndefined = parseRevolutRows(rows, undefined);
  assert.equal(resUndefined.length, 0);
});
