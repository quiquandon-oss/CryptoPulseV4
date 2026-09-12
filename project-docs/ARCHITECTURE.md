# CryptoPulse V4 — Architecture

## Isolation

V4 is a completely separate Cloudflare Worker (`cryptopulse-v4`) and D1 database
(`cryptopulse-v4`, uuid `5faaf930-ea76-41d3-bef2-df630ff11875`) from V1
(`sentiment-ff75`) and V2 (`pulseworker-v2`), which both use the shared
`sentiment-history` database. V4 never reads from or writes to `sentiment-history`.
No shared write paths, per the non-negotiable isolation rule.

## Pipeline

```
Hyperliquid candleSnapshot (BTC/ETH/LINK, 1h)
  -> worker/data-source.js        fetch + normalize
  -> engine/indicators.js         RSI, SMA, EMA, MACD, Bollinger, ATR, Ichimoku, momentum, volatility
  -> engine/evidence.js           per-indicator direction + agreement ratio (never called "confidence")
  -> engine/regime.js             deterministic regime classification
  -> engine/signal.js             score, direction, risk, persistence/instability
  -> engine/outcomes.js           12h/24h outcome resolution (zero look-ahead)
  -> engine/performance.js        win rate / avg / median return, gated on MIN_SAMPLES
  -> engine/explain.js            AI explanation layer (Gemini, or deterministic fallback)
  -> D1 (worker/db.js)
  -> API (worker/index.js)
  -> docs/ (static, GitHub Pages)
```

Every engine module is pure (no I/O), and is directly unit tested (`tests/`).
The Worker layer (`worker/`) is the only part that touches D1 or the network.

## Scheduling — why there's no Cron Trigger

This Cloudflare account's Free-tier Cron Trigger budget is 5 per account, and
V1 (3) + V2 (2) already use all 5. `wrangler.toml` deliberately has no
`[triggers]` block. Instead, `.github/workflows/ingest.yml` calls
`POST /api/ingest` on an hourly schedule via GitHub Actions (free, unlimited
minutes on a public repo) — the same external-trigger pattern already used for
PulseWorkerV2's Experiment 4 (TimesFM).

`/api/ingest` is protected by a bearer token (`INGEST_TOKEN` Worker secret),
never a Cloudflare Cron Trigger's implicit trust.

## CPU budget — a known open risk

Workers Free gives ~10ms CPU per HTTP-triggered invocation. One ingest cycle
computes 8 indicators + regime + signal for 3 assets — real work. V2 already
hit `exceededCpu` with less computation per invocation. If Workers Logs show
`outcome=exceededCpu` on `/api/ingest`:

1. Split the loop in `runIngestCycle` into one HTTP call per asset (have
   `ingest.yml` call `/api/ingest?asset=BTC`, `?asset=ETH`, `?asset=LINK`
   separately), or
2. Move to Workers Paid ($5/month minimum — CPU time budget goes from
   milliseconds to seconds).

Don't guess — check the logs first, same as the V2 diagnosis.

## Data integrity rules (non-negotiable)

- No fabricated market data, signals, performance, confidence, health, or AI evidence.
- Missing data shows as missing (`INSUFFICIENT_DATA`, `null` fields), never a
  plausible-looking placeholder.
- `agreement_ratio` is never described as statistical confidence unless a
  calibrated model backs it — it isn't one yet.
- Performance stats are withheld below `MIN_SAMPLES` (engine/performance.js) —
  shown as "Insufficient evidence — N resolved observations."

## Portfolio layer (My Assets)

Scope is fixed to the 5 assets V1 already tracks — BTC, ETH, SOL, LINK, HYPE
(`engine/portfolio.js` `TRACKED_ASSETS`) — confirmed explicitly rather than
inferred from uploaded statements, which contain a much wider set of assets
that are intentionally not tracked here.

```
Neverless CSV / Revolut XLSX (user uploads, parsed client-side into rows)
  -> POST /api/portfolio/import
  -> engine/portfolio.js parseNeverlessCSV / parseRevolutRows (server-side, testable)
  -> worker/portfolio.js insertTransactions (idempotent — id = deterministic sourceId)
  -> engine/portfolio.js computeHoldings (weighted-average cost)
  -> worker/portfolio.js getCurrentPrices (BTC/ETH/LINK from technical_indicators;
     SOL/HYPE via a direct Hyperliquid fetch, since they're outside the signal
     engine's scope — spec section 4 fixes that to BTC/ETH/LINK)
  -> engine/portfolio.js computePortfolioSummary
  -> D1: portfolio_transactions, portfolio_snapshots, portfolio_asset_snapshots
  -> API: /api/portfolio, /api/portfolio/assets, /api/portfolio/history,
          /api/portfolio/allocation, /api/portfolio/data-health
  -> docs/portfolio.html
```

**Historical data reality check** (spec section 6 assumed "April 2025" — verified
against actual data instead of taken on faith): the earliest real data found
anywhere is a wider, non-portfolio account statement from August 2025. The
tracked 5-asset portfolio's own earliest data (V1's `txs_backup`/
`portfolio_snapshots` in `sentiment-history`, and the uploaded Revolut/
Neverless exports) starts April 2026. V4's own `portfolio_snapshots` table
only starts accumulating from whenever a snapshot is first computed here —
it does not backfill V1's history, preserving isolation. A snapshot is
computed once per `/api/portfolio/import` call and once per ingest cycle
is a reasonable follow-up if continuous portfolio-value history matters
more than transaction-derived holdings.

**FX approximation**: Revolut statements are EUR-denominated with no USD
column. `parseRevolutRows` converts using a single supplied rate (not
historical FX at time of purchase) — labelled in the code and the API
response (`priceApproximation` field), never silently treated as precise.

**Not yet built** (see README "What's next"): Cumulative P/L chart, Asset
Performance comparison chart, Portfolio vs BTC benchmark chart, a dedicated
historical-data audit view (beyond what `/api/portfolio/data-health` already
surfaces), and portfolio settings (base currency, benchmark selection).

## Deployment


- **Backend**: `.github/workflows/ci-deploy.yml` runs the engine test suite on
  every push/PR, then runs `wrangler deploy` on push to `main` (needs the
  `CLOUDFLARE_API_TOKEN` repo secret — not something this pipeline can set for
  itself; add it once in GitHub repo settings).
- **Frontend**: `docs/` is static HTML/CSS/JS — deploy via GitHub Pages
  (Settings → Pages → source: `main` branch, `/docs` folder). Legacy Pages
  builds only accept `/` or `/docs` as a path — that's why the site lives in
  `docs/` rather than `frontend/`, and why engineering docs moved to
  `project-docs/` instead. Set `window.V4_API_BASE` in `docs/app.js` to the
  deployed Worker's
  URL after the first `wrangler deploy`.
