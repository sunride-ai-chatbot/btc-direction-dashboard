import { clamp } from '../utils/indicators.js';
import type { ComponentScore, MarketRegime } from '../types.js';

export interface HourlyShadowSignal {
  version: '1h-microstructure-v1';
  score: number;
  inputs: Record<string, number>;
  appliedWeights: Record<string, number>;
  regimeMultiplier: number;
  disagreementPenalty: number;
}

/**
 * Experimental 1h model. It deliberately stays outside the production score:
 * the output is persisted with every 1h signal and evaluated out-of-sample.
 * It emphasizes genuinely short-lived evidence and excludes ETF/macro inputs,
 * whose daily cadence cannot add timely information at a one-hour horizon.
 */
export function buildHourlyShadow(
  technical: ComponentScore,
  polymarket: ComponentScore,
  regime: MarketRegime,
): HourlyShadowSignal | null {
  const tech = technical.details;
  const poly = polymarket.details as { categoryScores?: Record<string, number> };
  const candidates: Array<[string, unknown, number, number]> = [
    ['cvd15m', tech.cvd15m, 0.40, 250],
    ['cvd1h', tech.cvd1h, 0.30, 250],
    ['momentum1h', tech.change1h, 0.20, 40],
    ['polyBtcDirect', poly.categoryScores?.['btc-direct'], 0.10, 1],
  ];
  const usable = candidates.filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return null;

  const totalWeight = usable.reduce((sum, [, , weight]) => sum + weight, 0);
  const inputs: Record<string, number> = {};
  const appliedWeights: Record<string, number> = {};
  let score = 0;
  for (const [name, raw, weight, scale] of usable) {
    const normalized = clamp((raw as number) * scale, -100, 100);
    const applied = weight / totalWeight;
    inputs[name] = +normalized.toFixed(3);
    appliedWeights[name] = +applied.toFixed(4);
    score += normalized * applied;
  }

  // A sharp 15m reversal against the full-hour flow is often transient noise.
  const cvd15 = typeof tech.cvd15m === 'number' ? tech.cvd15m : null;
  const cvd1h = typeof tech.cvd1h === 'number' ? tech.cvd1h : null;
  const disagreementPenalty = cvd15 !== null && cvd1h !== null && Math.sign(cvd15) !== Math.sign(cvd1h) ? 0.65 : 1;
  const regimeMultiplier = regime === 'range' ? 0.75 : regime === 'high-vol' ? 0.8 : 1;
  score *= disagreementPenalty * regimeMultiplier;

  return {
    version: '1h-microstructure-v1',
    score: +clamp(score, -100, 100).toFixed(1),
    inputs,
    appliedWeights,
    regimeMultiplier,
    disagreementPenalty,
  };
}
