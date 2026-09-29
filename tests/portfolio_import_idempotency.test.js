import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRevolutRows, parseV1Export, dropAlreadyRecorded, computeHoldings } from '../engine/portfolio.js';
import { insertTransactions } from '../worker/portfolio.js';

// Regression: Revolut rows were imported again, under a fresh id, on every import
// (the id embedded the FX-converted price), and also overlapped V1-export rows for
// the same event. Live effect: BTC +0.00043094 and LINK +3.11297 over-counted.

const REWARD_ROW = { Symbol: 'BTC', Type: 'Buy', Quantity: '0.00002927', Price: '€67,000.00', Date: 'Sep 9, 2026, 1:53:02 AM' };

function fakeDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        bind: (...args) => ({ sql, args }),
        all: async () => ({
          results: rows.map((r) => ({
            id: r.id, asset_id: r.asset_id, account: r.account, transaction_type: r.transaction_type,
            quantity: r.quantity, unit_price_usd: r.unit_price_usd, fees: 0,
            transaction_timestamp: r.transaction_timestamp, source: r.source,
          })),
        }),
      };
    },
    async batch(stmts) {
      return stmts.map(({ args }) => {
        const [id, asset_id, account, transaction_type, quantity, unit_price_usd, , transaction_timestamp, source] = args;
        if (rows.some((r) => r.id === id)) return { meta: { changes: 0 } };
        rows.push({ id, asset_id, account, transaction_type, quantity, unit_price_usd, transaction_timestamp, source });
        return { meta: { changes: 1 } };
      });
    },
  };
}

test('parseRevolutRows: sourceId does not change when the supplied EUR->USD rate changes', () => {
  const [a] = parseRevolutRows([REWARD_ROW], 1.10);
  const [b] = parseRevolutRows([REWARD_ROW], 1.17);
  assert.notEqual(a.unitPriceUsd, b.unitPriceUsd);
  assert.equal(a.sourceId, b.sourceId);
});

test('insertTransactions: re-importing the same Revolut statement at a different FX rate adds nothing', async () => {
  const db = fakeDb();
  const first = await insertTransactions(db, parseRevolutRows([REWARD_ROW], 1.10));
  const second = await insertTransactions(db, parseRevolutRows([REWARD_ROW], 1.14));
  const third = await insertTransactions(db, parseRevolutRows([REWARD_ROW], 1.17));
  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(third.inserted, 0);
  assert.equal(db.rows.length, 1);
});

test('insertTransactions: a Revolut row already present as a V1-export row (midnight timestamp) is not added again', async () => {
  const db = fakeDb();
  await insertTransactions(db, parseV1Export([
    { id: 'x1', date: '2026-09-09', asset: 'BTC', acct: 'Revolut', type: 'buy', qty: 0.00002927, usd: 79000 },
  ]));
  const res = await insertTransactions(db, parseRevolutRows([REWARD_ROW], 1.14));
  assert.equal(res.inserted, 0);
  assert.equal(res.alreadyRecorded, 1);
  assert.equal(db.rows.length, 1);
});

test('insertTransactions: a row already stored under the OLD price-based id is not duplicated by a re-import', async () => {
  const db = fakeDb();
  const [tx] = parseRevolutRows([REWARD_ROW], 1.10);
  db.rows.push({
    id: `rev_BTC_${tx.timestamp}_0.00002927_${tx.unitPriceUsd}`, asset_id: 'BTC', account: 'Revolut',
    transaction_type: 'BUY', quantity: 0.00002927, unit_price_usd: tx.unitPriceUsd,
    transaction_timestamp: tx.timestamp, source: 'REVOLUT',
  });
  const res = await insertTransactions(db, parseRevolutRows([REWARD_ROW], 1.17));
  assert.equal(res.inserted, 0);
  assert.equal(db.rows.length, 1);
});

test('insertTransactions: two genuinely separate same-day, same-size purchases are BOTH kept on first import', async () => {
  const db = fakeDb();
  const rows = [
    { Symbol: 'LINK', Type: 'Buy', Quantity: '1', Price: '€10.00', Date: 'Sep 9, 2026, 9:00:00 AM' },
    { Symbol: 'LINK', Type: 'Buy', Quantity: '1', Price: '€10.00', Date: 'Sep 9, 2026, 6:00:00 PM' },
  ];
  const res = await insertTransactions(db, parseRevolutRows(rows, 1.14));
  assert.equal(res.inserted, 2);
  const again = await insertTransactions(db, parseRevolutRows(rows, 1.14));
  assert.equal(again.inserted, 0);
  assert.equal(db.rows.length, 2);
});

test('insertTransactions: a genuinely new purchase of the same size on a different day is still imported', async () => {
  const db = fakeDb();
  await insertTransactions(db, parseRevolutRows([REWARD_ROW], 1.14));
  const nextDay = { ...REWARD_ROW, Date: 'Sep 10, 2026, 1:53:02 AM' };
  const res = await insertTransactions(db, parseRevolutRows([nextDay], 1.14));
  assert.equal(res.inserted, 1);
  assert.equal(db.rows.length, 2);
});

test('holdings after repeated imports at different FX rates equal a single import', async () => {
  const db = fakeDb();
  for (const rate of [1.10, 1.12, 1.14, 1.17, 1.15]) {
    await insertTransactions(db, parseRevolutRows([REWARD_ROW], rate));
  }
  const holdings = computeHoldings(db.rows.map((r) => ({
    asset: r.asset_id, type: r.transaction_type, quantity: r.quantity, unitPriceUsd: r.unit_price_usd, timestamp: r.transaction_timestamp,
  })));
  assert.equal(holdings.BTC.quantity, 0.00002927);
});

test('dropAlreadyRecorded: each recorded row absorbs at most one incoming row', () => {
  const day = Date.parse('2026-09-09T00:00:00Z');
  const tx = (ts) => ({ asset: 'LINK', account: 'Revolut', type: 'BUY', quantity: 1, timestamp: ts });
  const { fresh, alreadyRecorded } = dropAlreadyRecorded([tx(day + 1000), tx(day + 2000)], [tx(day)]);
  assert.equal(alreadyRecorded.length, 1);
  assert.equal(fresh.length, 1);
});
