-- Cash/interest tracking, ported from V1's frontend (see engine/portfolio.js
-- computeAccruedInterestEur). V1's total portfolio value includes accrued
-- interest on a EUR cash balance sitting outside the 5 crypto assets — this
-- was the exact, fully-diagnosed source of a ~$37 gap between V4's crypto-only
-- total and V1's displayed total. These columns store that component
-- separately rather than blending it invisibly into total_value_usd.
ALTER TABLE portfolio_snapshots ADD COLUMN cash_interest_usd REAL;
ALTER TABLE portfolio_snapshots ADD COLUMN cash_interest_eur REAL;
ALTER TABLE portfolio_snapshots ADD COLUMN eur_usd_fx REAL;
