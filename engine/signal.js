// engine/signal.js
//
// Combines the evidence/agreement engine and the regime engine into a single,
// transparent signal record. Score is a net directional count, not a probability.
// See spec section 8/9 — no automatic "score == probability" claim.

export function scoreFromAgreement(agreement) {
  return agreement.bullish - agreement.bearish;
}

export function directionFromScore(score) {
  return score > 0 ? 'BULLISH' : score < 0 ? 'BEARISH' : 'NEUTRAL';
}

/** Risk is derived from regime and agreement strength, not from the AI layer. */
export function assessRisk(regime, agreement) {
  if (regime === 'HIGH_VOLATILITY') return 'HIGH';
  if (agreement.agreementRatio == null) return 'HIGH';
  if (agreement.agreementRatio >= 0.8) return 'LOW';
  if (agreement.agreementRatio >= 0.5) return 'MEDIUM';
  return 'HIGH';
}

/**
 * `priorDirections` is newest-first: the direction of the previous evaluation, then the one before, etc.
 * persistenceCount counts how many consecutive evaluations (including the current one) share the current direction.
 * stability flags UNSTABLE when the direction has flipped twice or more within the last 5 evaluations
 * (spec example: +2 -> -1 -> +2 => "signal unstable").
 */
export function computePersistence(currentDirection, priorDirections = []) {
  let persistenceCount = 1;
  for (const d of priorDirections) {
    if (d === currentDirection) persistenceCount++; else break;
  }
  const window = [currentDirection, ...priorDirections].slice(0, 5);
  let flips = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i] !== window[i - 1]) flips++;
  }
  return { persistenceCount, stability: flips >= 2 ? 'UNSTABLE' : 'STABLE' };
}

/**
 * @param agreement    output of engine/evidence.js computeAgreement
 * @param regime       output of engine/regime.js classifyRegime (the `regime` field)
 * @param priorDirections newest-first array of this asset's previous signal directions
 */
export function buildSignal({ agreement, regime, priorDirections = [] }) {
  const score = scoreFromAgreement(agreement);
  const direction = directionFromScore(score);
  const risk = assessRisk(regime, agreement);
  const { persistenceCount, stability } = computePersistence(direction, priorDirections);

  return {
    direction,
    score,
    risk,
    regime,
    evidenceApplicable: agreement.applicable,
    evidenceBullish: agreement.bullish,
    evidenceBearish: agreement.bearish,
    agreementRatio: agreement.agreementRatio,
    evidenceLabel: agreement.label,
    persistenceCount,
    stability,
  };
}
