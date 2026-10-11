// Portfolio privacy: every GET /api/portfolio* needs Bearer PORTFOLIO_READ_TOKEN;
// market/signal endpoints stay public; portfolio responses are private/no-store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const TOKEN = 'test-read-token-123';
const TX = [{ id: 'a1', asset_id: 'BTC', account: 'Revolut', transaction_type: 'BUY', quantity: 0.1, unit_price_usd: 60000,
  fees: 1, transaction_timestamp: 1, source: 'MANUAL' }];

function fakeDb() {
  return { prepare(sql) {
    const q = { bind() { return q; },
      async all() { return { results: /FROM portfolio_transactions/.test(sql) ? TX : [] }; },
      async first() { return /FROM signals/.test(sql) ? { id: 'BTC_1', asset_id: 'BTC', ts: 1, direction: 'NEUTRAL' } : null; },
      async run() { return {}; } };
    return q;
  } };
}
const env = (extra = {}) => ({ DB: fakeDb(), PORTFOLIO_READ_TOKEN: TOKEN, ...extra });
const req = (path, { token, method = 'GET' } = {}) =>
  new Request(`https://w.example${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

const PORTFOLIO_GETS = ['/api/portfolio', '/api/portfolio/assets', '/api/portfolio/transactions', '/api/portfolio/history',
  '/api/portfolio/allocation', '/api/portfolio/benchmark', '/api/portfolio/insights', '/api/portfolio/data-health',
  '/api/portfolio/prediction-funnel'];

test('anonymous and wrong-token requests to every portfolio GET return 401, private and no-store', async () => {
  for (const path of PORTFOLIO_GETS) {
    for (const token of [undefined, 'wrong-token', TOKEN + 'x']) {
      const res = await worker.fetch(req(path, { token }), env());
      assert.equal(res.status, 401, `${path} token=${token}`);
      assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await res.json(), { error: 'unauthorized' });
    }
  }
});

test('fails closed with 503 when PORTFOLIO_READ_TOKEN is not configured', async () => {
  const res = await worker.fetch(req('/api/portfolio/transactions', { token: 'anything' }), env({ PORTFOLIO_READ_TOKEN: undefined }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'portfolio_read_not_configured' });
});

test('the correct token returns the data with private, no-store and Vary: Authorization', async () => {
  const res = await worker.fetch(req('/api/portfolio/transactions', { token: TOKEN }), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('Vary'), 'Authorization');
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.transactions[0].account, 'Revolut');
});

test('non-GET methods on portfolio read paths no longer return data', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const res = await worker.fetch(req('/api/portfolio/transactions', { method }), env());
    assert.equal(res.status, 404, method);
  }
});

test('asset detail stays public but omits the position without the token', async () => {
  const anon = await worker.fetch(req('/api/assets/BTC'), env());
  assert.equal(anon.status, 200);
  const a = await anon.json();
  assert.equal(a.position, null);
  assert.equal(a.position_requires_auth, true);
  assert.notEqual(anon.headers.get('Cache-Control'), 'private, no-store');
});

test('market and signal endpoints remain public (no 401)', async () => {
  for (const path of ['/api/signals', '/api/performance', '/api/health']) {
    const res = await worker.fetch(req(path), env());
    assert.notEqual(res.status, 401, path);
    assert.notEqual(res.status, 503, path);
  }
});
