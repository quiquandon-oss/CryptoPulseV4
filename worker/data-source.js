// worker/data-source.js
//
// Market data via Hyperliquid's public candleSnapshot endpoint — permissionless,
// no API key, already proven in this account's V1 infra (see project memory).
// Returns candles oldest-first: { ts, open, high, low, close, volume }.

const HYPERLIQUID_URL = 'https://api.hyperliquid.xyz/info';

/**
 * @param coin       Hyperliquid coin symbol, e.g. 'BTC'
 * @param interval   '1h', '15m', etc.
 * @param lookbackMs how far back to request
 */
export async function fetchCandles(coin, interval, lookbackMs, fetchImpl = fetch, now = Date.now()) {
  const body = {
    type: 'candleSnapshot',
    req: { coin, interval, startTime: now - lookbackMs, endTime: now },
  };

  const res = await fetchImpl(HYPERLIQUID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status} for ${coin}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`Unexpected Hyperliquid response for ${coin}`);

  return raw
    .map((c) => ({
      ts: c.t,
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      volume: Number(c.v),
    }))
    .sort((a, b) => a.ts - b.ts);
}

/** Fetches candles for every configured asset; a failure on one asset never blocks the others. */
export async function fetchAllCandles(assets, interval, lookbackMs, fetchImpl = fetch) {
  const results = {};
  for (const asset of assets) {
    try {
      results[asset.id] = { ok: true, candles: await fetchCandles(asset.source_id, interval, lookbackMs, fetchImpl) };
    } catch (err) {
      results[asset.id] = { ok: false, error: String(err) };
    }
  }
  return results;
}
