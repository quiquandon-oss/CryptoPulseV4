// worker/index.js
//
// CryptoPulse V4 API. Deployed independently of V1 (sentiment-ff75) and
// V2 (pulseworker-v2) — separate script, separate D1 database, zero shared
// write paths. See docs/ARCHITECTURE.md.
//
// Scheduling: deliberately has NO [triggers] in wrangler.toml. This account's
// 5 Cron Trigger slots are already used by V1 (3) and V2 (2). Instead,
// .github/workflows/ingest.yml calls POST /api/ingest on a schedule.

import * as db from './db.js';
import { runIngestCycle } from './ingest.js';
import { aggregateHealth } from '../engine/health.js';
import { computePerformance } from '../engine/performance.js';
import {
  parseNeverlessCSV, parseRevolutRows, parseV1Export, computeHoldings,
  computePortfolioSummary, computeNormalizedBenchmark, computePortfolioInsights, TRACKED_ASSETS,
} from '../engine/portfolio.js';
import * as portfolio from './portfolio.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    try {
      if (parts[0] !== 'api') return json({ error: 'not found' }, 404);

      if (parts[1] === 'ingest' && request.method === 'POST') {
        return await handleIngest(request, env);
      }
      if (parts[1] === 'health' && !parts[2]) {
        return await handleHealth(env);
      }
      if (parts[1] === 'signals' && parts[2]) {
        return await handleSignalDetail(env, parts[2]);
      }
      if (parts[1] === 'signals') {
        return await handleSignalsList(env, url);
      }
      if (parts[1] === 'market' && parts[2] === 'overview') {
        return await handleMarketOverview(env);
      }
      if (parts[1] === 'performance') {
        return await handlePerformanceList(env, url);
      }
      if (parts[1] === 'portfolio' && parts[2] === 'import' && request.method === 'POST') {
        return await handlePortfolioImport(request, env);
      }
      if (parts[1] === 'portfolio' && parts[2] === 'assets') {
        return await handlePortfolioAssets(env);
      }
      if (parts[1] === 'portfolio' && parts[2] === 'history') {
        return await handlePortfolioHistory(env, url);
      }
      if (parts[1] === 'portfolio' && parts[2] === 'allocation') {
        return await handlePortfolioAllocation(env);
      }
      if (parts[1] === 'portfolio' && parts[2] === 'benchmark') {
        return await handlePortfolioBenchmark(env, url);
      }
      if (parts[1] === 'portfolio' && parts[2] === 'insights') {
        return await handlePortfolioInsightsEndpoint(env);
      }
      if (parts[1] === 'portfolio' && parts[2] === 'data-health') {
        return await handlePortfolioDataHealth(env);
      }
      if (parts[1] === 'portfolio' && !parts[2]) {
        return await handlePortfolioSummary(env);
      }
      if (parts[1] === 'assets' && parts[2] && parts[3] === 'history') {
        return await handleAssetHistory(env, parts[2], url);
      }
      if (parts[1] === 'assets' && parts[2] && parts[3] === 'performance') {
        return await handleAssetPerformance(env, parts[2]);
      }
      if (parts[1] === 'assets' && parts[2]) {
        return await handleAssetDetail(env, parts[2]);
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: 'internal_error', detail: String(err) }, 500);
    }
  },
};

