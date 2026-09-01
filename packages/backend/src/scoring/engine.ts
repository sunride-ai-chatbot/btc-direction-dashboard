import { HORIZON_WEIGHTS, SIGNAL_THRESHOLDS } from '../config.js';
import { clamp } from '../utils/indicators.js';
import type { ComponentScore, Horizon, HorizonSignal, LiquidityContext, SignalLabel } from '../types.js';

export interface ComponentSet {
  polymarket: ComponentScore;
  technical: ComponentScore;
  etf: ComponentScore;
  macro: ComponentScore;
  liquidity: ComponentScore;
}

export function classify(finalScore: number): SignalLabel {
  if (finalScore >= SIGNAL_THRESHOLDS.bullish) return 'BULLISH';
  if (finalScore <= SIGNAL_THRESHOLDS.bearish) return 'BEARISH';
  return 'NEUTRAL';
}

/**
 * Final score: weighted sum over AVAILABLE components, with weights renormalized
 * so one dead provider doesn't silently drag the score toward 0.
 * Unavailability is punished in confidence instead.
 */
export function composeFinalScore(components: ComponentSet, horizon: Horizon): { finalScore: number; appliedWeights: Record<string, number> } {
  const weights = HORIZON_WEIGHTS[horizon];
  const entries = Object.entries(components) as Array<[keyof ComponentSet, ComponentScore]>;

  let availableWeight = 0;
  for (const [key, comp] of entries) {
    if (comp.available) availableWeight += weights[key];
  }
  if (availableWeight === 0) {
    return { finalScore: 0, appliedWeights: Object.fromEntries(entries.map(([k]) => [k, 0])) };
  }

  let finalScore = 0;
  const appliedWeights: Record<string, number> = {};
  for (const [key, comp] of entries) {
    const w = comp.available ? weights[key] / availableWeight : 0;
    appliedWeights[key] = +w.toFixed(4);
    comp.weight = w;
    finalScore += comp.score * w;
  }
  return { finalScore: clamp(finalScore, -100, 100), appliedWeights };
}

/**
 * Confidence 0-100, built from:
 *  - signal strength (|final score|)
 *  - agreement between independent directional components
 *  - data availability & freshness
 *  - session + volume quality (liquidity context)
 * Clamped to 5..95: this model never claims certainty.
 */
export function computeConfidence(
  components: ComponentSet,
  finalScore: number,
  liquidityCtx: LiquidityContext,
): number {
  let confidence = 30;

  confidence += Math.min(Math.abs(finalScore) * 0.45, 30);

  const directional = [components.polymarket, components.technical, components.etf, components.macro].filter(
    (c) => c.available,
  );
  const signalSign = Math.sign(finalScore);
  if (directional.length > 0 && signalSign !== 0) {
    const agreeing = directional.filter((c) => Math.sign(c.score) === signalSign && Math.abs(c.score) > 5).length;
    const disagreeing = directional.filter((c) => Math.sign(c.score) === -signalSign && Math.abs(c.score) > 5).length;
    confidence += agreeing * 7;
    confidence -= disagreeing * 9;
  }

  const allComponents = Object.values(components);
  const unavailableCount = allComponents.filter((c) => !c.available).length;
  const staleCount = allComponents.filter((c) => c.available && c.freshness === 'stale').length;
  confidence -= unavailableCount * 8;
  confidence -= staleCount * 4;

  const liquidityFactor = 0.75 + liquidityCtx.sessionQuality * 0.15 + liquidityCtx.volumeQuality * 0.1;
  confidence *= liquidityFactor;

  return Math.round(clamp(confidence, 5, 95));
}

const MAX_REASONS = 3;
const MAX_RISKS = 2;

export function buildSignal(
  components: ComponentSet,
  horizon: Horizon,
  liquidityCtx: LiquidityContext,
  btcPrice: number | null,
  now: number,
): HorizonSignal {
  const { finalScore } = composeFinalScore(components, horizon);
  const label = classify(finalScore);
  const confidence = computeConfidence(components, finalScore, liquidityCtx);

  const weights = HORIZON_WEIGHTS[horizon];
  const ranked = (Object.entries(components) as Array<[keyof ComponentSet, ComponentScore]>)
    .filter(([, c]) => c.available)
    .sort(([ka, a], [kb, b]) => Math.abs(b.score * weights[kb]) - Math.abs(a.score * weights[ka]));

  const reasons: string[] = [];
  for (const [, comp] of ranked) {
    for (const r of comp.reasons) {
      if (reasons.length < MAX_REASONS && !reasons.includes(r)) reasons.push(r);
    }
  }
  if (reasons.length === 0) reasons.push('No strong directional evidence — signals are mixed or flat');

  const risks: string[] = [];
  for (const [, comp] of ranked) {
    for (const r of comp.risks) {
      if (risks.length < MAX_RISKS && !risks.includes(r)) risks.push(r);
    }
  }
  for (const comp of Object.values(components)) {
    if (!comp.available && risks.length < MAX_RISKS) {
      for (const r of comp.risks) if (!risks.includes(r)) risks.push(r);
    }
  }
  if (risks.length === 0) risks.push('Crypto markets can reprice sharply on unexpected news at any time');

  return {
    horizon,
    label,
    finalScore: +finalScore.toFixed(1),
    confidence,
    reasons,
    risks,
    components,
    btcPrice,
    timestamp: now,
  };
}
