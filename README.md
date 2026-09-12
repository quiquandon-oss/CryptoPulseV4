# CryptoPulse V4 Terminal

A deterministic crypto intelligence terminal for BTC, ETH, and LINK — Cloudflare
Workers + D1 backend, static HTML/JS frontend on GitHub Pages. Completely
independent of CryptoPulse V1/V2/V3: separate Worker, separate D1 database, no
shared write paths.

Deterministic technical/regime/signal engine → the facts. AI explains those
facts; it never invents them. See `project-docs/ARCHITECTURE.md` for the full pipeline
and `project-docs/DATA_CONTRACT.md` for the schema.

## Status

Engine layer (indicators, evidence, regime, signal, outcomes, performance,
freshness, health, AI explanation) is built and unit tested — `npm test`
(62 tests, `node --test`, zero dependencies). Worker API, D1 schema, and the
full 6-page frontend (dashboard, asset detail with a price+signal chart,
performance with asset/horizon/regime/date-range filters, data health, audit,
settings) are built and deployed. Light and dark themes are both implemented
(toggle in the header, or in Settings). **Live**: worker at
`cryptopulse-v4.quiquandon.workers.dev`, site at
`https://quiquandon-oss.github.io/CryptoPulseV4/`.

## Local development

```bash
npm install
npm test                         # run the engine test suite (no network needed)
wrangler dev                     # run the Worker locally
```

## Deploy

1. **Worker** — needs a Cloudflare API token this environment doesn't have:
   ```bash
   wrangler secret put INGEST_TOKEN        # generate any long random string
   wrangler secret put GEMINI_API_KEY      # optional — omit to use the deterministic explanation fallback
   wrangler deploy
   ```
   Or let CI do it: add a `CLOUDFLARE_API_TOKEN` repo secret and push to `main`
   (`.github/workflows/ci-deploy.yml`).

2. **Frontend** — set `window.V4_API_BASE` in `docs/app.js` to the deployed
   Worker URL, then enable GitHub Pages (Settings → Pages → source: `main`
   branch, `/docs` folder).

3. **Scheduling** — add two repo secrets, `V4_WORKER_URL` and
   `V4_INGEST_TOKEN` (the same value as `INGEST_TOKEN` above).
   `.github/workflows/ingest.yml` then calls `POST /api/ingest` hourly. This
   account's 5 Cloudflare Cron Trigger slots are already used by V1/V2, so V4
   deliberately doesn't use one — see `project-docs/ARCHITECTURE.md`.

## Data integrity

No fabricated data, ever. Missing history shows as `null` fields and
`INSUFFICIENT_DATA` / `UNRESOLVED` states, not a plausible-looking guess.
Performance stats are withheld below 20 resolved observations
(`engine/performance.js`, `MIN_SAMPLES`).

## What's next

- Regime-segmented performance has real per-regime rows now, but most
  segments will show "Insufficient evidence" until more signals resolve —
  that's the data-integrity rule working as intended, not a bug.
- Mobile polish pass once real usage surfaces friction.
- Empirical CPU-budget check on `/api/ingest` after more live runs accumulate
  — see the "CPU budget" section in `project-docs/ARCHITECTURE.md`.
