// engine/explain.js
//
// The AI layer explains facts the deterministic engine already computed — it
// never becomes the source of truth (spec section 2 and 14). The prompt hands
// the model a closed set of numbers and asks four fixed questions; the model
// cannot introduce new indicator values because none of its output is written
// back into `technical_indicators`, only into `ai_explanations`.

export function buildExplanationPrompt(facts) {
  const { asset, price, indicators, regime, signal } = facts;
  return [
    'You are explaining an already-computed market signal. Do not invent numbers.',
    'Only use the facts provided below. If something is not listed, say it is unavailable.',
    '',
    `Asset: ${asset}`,
    `Price: ${price}`,
    `Regime: ${regime.regime} (${regime.basis})`,
    `Signal: ${signal.direction}, score ${signal.score}, evidence ${signal.evidenceLabel}, risk ${signal.risk}`,
    `Persistence: ${signal.persistenceCount} consecutive evaluation(s), stability ${signal.stability}`,
    'Indicators:',
    ...indicators.map((i) => `- ${i.indicator}: ${i.applicable ? i.interpretation : 'unavailable'}`),
    '',
    'Answer exactly these four questions, each as one short sentence:',
    '1. What supports the signal?',
    '2. What contradicts it?',
    '3. What risks exist?',
    '4. What would invalidate the current interpretation?',
  ].join('\n');
}

/** Deterministic, rule-based explanation used whenever no LLM key is configured. Never fabricates. */
export function buildDeterministicExplanation(facts) {
  const { indicators, signal } = facts;
  const supporting = indicators.filter((i) => i.applicable && i.direction === signal.direction);
  const contradicting = indicators.filter((i) => i.applicable && i.direction !== 'NEUTRAL' && i.direction !== signal.direction);

  return {
    supports: supporting.length
      ? supporting.map((i) => i.interpretation)
      : ['No indicators currently support this direction.'],
    contradicts: contradicting.length
      ? contradicting.map((i) => i.interpretation)
      : ['No contradicting indicators at this evaluation.'],
    risks: [
      signal.risk !== 'LOW' ? `Risk assessed as ${signal.risk} — evidence agreement is ${signal.evidenceLabel}.` : 'Risk assessed as LOW given current agreement.',
      signal.stability === 'UNSTABLE' ? 'Signal direction has flipped recently — treat persistence as weak.' : null,
    ].filter(Boolean),
    invalidation: `A close beyond the opposite side of the evidence used above (regime: ${signal.regime}) would invalidate this read.`,
    model: 'deterministic-fallback',
  };
}

/**
 * @param facts       { asset, price, indicators, regime, signal }
 * @param apiKey      Gemini API key (Worker secret), or falsy to force the deterministic fallback
 * @param fetchImpl   injectable fetch, defaults to global fetch (Worker runtime provides one)
 */
export async function explainSignal(facts, apiKey, fetchImpl = fetch) {
  if (!apiKey) {
    return buildDeterministicExplanation(facts);
  }

  const prompt = buildExplanationPrompt(facts);
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('Empty Gemini response');

    return { raw: text, model: 'gemini-3.6-flash', ...parseFourAnswers(text) };
  } catch (err) {
    // Never block the API response on the AI layer failing — fall back deterministically
    // and say so, rather than showing a stale or fabricated explanation.
    return { ...buildDeterministicExplanation(facts), aiError: String(err) };
  }
}

/** Best-effort split of the model's four numbered answers into fields; falls back to the raw text. */
function parseFourAnswers(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const find = (n) => lines.find((l) => l.startsWith(`${n}.`))?.replace(/^\d\.\s*/, '') ?? null;
  return {
    supports: [find(1)].filter(Boolean),
    contradicts: [find(2)].filter(Boolean),
    risks: [find(3)].filter(Boolean),
    invalidation: find(4),
  };
}
