import { ADAPTIVE_BAND_CONFIG, EVALUATION_CONFIG } from '../config.js';
import { classifySession } from '../providers/liquidity.js';
import { HORIZONS } from '../types.js';
import type { Horizon, MarketRegime, SignalLabel } from '../types.js';
import type { SignalDatabase, SignalRow } from '../db/database.js';
import { classifyRegime, neutralBandPct, realizedHorizonSigmaPct } from './edge.js';

export const HORIZON_MS: Record<Horizon, number> = {
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '24h': 24 * 3_600_000,
  '72h': 72 * 3_600_000,
};

export type ActualDirection = 'up' | 'down' | 'flat';

/**
 * The realized direction against an explicit neutral band (%): a move smaller
 * than the band counts as flat, so a +0.08% drift never validates a bullish call.
 */
export function actualDirection(pctChange: number, bandPct: number): ActualDirection {
  if (pctChange > bandPct) return 'up';
  if (pctChange < -bandPct) return 'down';
  return 'flat';
}

export function isCorrect(label: SignalLabel, direction: ActualDirection): boolean {
  if (label === 'BULLISH') return direction === 'up';
  if (label === 'BEARISH') return direction === 'down';
  return direction === 'flat';
}

/** Per-horizon band for this pass, from realized volatility of our own price history. */
export function currentBands(db: SignalDatabase, now = Date.now()): Record<Horizon, { bandPct: number; method: 'fixed-v1' | 'vol-adaptive-v2'; sigmaPct: number | null }> {
  const prices = db.getPriceSeriesSince(now - ADAPTIVE_BAND_CONFIG.lookbackHours * 3_600_000);
  const enough = prices.length >= ADAPTIVE_BAND_CONFIG.minSamples;
  const out = {} as Record<Horizon, { bandPct: number; method: 'fixed-v1' | 'vol-adaptive-v2'; sigmaPct: number | null }>;
  for (const h of HORIZONS) {
    const sigma = enough ? realizedHorizonSigmaPct(prices, 1, h) : null;
    const band = neutralBandPct(h, sigma);
    out[h] = { ...band, sigmaPct: sigma === null ? null : +sigma.toFixed(4) };
  }
  return out;
}

/**
 * Scheduled evaluation pass: finds signals whose horizon has fully elapsed and
 * which have no evaluation yet, looks up the BTC price ~horizon later from our
 * own stored price history, and persists the outcome together with the exact
 * neutral band and regime that judged it. Signals whose future price cannot be
 * found within tolerance stay unevaluated ONLY while still inside the tolerance
 * window; beyond it they are skipped permanently (no fabricated prices).
 */
export function runEvaluationPass(db: SignalDatabase, now = Date.now()): { evaluated: number; skipped: number } {
  let evaluated = 0;
  let skipped = 0;
  const bands = currentBands(db, now);

  for (const horizon of HORIZONS) {
    const horizonMs = HORIZON_MS[horizon];
    const toleranceMs = Math.max(
      EVALUATION_CONFIG.minPriceToleranceMs,
      horizonMs * EVALUATION_CONFIG.priceToleranceFraction,
    );
    const due = db.getSignalsDueForEvaluation(horizon, now - horizonMs);
    const band = bands[horizon];

    for (const row of due) {
      const targetTs = row.ts + horizonMs;
      const futurePrice = db.getBtcPriceAt(targetTs, toleranceMs);
      if (futurePrice === null) {
        // Only give up once the search window is fully in the past.
        if (now > targetTs + toleranceMs) skipped++;
        continue;
      }
      const entry = row.btc_price!;
      const pctChange = ((futurePrice - entry) / entry) * 100;
      const direction = actualDirection(pctChange, band.bandPct);
      const rawLabel = (row.raw_label ?? row.label) as SignalLabel;
      const snapshot = componentSnapshot(row);

      db.insertEvaluation({
        signal_id: row.id,
        horizon,
        signal_ts: row.ts,
        evaluated_ts: now,
        entry_price: entry,
        future_price: futurePrice,
        abs_change: +(futurePrice - entry).toFixed(2),
        pct_change: +pctChange.toFixed(4),
        predicted_label: row.label,
        raw_label: rawLabel,
        actual_direction: direction,
        correct: isCorrect(row.label, direction) ? 1 : 0,
        raw_correct: isCorrect(rawLabel, direction) ? 1 : 0,
        confidence: row.confidence,
        final_score: row.final_score,
        session: classifySession(row.ts),
        components_json: JSON.stringify(snapshot.components),
        band_pct: band.bandPct,
        band_method: band.method,
        regime: snapshot.regime,
      });
      evaluated++;
    }
  }
  return { evaluated, skipped };
}

/** Component scores + category attribution + regime captured at signal time. */
function componentSnapshot(row: SignalRow): { components: Record<string, unknown>; regime: MarketRegime } {
  let categoryScores: Record<string, number> = {};
  let unavailableProviders: string[] = [];
  let regime: MarketRegime = 'unknown';
  let hourlyShadow: number | undefined;
  if (row.context_json) {
    try {
      const ctx = JSON.parse(row.context_json) as {
        polymarketCategoryScores?: Record<string, number>;
        unavailableProviders?: string[];
        technicalValues?: Record<string, unknown>;
        regime?: MarketRegime;
        hourlyShadow?: { score?: number } | null;
      };
      categoryScores = ctx.polymarketCategoryScores ?? {};
      unavailableProviders = ctx.unavailableProviders ?? [];
      regime = ctx.regime ?? classifyRegime(ctx.technicalValues);
      if (typeof ctx.hourlyShadow?.score === 'number') hourlyShadow = ctx.hourlyShadow.score;
    } catch {
      // legacy rows without parseable context
    }
  }
  return {
    regime,
    components: {
      polymarket: row.polymarket_score,
      technical: row.technical_score,
      etf: row.etf_score,
      macro: row.macro_score,
      liquidity: row.liquidity_score,
      polymarketCategories: categoryScores,
      unavailableProviders,
      hourlyShadow,
    },
  };
}
