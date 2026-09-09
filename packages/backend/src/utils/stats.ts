/**
 * Small, dependency-free statistics helpers used by the edge gate, conformal
 * intervals and drift detection. Everything here is deterministic and unit-tested.
 */

/** Wilson score interval for a binomial proportion. Returns [lower, upper] in 0..1. */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Empirical quantile (linear interpolation) of a numeric array; q in 0..1. */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = Math.min(Math.max(q, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Conformal quantile: ceil((n+1)(1−α))/n-th order statistic — the finite-sample-valid version. */
export function conformalQuantile(residuals: number[], alpha: number): number | null {
  const n = residuals.length;
  if (n === 0) return null;
  const sorted = [...residuals].sort((a, b) => a - b);
  const k = Math.min(n, Math.ceil((n + 1) * (1 - alpha)));
  return sorted[Math.max(0, k - 1)];
}

export function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1);
  return Math.sqrt(v);
}

/** Least-squares slope/intercept of y on x. Returns null when x has no variance. */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n))!;
  const my = mean(ys.slice(0, n))!;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx < 1e-12) return { slope: 0, intercept: my };
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/**
 * Bernoulli CUSUM for detecting a drop in a hit-rate below a reference level.
 * S_t = max(0, S_{t-1} + (reference − k) − x_t) accumulates evidence that the
 * observed rate is BELOW reference. `alarm` reflects the CURRENT statistic
 * (s >= h at the end of the series), not "did s ever cross h" — the floor at 0
 * already lets a recovered hit-rate pull s back down, so alarm clears again once
 * performance improves instead of staying stuck true forever after one bad stretch.
 * `max` still reports the historical peak, for context.
 */
export function bernoulliCusum(hits: Array<0 | 1>, reference: number, k: number, h: number): { stat: number; max: number; alarm: boolean } {
  let s = 0;
  let max = 0;
  for (const x of hits) {
    s = Math.max(0, s + (reference - k) - x);
    if (s > max) max = s;
  }
  return { stat: s, max, alarm: s >= h };
}

/** Median of a numeric array (null for empty). */
export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}
