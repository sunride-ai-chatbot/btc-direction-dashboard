import { DIVERGENCE_CONFIG } from '../config.js';
import { clamp } from '../utils/indicators.js';
import type { BitcoinTechnicals, DivergenceEvent, PolymarketSnapshot } from '../types.js';

export type DetectedDivergence = Omit<DivergenceEvent, 'id'>;

/**
 * Polymarket / price divergence over the configured window (default 4h):
 *  - BTC falling while Polymarket net-bullish shift → possible bullish divergence
 *  - BTC rising while Polymarket net-bearish shift → possible bearish divergence
 * The aggregate Polymarket shift reuses the same direction/info-value weighting
 * as the scorer, on the 4h probability deltas. Detection only — divergences are
 * displayed and their outcomes tracked, but they do not move the score yet.
 */
export function detectDivergence(
  polySnapshot: PolymarketSnapshot,
  tech: BitcoinTechnicals,
  now = Date.now(),
): DetectedDivergence | null {
  if (polySnapshot.freshness === 'unavailable' || tech.freshness === 'unavailable') return null;
  const priceChange = tech.change4h;
  if (priceChange === null) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const m of polySnapshot.markets) {
    if (m.probChange4h === null) continue;
    const weight = m.relevanceScore * m.informationValue * Math.log10(1 + Math.max(m.liquidity, m.volume));
    if (weight <= 0) continue;
    weightedSum += clamp(m.bullishDirection * m.probChange4h * 1000, -100, 100) * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  const polyShift = weightedSum / totalWeight;

  const { minPriceMovePct, minPolyShiftScore, windowHours } = DIVERGENCE_CONFIG;

  if (priceChange <= -minPriceMovePct && polyShift >= minPolyShiftScore) {
    return {
      ts: now,
      kind: 'bullish-divergence',
      btc_change_pct: +priceChange.toFixed(2),
      poly_shift_score: +polyShift.toFixed(1),
      window_hours: windowHours,
      message: `BTC down ${Math.abs(priceChange).toFixed(1)}% over ${windowHours}h while Polymarket sentiment shifted bullish (+${polyShift.toFixed(0)}) — possible bullish divergence`,
    };
  }
  if (priceChange >= minPriceMovePct && polyShift <= -minPolyShiftScore) {
    return {
      ts: now,
      kind: 'bearish-divergence',
      btc_change_pct: +priceChange.toFixed(2),
      poly_shift_score: +polyShift.toFixed(1),
      window_hours: windowHours,
      message: `BTC up ${priceChange.toFixed(1)}% over ${windowHours}h while Polymarket sentiment deteriorated (${polyShift.toFixed(0)}) — possible bearish divergence`,
    };
  }
  return null;
}
