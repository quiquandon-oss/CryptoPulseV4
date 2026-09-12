# CryptoPulse V4 — Data Baseline Checkpoint

Date of Audit: 2026-09-12

## Production Database Baseline (Live V4 D1)

### Table Row Counts & Coverage

| Table / Entity | Verified Status | Baseline Count / Range | Source / Details |
|---|---|---|---|
| `portfolio_transactions` | Verified | 496 rows | Range: 1775779200000 (2026-04-10) -> 1789084800000 (2026-09-11) \| Source: `V1_EXPORT` |
| `portfolio_snapshots` | Verified | 2 rows | Range: 1789212232214 -> 1789212769984 |
| `portfolio_asset_snapshots` | Verified | Active | Asset breakdown for BTC, ETH, SOL, LINK, HYPE |
| `signals` | Verified | 12+ rows | Earliest baseline signal ts: 1789192800000 |
| `assets` | Verified | 3 signals assets (BTC, ETH, LINK) + 5 portfolio assets (BTC, ETH, SOL, LINK, HYPE) |
| `system_health` | Verified | 4 components (market_data_BTC, market_data_ETH, market_data_LINK, database) |

### Non-Destructive Invariant

All subsequent migrations, backfills, and calculations MUST NOT delete, drop, or overwrite any of these 496 portfolio transaction records, existing signal records, or snapshots.
