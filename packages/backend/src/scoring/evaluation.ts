import type { SignalDatabase } from '../db/database.js';
import type { EvaluationBucket, EvaluationReport, Horizon } from '../types.js';

const HORIZON_MS: Record<Horizon, number> = {
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '24h': 24 * 3_600_000,
  '72h': 72 * 3_600_000,
};

/** "Neutral correct" band: |return| below this % counts as flat. Scales with horizon. */
const NEUTRAL_BAND_PCT: Record<Horizon, number> = {
  '1h': 0.3,
  '4h': 0.6,
  '24h': 1.5,
  '72h': 2.5,
};

/**
 * Compares each stored signal against the BTC price N hours later.
 * BULLISH correct if price rose, BEARISH correct if it fell,
 * NEUTRAL correct if move stayed inside the horizon's flat band.
 */
export function evaluateHorizon(db: SignalDatabase, horizon: Horizon, now = Date.now()): EvaluationReport {
  const horizonMs = HORIZON_MS[horizon];
  const tolerance = Math.max(10 * 60_000, horizonMs * 0.1);
  const rows = db.getSignalsOlderThan(horizon, now - horizonMs);

  let total = 0;
  let correct = 0;
  const byLabel: Record<string, { total: number; correct: number }> = {
    BULLISH: { total: 0, correct: 0 },
    BEARISH: { total: 0, correct: 0 },
    NEUTRAL: { total: 0, correct: 0 },
  };
  const buckets: Record<string, { total: number; correct: number; returns: number[] }> = {
    '0-40': { total: 0, correct: 0, returns: [] },
    '40-60': { total: 0, correct: 0, returns: [] },
    '60-80': { total: 0, correct: 0, returns: [] },
    '80-100': { total: 0, correct: 0, returns: [] },
  };
  const returns: number[] = [];

  for (const row of rows) {
    if (row.btc_price === null || row.btc_price <= 0) continue;
    const futurePrice = db.getBtcPriceAt(row.ts + horizonMs, tolerance);
    if (futurePrice === null) continue;

    const returnPct = ((futurePrice - row.btc_price) / row.btc_price) * 100;
    const band = NEUTRAL_BAND_PCT[horizon];
    const isCorrect =
      row.label === 'BULLISH' ? returnPct > 0 :
      row.label === 'BEARISH' ? returnPct < 0 :
      Math.abs(returnPct) <= band;

    total++;
    if (isCorrect) correct++;
    byLabel[row.label].total++;
    if (isCorrect) byLabel[row.label].correct++;

    const directionalReturn = row.label === 'BULLISH' ? returnPct : row.label === 'BEARISH' ? -returnPct : 0;
    if (row.label !== 'NEUTRAL') returns.push(directionalReturn);

    const bucketKey = row.confidence < 40 ? '0-40' : row.confidence < 60 ? '40-60' : row.confidence < 80 ? '60-80' : '80-100';
    buckets[bucketKey].total++;
    if (isCorrect) buckets[bucketKey].correct++;
    if (row.label !== 'NEUTRAL') buckets[bucketKey].returns.push(directionalReturn);
  }

  const acc = (c: number, t: number): number | null => (t > 0 ? +(c / t * 100).toFixed(1) : null);
  const avg = (arr: number[]): number | null => (arr.length > 0 ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : null);

  const byConfidenceBucket: EvaluationBucket[] = Object.entries(buckets).map(([bucket, b]) => ({
    bucket,
    total: b.total,
    correct: b.correct,
    accuracy: acc(b.correct, b.total),
    avgReturn: avg(b.returns),
  }));

  return {
    horizon,
    totalEvaluated: total,
    directionalAccuracy: acc(correct, total),
    bullishAccuracy: acc(byLabel.BULLISH.correct, byLabel.BULLISH.total),
    bearishAccuracy: acc(byLabel.BEARISH.correct, byLabel.BEARISH.total),
    neutralAccuracy: acc(byLabel.NEUTRAL.correct, byLabel.NEUTRAL.total),
    avgReturnAfterSignal: avg(returns),
    byConfidenceBucket,
  };
}
