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

/**
 * Live EUR->USD rate via Frankfurter (same source and fallback V1 uses:
 * FX0=1.1385). Used only for the ported cash-interest figure — the crypto
 * asset conversions elsewhere in this app don't need this, since portfolio
 * prices are already fetched directly in USD.
 */
export async function fetchEurUsdRate(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('https://api.frankfurter.dev/v2/rate/EUR/USD');
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const json = await res.json();
    if (typeof json.rate !== 'number') throw new Error('Unexpected Frankfurter response shape');
    return json.rate;
  } catch {
    return 1.1385; // V1's own hardcoded fallback (FX0) — kept identical for consistency
  }
}
/**
 * Historical EUR->USD rate for a specific date, via Frankfurter's date-scoped
 * endpoint. Falls back to V1's own hardcoded monthly-bucket approximation
 * (ported verbatim: <=Apr 1.175, May 1.16, else 1.145) if the live historical
 * lookup fails — a real historical rate is preferred when available, but a
 * rough-but-reasonable fallback beats leaving a backfilled day's interest
 * conversion silently wrong.
 */
export async function fetchHistoricalEurUsdRate(dateStr, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://api.frankfurter.dev/v2/${dateStr}/rate/EUR/USD`);
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const json = await res.json();
    if (typeof json.rate !== 'number') throw new Error('Unexpected Frankfurter response shape');
    return json.rate;
  } catch {
    const month = Number(dateStr.slice(5, 7));
    return month <= 4 ? 1.175 : month === 5 ? 1.16 : 1.145;
  }
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
