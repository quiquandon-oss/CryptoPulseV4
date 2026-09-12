// engine/market_pulse.js
//
// Market Pulse composite — Option B (hybrid, disclosed), per the approved
// methodology. Combines two "halves" weighted 50/50:
//   - deterministic: V4's own regime classification + cycle position (ATH
//     drawdown vs. historical bottom band) — fully mechanical, no V1/AI input.
//   - disclosed: V1's Sentiment composite + Cycle/Regime conviction, imported
//     (never called live) — explicitly NOT purely mechanical: V1's Sentiment
//     blends 21 sources including one human analyst's opinion with
//     user-adjustable weights, and V1's Cycle conviction includes Gemini
//     (LLM) narrative factors. This is disclosed via `disclosedHalf.provenance`
//     on every read, never silently blended into an "objective" number.
//
// Real external facts reused from V1 (not fabricated — see audit):
//   halving date, this cycle's ATH, and the -77%..-86% historical-bottom
//   drawdown band that 2012/2016/2020's cycle bottoms actually landed in.

export const HALVING_DATE_MS = Date.parse('2024-04-20T00:00:00Z');
export const CYCLE_ATH = Object.freeze({ price: 126198, dateMs: Date.parse('2025-10-06T00:00:00Z') });
export const CYCLE_LEN_DAYS = 1460;
// Historical bottom band, from V1: where the 2012/2016/2020 cycle bottoms
// actually landed, as a drawdown off each cycle's own ATH.
export const HISTORICAL_BOTTOM_DRAWDOWN_MIN = -0.77;
export const HISTORICAL_BOTTOM_DRAWDOWN_MAX = -0.86;

/**
 * Aggregates V4's own per-asset regime classifications (engine/regime.js)
 * into a single -1..+1 reading. Fully deterministic — no composite voting,
 * no AI, just counting the 7-state classification's directional members.
 * @param regimes array of { asset, regime } for the latest classification per asset
 */
export function computeAggregatedRegime(regimes) {
  const valid = (regimes || []).filter((r) => r && r.regime && r.regime !== 'UNKNOWN');
  if (!valid.length) return null;
  const bullish = valid.filter((r) => r.regime === 'TRENDING_BULLISH').length;
  const bearish = valid.filter((r) => r.regime === 'TRENDING_BEARISH').length;
  return { norm: (bullish - bearish) / valid.length, bullishCount: bullish, bearishCount: bearish, total: valid.length };
}

/**
 * Maps current BTC drawdown-from-ATH onto -1..+1 using the real historical
 * bottom band as the -1 anchor and 0% drawdown (at/above ATH) as the +1
 * anchor. Linear interpolation, clamped beyond the band — matches V1's own
 * "capped at that cycle's bottom drawdown" convention for its pattern-fit.
 * @param currentPrice live BTC price
 * @param athPrice     this cycle's ATH (defaults to the real, documented value)
 */
export function computeCyclePosition(currentPrice, athPrice = CYCLE_ATH.price) {
  if (currentPrice == null || !(athPrice > 0)) return null;
  const drawdown = (currentPrice - athPrice) / athPrice; // <= 0 typically
  const bandMid = (HISTORICAL_BOTTOM_DRAWDOWN_MIN + HISTORICAL_BOTTOM_DRAWDOWN_MAX) / 2; // -0.815
  const norm = 1 - (Math.abs(drawdown) / Math.abs(bandMid)) * 2;
  return { norm: Math.max(-1, Math.min(1, norm)), drawdownPct: drawdown * 100 };
}

/** Where a given BTC-halving-relative day count sits in the ~4-year cycle, 0..1. */
export function computeHalvingPhase(nowMs = Date.now()) {
  const daysSinceHalving = Math.floor((nowMs - HALVING_DATE_MS) / 86_400_000);
  const progress = ((daysSinceHalving % CYCLE_LEN_DAYS) + CYCLE_LEN_DAYS) % CYCLE_LEN_DAYS / CYCLE_LEN_DAYS;
  let phase;
  if (daysSinceHalving <= 548) phase = 'PRE_MID_BULL_RUN';
  else if (daysSinceHalving <= 1096) phase = 'POST_PEAK_CORRECTION';
  else phase = 'LATE_CYCLE_CONSOLIDATION';
  return { daysSinceHalving, progress, phase };
}

