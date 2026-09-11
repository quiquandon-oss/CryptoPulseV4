// engine/performance.js
//
// Aggregates RESOLVED outcomes into performance statistics. Never displays a
// percentage when the sample size is too small to mean anything — see spec
// section 11: "Insufficient evidence — 14 resolved observations." not "71%".

export const MIN_SAMPLES = 20;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * @param resolvedOutcomes array of { actualReturn, success } — already filtered to status RESOLVED
 *                         and to whatever segment (asset/horizon/regime/signal bucket) the caller wants.
 */
export function computePerformance(resolvedOutcomes) {
  const samples = resolvedOutcomes.length;

  if (samples < MIN_SAMPLES) {
    return {
      status: 'INSUFFICIENT_DATA',
      samples,
      message: `Insufficient evidence — ${samples} resolved observation${samples === 1 ? '' : 's'} (need ${MIN_SAMPLES}).`,
    };
  }

  const scored = resolvedOutcomes.filter((o) => o.success !== null);
  const wins = scored.filter((o) => o.success === true).length;
  const returns = resolvedOutcomes.map((o) => o.actualReturn);

  return {
    status: 'OK',
    samples,
    winRate: scored.length ? wins / scored.length : null,
    avgReturn: returns.reduce((a, v) => a + v, 0) / returns.length,
    medianReturn: median(returns),
    bestReturn: Math.max(...returns),
    worstReturn: Math.min(...returns),
  };
}

/**
 * Groups resolved outcomes by an arbitrary key function, then applies computePerformance
 * to each group. Used for the asset / horizon / regime / signal-strength segmentation
 * required by spec section 11.
 */
export function computePerformanceBySegment(resolvedOutcomes, keyFn) {
  const groups = new Map();
  for (const outcome of resolvedOutcomes) {
    const key = keyFn(outcome);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(outcome);
  }
  const result = {};
  for (const [key, group] of groups) {
    result[key] = computePerformance(group);
  }
  return result;
}
