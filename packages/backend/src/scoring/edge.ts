import { ADAPTIVE_BAND_CONFIG, CONFORMAL_CONFIG, DRIFT_CONFIG, EDGE_GATE_CONFIG, NEUTRAL_THRESHOLD_PCT } from '../config.js';
import { HORIZONS } from '../types.js';
import type { ConformalInterval, EdgeStats, Horizon, MarketRegime, SimilarStates } from '../types.js';
import { bernoulliCusum, conformalQuantile, linearFit, stddev, wilsonInterval } from '../utils/stats.js';

/** Minimal evaluation row shape these functions need (matches DB rows). */
export interface EvalLike {
  horizon: Horizon;
  signal_ts: number;
  final_score: number;
  pct_change: number;
  actual_direction: 'up' | 'down' | 'flat';
  correct: number;
}

export const HORIZON_MINUTES: Record<Horizon, number> = { '1h': 60, '4h': 240, '24h': 1440, '72h': 4320 };

/**
 * Signals persist every ~5 minutes, so consecutive evaluation rows for the same
 * horizon share almost their entire outcome window (two adjacent 24h rows overlap
 * by 23h55m — nearly the same realized move). Treating every row as an independent
 * Bernoulli trial lets a single lucky/unlucky stretch masquerade as a large sample
 * (100 correlated 24h rows can span just ~8 hours = one real outcome). This keeps
 * only one row per non-overlapping horizon-length window, so every Wilson-interval
 * statistic below is computed on genuinely independent outcomes. A direct
 * consequence: 4h/24h/72h can rarely reach the configured minSamples inside a short
 * window — that is the correct, honest answer, not a bug to route around.
 */
export function thinToNonOverlapping<T extends { signal_ts: number }>(rows: T[], horizonMinutes: number): T[] {
  const horizonMs = horizonMinutes * 60_000;
  const sorted = [...rows].sort((a, b) => a.signal_ts - b.signal_ts);
  const out: T[] = [];
  let cutoff = -Infinity;
  for (const r of sorted) {
    if (r.signal_ts >= cutoff) {
      out.push(r);
      cutoff = r.signal_ts + horizonMs;
    }
  }
  return out;
}

// ---------------- volatility-adaptive neutral band ----------------

/**
 * σ of the horizon from a 1-minute (or coarser, evenly spaced) price series:
 * σ_1step × sqrt(horizon_minutes / step_minutes), in percent.
 */
export function realizedHorizonSigmaPct(prices: number[], stepMinutes: number, horizon: Horizon): number | null {
  if (prices.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) rets.push(Math.log(prices[i] / prices[i - 1]));
  }
  const sd = stddev(rets);
  if (sd === null) return null;
  return sd * Math.sqrt(HORIZON_MINUTES[horizon] / stepMinutes) * 100;
}

/**
 * Neutral band for a horizon: k × σ_h clamped around the legacy fixed band.
 * Falls back to the fixed band (method 'fixed-v1') when history is insufficient.
 */
export function neutralBandPct(horizon: Horizon, sigmaPct: number | null): { bandPct: number; method: 'fixed-v1' | 'vol-adaptive-v2' } {
  const fixed = NEUTRAL_THRESHOLD_PCT[horizon];
  if (!ADAPTIVE_BAND_CONFIG.enabled || sigmaPct === null || !Number.isFinite(sigmaPct) || sigmaPct <= 0) {
    return { bandPct: fixed, method: 'fixed-v1' };
  }
  const raw = ADAPTIVE_BAND_CONFIG.k * sigmaPct;
  const band = Math.min(Math.max(raw, fixed * ADAPTIVE_BAND_CONFIG.floorFactor), fixed * ADAPTIVE_BAND_CONFIG.capFactor);
  return { bandPct: +band.toFixed(4), method: 'vol-adaptive-v2' };
}

// ---------------- regime ----------------

/**
 * Coarse market regime from values already stored in each signal's technical
 * context: trend when price sits clearly on one side of EMA20/EMA50 in agreement,
 * high-vol when hourly volatility is elevated, else range.
 */