async function handleIngest(request, env) {
  const auth = request.headers.get('Authorization');
  if (!env.INGEST_TOKEN || auth !== `Bearer ${env.INGEST_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  const summary = await runIngestCycle(env);
  return json({ ok: true, summary });
}

async function handleHealth(env) {
  const rows = await db.getAllHealth(env.DB);
  const aggregate = aggregateHealth(rows.map((r) => ({ component: r.component, status: r.status })));
  return json({ ...aggregate, detail: rows });
}

async function handleMarketOverview(env) {
  const assets = await db.listAssets(env.DB);
  const overview = [];
  for (const asset of assets) {
    const signal = await db.getLastSignal(env.DB, asset.id);
    overview.push({
      asset: asset.id,
      name: asset.name,
      signal: signal ? {
        direction: signal.direction, score: signal.score, evidenceLabel: signal.evidence_label,
        regime: signal.regime, risk: signal.risk, persistenceCount: signal.persistence_count,
        stability: signal.stability, ts: signal.ts,
      } : null,
    });
  }
  return json({ overview });
}

async function handleAssetDetail(env, assetId) {
  const signal = await db.getLastSignal(env.DB, assetId.toUpperCase());
  if (!signal) return json({ error: 'no signal yet for this asset' }, 404);
  const indicators = await env.DB
    .prepare('SELECT * FROM signal_indicators WHERE signal_id = ?').bind(signal.id).all();
  const explanation = await env.DB
    .prepare('SELECT * FROM ai_explanations WHERE signal_id = ?').bind(signal.id).first();

  let position = null;
  const transactions = await portfolio.getAllTransactions(env.DB);
  if (transactions.some((t) => t.asset === assetId.toUpperCase())) {
    const holdings = computeHoldings(transactions);
    const prices = await portfolio.getCurrentPrices(env);
    const summary = computePortfolioSummary(holdings, prices);
    position = summary.byAsset.find((r) => r.asset === assetId.toUpperCase()) ?? null;
  }

  return json({ signal, indicators: indicators.results, explanation: explanation ?? null, position });
}

async function handleAssetHistory(env, assetId, url) {
  const range = url.searchParams.get('range') || '24h';
  const rangeMs = { '12h': 12, '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '1y': 24 * 365, 'all': 24 * 365 * 3 }[range.toLowerCase()] * 3_600_000 || (24 * 3600000);
  const since = Date.now() - rangeMs;
  const { results } = await env.DB
    .prepare(`SELECT s.ts, s.direction, s.score, s.regime, ti.price
              FROM signals s
              LEFT JOIN technical_indicators ti ON ti.asset_id = s.asset_id AND ti.ts = s.ts
              WHERE s.asset_id = ? AND s.ts >= ? ORDER BY s.ts ASC`)
    .bind(assetId.toUpperCase(), since).all();
  return json({ asset: assetId.toUpperCase(), range, points: results });
}

async function handleAssetPerformance(env, assetId) {
  const rows = await db.getPerformanceMetrics(env.DB, assetId.toUpperCase());
  return json({ asset: assetId.toUpperCase(), performance: rows });
}

async function handlePerformanceList(env, url) {
  const assetId = url.searchParams.get('asset')?.toUpperCase() || null;
  const horizon = url.searchParams.get('horizon') || null;
  const regime = url.searchParams.get('regime') || null;
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');

  if (since || until) {
    const outcomes = await db.getResolvedOutcomesWithRegime(env.DB, { assetId, horizon });
    const sinceTs = since ? Date.parse(since) : -Infinity;
    const untilTs = until ? Date.parse(until) : Infinity;
    const filtered = outcomes.filter((o) =>
      o.target_ts >= sinceTs && o.target_ts <= untilTs && (!regime || regime === 'ALL' || o.signal_regime === regime));
    const perf = computePerformance(filtered.map((o) => ({ actualReturn: o.actual_return, success: o.success === null ? null : !!o.success })));
    return json({ performance: [{ asset_id: assetId, horizon, regime: regime || 'ALL', ...perf, computed_at: new Date().toISOString(), ad_hoc: true }] });
  }

  const rows = await db.listPerformanceMetrics(env.DB, { assetId, horizon, regime });
  return json({ performance: rows });
}

async function handleSignalsList(env, url) {
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const { results } = await env.DB
    .prepare('SELECT * FROM signals ORDER BY ts DESC LIMIT ?').bind(limit).all();
  return json({ signals: results });
}

async function handleSignalDetail(env, signalId) {
  const signal = await env.DB.prepare('SELECT * FROM signals WHERE id = ?').bind(signalId).first();
  if (!signal) return json({ error: 'not found' }, 404);
  const indicators = await env.DB.prepare('SELECT * FROM signal_indicators WHERE signal_id = ?').bind(signalId).all();
  const outcomes = await env.DB.prepare('SELECT * FROM signal_outcomes WHERE signal_id = ?').bind(signalId).all();
  const explanation = await env.DB.prepare('SELECT * FROM ai_explanations WHERE signal_id = ?').bind(signalId).first();
  return json({ signal, indicators: indicators.results, outcomes: outcomes.results, explanation: explanation ?? null });
}

// --- Portfolio ---------------------------------------------------------

async function handlePortfolioImport(request, env) {
  const auth = request.headers.get('Authorization');
  if (!env.INGEST_TOKEN || auth !== `Bearer ${env.INGEST_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const { format, rows } = body;
  if (!Array.isArray(rows)) return json({ error: 'rows must be an array' }, 400);

  let transactions;
  if (format === 'neverless_csv') {
    transactions = parseNeverlessCSV(rows);
  } else if (format === 'revolut_xlsx') {
    const rate = Number(body.eurUsdRate) || 1.10;
    transactions = parseRevolutRows(rows, rate);
  } else if (format === 'v1_export') {
    transactions = parseV1Export(rows);
  } else {
    return json({ error: "format must be 'neverless_csv', 'revolut_xlsx', or 'v1_export'" }, 400);
  }

  if (!transactions.length) {
    return json({ ok: true, message: 'No tracked-asset transactions found in the uploaded rows.', received: rows.length, extracted: 0, inserted: 0 });
  }

  const result = await portfolio.insertTransactions(env.DB, transactions);
  const summary = await portfolio.computeAndStoreSnapshot(env);
  return json({ ok: true, receivedRows: rows.length, extracted: transactions.length, ...result, summary });
}

async function handlePortfolioSummary(env) {
  const transactions = await portfolio.getAllTransactions(env.DB);
  if (!transactions.length) {
    return json({ hasData: false, message: 'No portfolio transactions imported yet.', trackedAssets: TRACKED_ASSETS });
  }
  const holdings = computeHoldings(transactions);
  const prices = await portfolio.getCurrentPrices(env);
  const summary = computePortfolioSummary(holdings, prices);
  return json({ hasData: true, ...summary, trackedAssets: TRACKED_ASSETS });
}

async function handlePortfolioAssets(env) {
  const transactions = await portfolio.getAllTransactions(env.DB);
  const holdings = computeHoldings(transactions);
  const prices = await portfolio.getCurrentPrices(env);
  const summary = computePortfolioSummary(holdings, prices);
  return json({ assets: summary.byAsset });
}

async function handlePortfolioAllocation(env) {
  const transactions = await portfolio.getAllTransactions(env.DB);
  const holdings = computeHoldings(transactions);
  const prices = await portfolio.getCurrentPrices(env);
  const summary = computePortfolioSummary(holdings, prices);
  return json({
    allocation: summary.byAsset.map((r) => ({ asset: r.asset, value: r.value, allocationPct: r.allocationPct })),
    pricesComplete: summary.pricesComplete,
  });
}

async function handlePortfolioHistory(env, url) {
  const range = url.searchParams.get('range') || 'ALL';
  const rangeMs = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }[range];
  const since = rangeMs ? Date.now() - rangeMs * 86_400_000 : 0;
  const points = await portfolio.getPortfolioHistory(env.DB, since);
  return json({ range, points });
}

async function handlePortfolioBenchmark(env, url) {
  const benchmarkAsset = (url.searchParams.get('benchmark') || 'BTC').toUpperCase();
  const portPoints = await portfolio.getPortfolioHistory(env.DB, 0);
  const { results: btcCandles } = await env.DB
    .prepare('SELECT ts, close FROM market_observations WHERE asset_id = ? ORDER BY ts ASC')
    .bind(benchmarkAsset).all();

  const benchmark = computeNormalizedBenchmark(portPoints, btcCandles);
  return json({ benchmarkAsset, ...benchmark });
}

async function handlePortfolioInsightsEndpoint(env) {
  const transactions = await portfolio.getAllTransactions(env.DB);
  if (!transactions.length) {
    return json({ insights: [] });
  }
  const holdings = computeHoldings(transactions);
  const prices = await portfolio.getCurrentPrices(env);
  const summary = computePortfolioSummary(holdings, prices);
  const insights = computePortfolioInsights(summary);
  return json({ insights });
}

async function handlePortfolioDataHealth(env) {
  const health = await portfolio.getDataHealth(env.DB);
  return json(health);
}