/**
 * The composite. Implements the approved Option B formula exactly:
 *   deterministicHalf = avg(v4RegimeNorm, v4CyclePositionNorm)
 *   disclosedHalf     = avg(sentimentNorm, cycleConvictionNorm)
 *   raw = deterministicHalf*0.5 + disclosedHalf*0.5
 *   marketPulse = round((raw+1)/2 * 100)
 * Missing inputs are excluded from their half's average, never treated as 0.
 * A fully-missing half falls back to the other half alone, flagged partial.
 * Both missing -> null result with an explicit insufficient-evidence reason.
 *
 * @param inputs { v4RegimeNorm, v4CyclePositionNorm, sentimentScore0to100, cycleConvictionNeg1to1 }
 *   Any field may be null/undefined if unavailable — never fabricate a value here.
 */
export function computeMarketPulse(inputs = {}) {
  const { v4RegimeNorm, v4CyclePositionNorm, sentimentScore0to100, cycleConvictionNeg1to1 } = inputs;

  const detParts = [v4RegimeNorm, v4CyclePositionNorm].filter((v) => v != null);
  const deterministicHalf = detParts.length ? detParts.reduce((a, b) => a + b, 0) / detParts.length : null;

  const sentimentNorm = sentimentScore0to100 != null ? (sentimentScore0to100 - 50) / 50 : null;
  const discParts = [sentimentNorm, cycleConvictionNeg1to1].filter((v) => v != null);
  const disclosedHalf = discParts.length ? discParts.reduce((a, b) => a + b, 0) / discParts.length : null;

  if (deterministicHalf == null && disclosedHalf == null) {
    return { marketPulse: null, label: null, reason: 'Insufficient evidence to determine the current Market Pulse.', partial: true };
  }

  let raw, partial = false, partialReason = null;
  if (deterministicHalf != null && disclosedHalf != null) {
    raw = deterministicHalf * 0.5 + disclosedHalf * 0.5;
  } else if (deterministicHalf != null) {
    raw = deterministicHalf;
    partial = true; partialReason = 'Disclosed half (V1 Sentiment/Cycle) unavailable — using deterministic evidence only.';
  } else {
    raw = disclosedHalf;
    partial = true; partialReason = 'Deterministic half (V4 regime/cycle) unavailable — using disclosed evidence only.';
  }

  const marketPulse = Math.round(((raw + 1) / 2) * 100);
  const label = marketPulse >= 60 ? 'BULLISH' : marketPulse <= 40 ? 'BEARISH' : 'NEUTRAL';

  return {
    marketPulse, label, partial, partialReason,
    deterministicHalf, disclosedHalf,
    components: {
      v4RegimeNorm: v4RegimeNorm ?? null,
      v4CyclePositionNorm: v4CyclePositionNorm ?? null,
      sentimentNorm,
      cycleConvictionNeg1to1: cycleConvictionNeg1to1 ?? null,
    },
    disclosure: disclosedHalf != null
      ? 'Includes V1 Sentiment (21-source blend, incl. one human analyst opinion, user-adjustable weights) and V1 Cycle conviction (includes Gemini AI narrative factors) — not purely mechanical.'
      : null,
  };
}

/**
 * Reconciliation for importing V1's `history` rows into V4's own D1 — mirrors
 * engine/historical_import.js's non-destructive pattern (existing V4 records
 * always win on conflict, exact duplicates skipped, only genuinely new rows
 * inserted) but for the sentiment/cycle scalar series instead of OHLCV candles.
 * @param existingRows current V4-side imported rows [{ ts, score, regimeMag }]
 * @param candidateRows fresh rows pulled from V1's /history [{ ts, score, technicalScore, regimeMag, btcPrice }]
 */
export function reconcileV1HistoryImport(existingRows, candidateRows) {
  const existingByTs = new Map((existingRows || []).map((r) => [r.ts, r]));
  const toInsert = [];
  let duplicates = 0;

  for (const c of candidateRows || []) {
    if (c.ts == null || c.score == null) continue; // never import a row with no usable score
    const existing = existingByTs.get(c.ts);
    if (existing) { duplicates++; continue; } // already imported this exact timestamp — V1's history is immutable per-ts once written
    toInsert.push({
      ts: c.ts,
      score: c.score,
      regimeMag: c.regimeMag ?? null,
      btcPrice: c.btcPrice ?? null,
      source: 'V1_HISTORY_IMPORT',
    });
  }

  return { toInsert, duplicates, receivedCount: (candidateRows || []).length };
}
