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
 * Classifies the Pulse/BTC relationship using neutral analytical language
 * (spec: never call this a trading signal). Compares each series' own
 * direction over the same window — never blends them onto one scale.
 * @param marketPulseChange e.g. latest.marketPulse - earliest.marketPulse over the window
 * @param btcReturnPct      BTC's cumulative % return over the same window
 */
export function classifyAlignment(marketPulseChange, btcReturnPct) {
  if (marketPulseChange == null || btcReturnPct == null) return null;
  const pulseUp = marketPulseChange > 1;
  const pulseDown = marketPulseChange < -1;
  const btcUp = btcReturnPct > 1;
  const btcDown = btcReturnPct < -1;

  if (pulseUp && btcUp) return { label: 'Confirmation', detail: 'Market Pulse and BTC are both rising together.' };
  if (pulseDown && btcDown) return { label: 'Confirmation', detail: 'Market Pulse and BTC are both falling together.' };
  if (pulseUp && !btcUp) return { label: 'Bullish divergence', detail: 'Market Pulse is improving while BTC is flat or down.' };
  if (pulseDown && !btcDown) return { label: 'Bearish divergence', detail: 'Market Pulse is weakening while BTC is flat or up.' };
  return { label: 'Market alignment', detail: 'No strong divergence — both readings are relatively flat over this period.' };
}

/**
 * Rolling version of classifyAlignment, for chart background bands: shows
 * how the Pulse/BTC relationship has SHIFTED over time, not just today's
 * single verdict. Windowed (default 6 points) rather than point-to-point
 * so the bands show meaningful stretches instead of flip-flopping on every
 * single tick — reuses classifyAlignment's exact thresholds and labels,
 * no new classification logic invented here.
 * @param points [{ts, marketPulse, btcCumReturnPct}], ascending
 * @returns array, same length as points; null for the first `windowSize`
 *   points (not enough trailing history yet to classify)
 */
export function classifyAlignmentSeries(points, windowSize = 6) {
  if (!points || !points.length) return [];
  return points.map((p, i) => {
    const startIdx = i - windowSize;
    if (startIdx < 0) return null;
    const pulseChange = p.marketPulse - points[startIdx].marketPulse;
    const btcChange = p.btcCumReturnPct - points[startIdx].btcCumReturnPct;
    return classifyAlignment(pulseChange, btcChange);
  });
}

/**
 * Deterministic "Why this reading?" text, built only from the structured
 * components already computed — never an invented narrative. Mirrors
 * engine/explain.js's buildDeterministicExplanation pattern (template over
 * facts, not a model call) for the same reason: auditable, reproducible.
 */
export function explainMarketPulse(result, context = {}) {
  if (result.marketPulse == null) {
    return { summary: result.reason || 'Insufficient evidence to determine the current Market Pulse.', points: [] };
  }
  const points = [];
  const { regimeCounts, cycleDrawdownPct, halvingPhase } = context;

  if (regimeCounts) {
    points.push(`${regimeCounts.bullishCount} of ${regimeCounts.total} tracked assets (BTC/ETH/LINK) are in a bullish technical regime, ${regimeCounts.bearishCount} bearish.`);
  }
  if (cycleDrawdownPct != null) {
    points.push(`BTC is ${Math.abs(cycleDrawdownPct).toFixed(1)}% below this cycle's ATH.`);
  }
  if (halvingPhase) {
    points.push(`${context.daysSinceHalving} days since the last halving (${halvingPhase.replaceAll('_', ' ').toLowerCase()}).`);
  }
  if (result.components?.sentimentNorm != null) {
    points.push(`V1's imported Sentiment reading contributes ${result.components.sentimentNorm >= 0 ? 'positively' : 'negatively'} to the disclosed half.`);
  }
  if (result.partial) {
    points.push(result.partialReason);
  }

  return {
    summary: `Market Pulse is ${result.marketPulse} (${result.label}), based on ${result.partial ? 'partial' : 'complete'} evidence across ${result.partial ? '1' : '2'} of 2 halves.`,
    points,
  };
}

/**
 * Aligns Market Pulse history against BTC price for the "Market Pulse vs
 * BTC" chart. Per spec: NOT a common normalized scale — Market Pulse stays
 * 0-100, BTC becomes a cumulative % return from the window's first point.
 * Same 2-hour timestamp tolerance as the portfolio benchmark chart (BTC
 * candles are hourly and dense, so matching FROM each — possibly sparse —
 * Pulse point TO the nearest BTC candle succeeds even when Pulse points
 * themselves are irregular).
 * @param pulsePoints [{ ts, market_pulse }] from market_pulse_snapshots
 * @param btcPoints   [{ ts, close }] from market_observations
 */
const MAX_PULSE_BTC_TIME_DELTA_MS = 2 * 3600 * 1000;

export function alignMarketPulseWithBtc(pulsePoints, btcPoints) {
  const validPulse = (pulsePoints || []).filter((p) => p.market_pulse != null);
  const validBtc = (btcPoints || []).filter((b) => b.close != null && b.close > 0);

  if (!validPulse.length || !validBtc.length) {
    return { status: 'INSUFFICIENT_DATA', message: 'No overlapping Market Pulse and BTC price data available.', points: [] };
  }

  const startTs = validPulse[0].ts;
  const nearestStartBtc = [...validBtc].sort((a, b) => Math.abs(a.ts - startTs) - Math.abs(b.ts - startTs))[0];
  if (Math.abs(nearestStartBtc.ts - startTs) > MAX_PULSE_BTC_TIME_DELTA_MS) {
    return { status: 'INSUFFICIENT_DATA', message: 'No BTC price observation exists within tolerance of the window start.', points: [] };
  }
  const baseBtc = nearestStartBtc.close;

  const points = [];
  for (const p of validPulse) {
    const nearestBtc = [...validBtc].sort((a, b) => Math.abs(a.ts - p.ts) - Math.abs(b.ts - p.ts))[0];
    if (!nearestBtc || Math.abs(nearestBtc.ts - p.ts) > MAX_PULSE_BTC_TIME_DELTA_MS) continue;
    points.push({ ts: p.ts, marketPulse: p.market_pulse, btcCumReturnPct: ((nearestBtc.close - baseBtc) / baseBtc) * 100 });
  }

  return { status: points.length ? 'OK' : 'INSUFFICIENT_DATA', points };
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
