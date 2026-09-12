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

- No `regime` segmentation column populated in `performance_metrics` — the
  table supports it (spec section 11 asks for regime-segmented performance)
  but `refreshPerformanceMetrics` only fills asset+horizon for now. Adding
  regime segmentation is a follow-up, not a blocker.
- No audit/transparency API route yet (spec section 23). The raw tables are
  already queryable by anyone with D1 access; a dedicated `/api/audit`
  endpoint that surfaces AI prompt/response metadata is next-iteration work.