export function classifyRegime(tech: { price?: unknown; ema20?: unknown; ema50?: unknown; volatility24h?: unknown } | null | undefined): MarketRegime {
  if (!tech) return 'unknown';
  const price = Number(tech.price);
  const ema20 = Number(tech.ema20);
  const ema50 = Number(tech.ema50);
  const vol = Number(tech.volatility24h);
  if (Number.isFinite(vol) && vol > 1.2) return 'high-vol';
  if (![price, ema20, ema50].every(Number.isFinite) || price <= 0) return 'unknown';
  const distPct = ((ema20 - ema50) / price) * 100;
  if (price > ema20 && ema20 > ema50 && distPct > 0.3) return 'trend-up';
  if (price < ema20 && ema20 < ema50 && distPct < -0.3) return 'trend-down';
  return 'range';
}

// ---------------- edge (score-sign agreement) ----------------

/**
 * The honest edge measure: among realized NON-FLAT outcomes where the model
 * held a meaningful lean (|score| ≥ minScore), how often did sign(score) match
 * the realized direction? Baseline is 50%; Wilson bounds decide the status.
 */
export function computeEdgeStats(rows: EvalLike[], horizon: Horizon, now: number, windowDays = EDGE_GATE_CONFIG.windowDays): EdgeStats {
  const cfg = EDGE_GATE_CONFIG;
  const since = now - windowDays * 86_400_000;
  const inWindow = rows.filter((r) => r.horizon === horizon && r.signal_ts >= since);
  const nonFlat = inWindow.filter((r) => r.actual_direction !== 'flat' && Math.abs(r.final_score) >= cfg.minScore);
  const usable = thinToNonOverlapping(nonFlat, HORIZON_MINUTES[horizon]);
  const agree = usable.filter((r) => Math.sign(r.final_score) === (r.actual_direction === 'up' ? 1 : -1)).length;
  const n = usable.length;
  if (n < cfg.minSamples) {
    return { horizon, status: 'insufficient', window: `${windowDays}d`, n, agree, rate: n ? +(agree / n).toFixed(4) : null, lowerBound: null, upperBound: null };
  }
  const [lo, hi] = wilsonInterval(agree, n, cfg.wilsonZ);
  const status: EdgeStats['status'] = lo > cfg.minLowerBound ? 'proven' : hi < cfg.inverseUpperBound ? 'inverse' : 'unproven';
  return { horizon, status, window: `${windowDays}d`, n, agree, rate: +(agree / n).toFixed(4), lowerBound: +lo.toFixed(4), upperBound: +hi.toFixed(4) };
}

export function computeAllEdgeStats(rows: EvalLike[], now: number): Record<Horizon, EdgeStats> {
  const out = {} as Record<Horizon, EdgeStats>;
  for (const h of HORIZONS) out[h] = computeEdgeStats(rows, h, now);
  return out;
}

// ---------------- split conformal intervals ----------------

/**
 * Split conformal regression: the OLDER half of the window fits center = a + β·score,
 * the NEWER half calibrates |residual| quantiles. Coverage holds under
 * exchangeability regardless of how good β is. Also reports the score-free
 * baseline half-width so we can see whether the score narrows the interval at all.
 */
export function fitConformal(rows: EvalLike[], horizon: Horizon): ((score: number) => ConformalInterval) | null {
  const cfg = CONFORMAL_CONFIG;
  const hz = rows.filter((r) => r.horizon === horizon).sort((a, b) => a.signal_ts - b.signal_ts).slice(-cfg.maxWindow);
  if (hz.length < cfg.minSamples) return null;
  const split = Math.floor(hz.length / 2);
  const train = hz.slice(0, split);
  const cal = hz.slice(split);
  const fit = linearFit(train.map((r) => r.final_score), train.map((r) => r.pct_change)) ?? { slope: 0, intercept: 0 };
  const residuals = cal.map((r) => Math.abs(r.pct_change - (fit.intercept + fit.slope * r.final_score)));
  const q80 = conformalQuantile(residuals, 0.2) ?? 0;
  const q50 = conformalQuantile(residuals, 0.5) ?? 0;
  const baseline80 = conformalQuantile(cal.map((r) => Math.abs(r.pct_change)), 0.2) ?? 0;
  return (score: number): ConformalInterval => {
    const center = fit.intercept + fit.slope * score;
    return {
      center: +center.toFixed(4),
      lo80: +(center - q80).toFixed(4),
      hi80: +(center + q80).toFixed(4),
      lo50: +(center - q50).toFixed(4),
      hi50: +(center + q50).toFixed(4),
      beta: +fit.slope.toFixed(6),
      nCalibration: cal.length,
      baselineHalfWidth80: +baseline80.toFixed(4),
    };
  };
}

