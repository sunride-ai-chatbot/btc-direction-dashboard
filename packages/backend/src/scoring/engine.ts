import { HORIZON_WEIGHTS, SIGNAL_THRESHOLDS, HYSTERESIS_CONFIG, EDGE_GATE_CONFIG } from '../config.js';
import { clamp } from '../utils/indicators.js';
import { classifyRegime } from './edge.js';
import type {
  ComponentScore, ConformalInterval, EdgeStats, Horizon, HorizonSignal, LiquidityContext,
  SignalContext, SignalLabel, SimilarStates,
} from '../types.js';

export interface ComponentSet {
  polymarket: ComponentScore;
  technical: ComponentScore;
  etf: ComponentScore;
  macro: ComponentScore;
  liquidity: ComponentScore;
}

/** Optional evidence layers attached to a signal: edge gate, conformal range, similar states, data quality. */
export interface SignalEnrichment {
  edge?: EdgeStats | null;
  conformal?: ((score: number) => ConformalInterval) | null;
  similar?: ((score: number) => SimilarStates) | null;
  priceAnomaly?: { anomaly: boolean; note: string | null; spreadPct: number | null } | null;
  livePrice?: { source: 'consensus' | 'rest'; exchanges: number } | null;
}

/** Confidence penalty when exchanges disagree about the price (data-quality, not direction). */
const PRICE_ANOMALY_CONFIDENCE_PENALTY = 8;

export function classify(finalScore: number): SignalLabel {
  if (finalScore >= SIGNAL_THRESHOLDS.bullish) return 'BULLISH';
  if (finalScore <= SIGNAL_THRESHOLDS.bearish) return 'BEARISH';
  return 'NEUTRAL';
}

/**
 * Hysteresis: the displayed label resists flapping on tiny score changes.
 *  - Leaving a directional state requires the score to fall back past
 *    threshold − exitMargin (e.g. bullish holds until score < 25−7 = 18).
 *  - A direct BULLISH↔BEARISH flip requires |score| ≥ extremeScore; otherwise
 *    the transition passes through NEUTRAL first.
 * The raw label/score stay stored so stabilized vs raw can be compared later.
 */
export function stabilizeLabel(prevStable: SignalLabel | null, rawLabel: SignalLabel, finalScore: number): SignalLabel {
  if (prevStable === null || prevStable === rawLabel) return rawLabel;
  const { exitMargin, extremeScore } = HYSTERESIS_CONFIG;

  if (prevStable === 'BULLISH') {
    if (rawLabel === 'BEARISH') {
      return finalScore <= -extremeScore ? 'BEARISH' : 'NEUTRAL';
    }
    // raw NEUTRAL: hold BULLISH inside the sticky band
    return finalScore >= SIGNAL_THRESHOLDS.bullish - exitMargin ? 'BULLISH' : 'NEUTRAL';
  }
  if (prevStable === 'BEARISH') {
    if (rawLabel === 'BULLISH') {
      return finalScore >= extremeScore ? 'BULLISH' : 'NEUTRAL';
    }
    return finalScore <= SIGNAL_THRESHOLDS.bearish + exitMargin ? 'BEARISH' : 'NEUTRAL';
  }
  // prev NEUTRAL — entering a directional state uses the plain thresholds
  return rawLabel;
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
  prevStableLabel: SignalLabel | null = null,
  sessionName = 'unknown',
  enrich: SignalEnrichment = {},
): HorizonSignal {
  const { finalScore, appliedWeights } = composeFinalScore(components, horizon);
  const rawLabel = classify(finalScore);
  const label = stabilizeLabel(prevStableLabel, rawLabel, finalScore);
  let confidence = computeConfidence(components, finalScore, liquidityCtx);
  const anomaly = enrich.priceAnomaly?.anomaly === true;
  if (anomaly) confidence = Math.max(5, confidence - PRICE_ANOMALY_CONFIDENCE_PENALTY);

  const edge = enrich.edge ?? null;
  const gated = EDGE_GATE_CONFIG.enabled ? edge === null || edge.status !== 'proven' : false;
  const conformal = enrich.conformal ? enrich.conformal(finalScore) : null;
  const similar = enrich.similar ? enrich.similar(finalScore) : null;
  const regime = classifyRegime(components.technical.details as Record<string, unknown>);

  const polyDetails = components.polymarket.details as {
    limitedHistory?: boolean;
    historyMinutes?: number;
    marketsUsed?: SignalContext['polymarketMarketsUsed'];
    categoryScores?: Record<string, number>;
  };
  const limitedHistory = polyDetails.limitedHistory === true;
  const historyNote = limitedHistory
    ? `Limited-history signal: Polymarket deltas for this horizon rest on ${polyDetails.historyMinutes ?? 0} minutes of collected snapshots`
    : null;

  const context: SignalContext = {
    appliedWeights,
    configuredWeights: { ...HORIZON_WEIGHTS[horizon] },
    providerFreshness: Object.fromEntries(
      Object.entries(components).map(([k, c]) => [k, c.freshness]),
    ) as SignalContext['providerFreshness'],
    unavailableProviders: Object.entries(components)
      .filter(([, c]) => !c.available)
      .map(([k]) => k),
    session: sessionName,
    polymarketMarketsUsed: polyDetails.marketsUsed ?? [],
    polymarketCategoryScores: (polyDetails.categoryScores ?? {}) as SignalContext['polymarketCategoryScores'],
    technicalValues: components.technical.details,
    macroValues: components.macro.details,
    etfValues: components.etf.details,
    regime,
    edgeGate: edge ? { status: edge.status, lowerBound: edge.lowerBound, n: edge.n, window: edge.window } : null,
    conformal,
    priceAnomaly: enrich.priceAnomaly ?? null,
    livePrice: enrich.livePrice ?? null,
  };

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
  if (anomaly) {
    const note = enrich.priceAnomaly?.note ?? 'exchanges disagree';
    const msg = `Cross-exchange price anomaly (${note}) — data quality reduced`;
    if (!risks.includes(msg)) risks.unshift(msg);
    if (risks.length > MAX_RISKS) risks.length = MAX_RISKS;
  }
  if (risks.length === 0) risks.push('Crypto markets can reprice sharply on unexpected news at any time');

  return {
    horizon,
    label,
    rawLabel,
    finalScore: +finalScore.toFixed(1),
    confidence,
    reasons,
    risks,
    components,
    btcPrice,
    timestamp: now,
    limitedHistory,
    historyNote,
    context,
    edge,
    gated,
    conformal,
    similarStates: similar,
    regime,
  };
}
