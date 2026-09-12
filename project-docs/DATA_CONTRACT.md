# CryptoPulse V4 — Data Contract

Database: `cryptopulse-v4` (D1, uuid `5faaf930-ea76-41d3-bef2-df630ff11875`).
Schema source of truth: `migrations/0001_init.sql`.

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `assets` | Static list of tracked assets (BTC, ETH, LINK) | migration (seed) | all API routes |
| `market_observations` | Raw hourly candles from Hyperliquid | `worker/ingest.js` | outcome resolution, history |
| `technical_indicators` | One snapshot per asset per evaluation | `worker/ingest.js` | `/api/assets/:asset` |
| `market_regimes` | Regime classification per evaluation | `worker/ingest.js` | `/api/assets/:asset` |
| `signals` | The transparent V4 signal record | `worker/ingest.js` | `/api/market/overview`, `/api/signals*` |
| `signal_indicators` | Per-indicator facts backing a signal (the "Why?" panel) | `worker/ingest.js` | `/api/assets/:asset` |
| `signal_outcomes` | 12h/24h resolution status per signal | `worker/ingest.js` (create), `resolveDueOutcomes` (update) | performance metrics |
| `performance_metrics` | Precomputed win rate / return stats per asset+horizon | `refreshPerformanceMetrics` | `/api/assets/:asset/performance` |
| `system_health` | Per-component freshness/status | `worker/ingest.js` | `/api/health` |
| `ai_explanations` | AI layer output, kept separate from calculated evidence | `worker/ingest.js` (only if `GEMINI_API_KEY` set) | `/api/assets/:asset` |
| `portfolio_transactions` | Imported BUY/SELL history, deduped by deterministic source id | `POST /api/portfolio/import` | holdings calculation |
| `portfolio_snapshots` | Total portfolio value/P&L at a point in time | computed on import + each ingest cycle | `/api/portfolio/history` |
| `portfolio_asset_snapshots` | Per-asset value/P&L at a point in time | same as above | (not yet exposed via API — data exists for a future per-asset history chart) |

## Portfolio scope

Fixed to 5 assets (`engine/portfolio.js` `TRACKED_ASSETS`): BTC, ETH, SOL,
LINK, HYPE — matching what V1 already tracks. Confirmed explicitly with the
user rather than inferred from statement contents, which include many other
assets that are deliberately not part of the portfolio feature.

## Timestamps

All `ts` / `target_ts` columns are unix milliseconds. `created_at` /
`updated_at` / `resolved_at` are `datetime('now')` (UTC, D1 default).

## IDs

Deterministic, not random: `{asset_id}_{ts}` for per-evaluation rows,
`{signal_id}_{horizon}` for outcomes. This makes re-running an ingest cycle
for the same candle idempotent (`INSERT OR IGNORE` / `INSERT OR REPLACE`
depending on whether re-computation should overwrite).

## Outcome status lifecycle

```
GENERATED  --(target_ts reached, matching observation found)-->  RESOLVED
GENERATED  --(target_ts reached, no observation within 90min)-->  UNRESOLVED
UNRESOLVED --(still no observation after a 6h grace period)-->    INSUFFICIENT_DATA
UNRESOLVED --(observation arrives within the grace period)-->     RESOLVED
```

See `engine/outcomes.js` for the exact tolerance/grace constants.

## What's intentionally NOT in this schema yet

- `portfolio_asset_snapshots` is written but not yet read by any API route —
  it's there for a future per-asset value-history chart on the asset detail
  page, not wasted effort, just not wired up to a UI yet.
- No historical backfill of V4's own `portfolio_snapshots` — it only
  accumulates from whenever a snapshot is first computed here, deliberately
  not importing V1's `portfolio_snapshots` history to preserve isolation.
- Portfolio benchmark comparison (vs BTC) and cumulative P/L have no
  supporting table yet — both are computable from existing data when built.