/** Realized coverage of the 80% interval over the newest rows — should sit near 0.8. */
export function conformalCoverage(rows: EvalLike[], horizon: Horizon, interval: (score: number) => ConformalInterval, samples = CONFORMAL_CONFIG.coverageCheckSamples): { n: number; coverage80: number | null } {
  const hz = rows.filter((r) => r.horizon === horizon).sort((a, b) => a.signal_ts - b.signal_ts).slice(-samples);
  if (hz.length === 0) return { n: 0, coverage80: null };
  const inside = hz.filter((r) => {
    const iv = interval(r.final_score);
    return r.pct_change >= iv.lo80 && r.pct_change <= iv.hi80;
  }).length;
  return { n: hz.length, coverage80: +(inside / hz.length).toFixed(3) };
}

// ---------------- similar states (empirical up-rate per score bucket) ----------------

export const SCORE_BUCKETS: Array<{ key: string; min: number; max: number }> = [
  { key: '≤-25', min: -Infinity, max: -25 },
  { key: '-25..-10', min: -25, max: -10 },
  { key: '-10..-3', min: -10, max: -3 },
  { key: '-3..3', min: -3, max: 3 },
  { key: '3..10', min: 3, max: 10 },
  { key: '10..25', min: 10, max: 25 },
  { key: '≥25', min: 25, max: Infinity },
];

export function scoreBucket(score: number): string {
  for (const b of SCORE_BUCKETS) {
    if (score > b.min && score <= b.max) return b.key;
  }
  return score <= -25 ? '≤-25' : '≥25';
}

export function similarStates(rows: EvalLike[], horizon: Horizon, score: number, now: number, windowDays = EDGE_GATE_CONFIG.windowDays): SimilarStates {
  const key = scoreBucket(score);
  const since = now - windowDays * 86_400_000;
  const inBucket = rows.filter((r) => r.horizon === horizon && r.signal_ts >= since && r.actual_direction !== 'flat' && scoreBucket(r.final_score) === key);
  const peers = thinToNonOverlapping(inBucket, HORIZON_MINUTES[horizon]);
  const ups = peers.filter((r) => r.actual_direction === 'up').length;
  if (peers.length === 0) return { bucket: key, n: 0, upRate: null, lowerBound: null, upperBound: null };
  const [lo, hi] = wilsonInterval(ups, peers.length);
  return { bucket: key, n: peers.length, upRate: +(ups / peers.length).toFixed(4), lowerBound: +lo.toFixed(4), upperBound: +hi.toFixed(4) };
}

// ---------------- drift (control chart) ----------------

export interface DriftReport {
  horizon: Horizon;
  n: number;
  cusum: number;
  cusumMax: number;
  alarm: boolean;
  daily: Array<{ day: string; n: number; agree: number; rate: number | null; lower: number | null; upper: number | null }>;
}

/** Daily score-sign agreement series + Bernoulli CUSUM against the 50% reference. */
export function driftReport(rows: EvalLike[], horizon: Horizon): DriftReport {
  const cfg = DRIFT_CONFIG;
  const nonFlat = rows.filter((r) => r.horizon === horizon && r.actual_direction !== 'flat' && Math.abs(r.final_score) >= EDGE_GATE_CONFIG.minScore);
  const usable = thinToNonOverlapping(nonFlat, HORIZON_MINUTES[horizon]);
  const hits = usable.map((r) => (Math.sign(r.final_score) === (r.actual_direction === 'up' ? 1 : -1) ? 1 : 0) as 0 | 1);
  const cus = usable.length >= cfg.minSamples ? bernoulliCusum(hits, 0.5, cfg.cusumK, cfg.cusumH) : { stat: 0, max: 0, alarm: false };

  const byDay = new Map<string, { n: number; agree: number }>();
  usable.forEach((r, i) => {
    const day = new Date(r.signal_ts).toISOString().slice(0, 10);
    const d = byDay.get(day) ?? { n: 0, agree: 0 };
    d.n++;
    d.agree += hits[i];
    byDay.set(day, d);
  });
  const daily = [...byDay.entries()].map(([day, d]) => {
    const [lo, hi] = wilsonInterval(d.agree, d.n);
    return { day, n: d.n, agree: d.agree, rate: +(d.agree / d.n).toFixed(3), lower: +lo.toFixed(3), upper: +hi.toFixed(3) };
  });
  return { horizon, n: usable.length, cusum: +cus.stat.toFixed(2), cusumMax: +cus.max.toFixed(2), alarm: cus.alarm, daily };
}
