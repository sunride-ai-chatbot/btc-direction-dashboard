import { HORIZONS } from '../types.js';
import type { EvaluationBucket, Horizon } from '../types.js';
import type { EvaluationRow, SignalDatabase } from '../db/database.js';

/** Below this many evaluated signals per horizon, results are flagged unreliable. */
export const MIN_RELIABLE_SAMPLES = 50;

export const CONFIDENCE_BUCKETS: Array<{ key: string; min: number; max: number }> = [
  { key: '0-49', min: 0, max: 49 },
  { key: '50-59', min: 50, max: 59 },
  { key: '60-69', min: 60, max: 69 },
  { key: '70-79', min: 70, max: 79 },
  { key: '80+', min: 80, max: 100 },
];

function acc(correct: number, total: number): number | null {
  return total > 0 ? +((correct / total) * 100).toFixed(1) : null;
}

function avg(values: number[]): number | null {
  return values.length > 0 ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3) : null;
}

export interface HorizonEvaluationReport {
  horizon: Horizon | 'overall';
  totalEvaluated: number;
  reliable: boolean;
  directionalAccuracy: number | null;
  rawDirectionalAccuracy: number | null;
  bullishAccuracy: number | null;
  bearishAccuracy: number | null;
  neutralAccuracy: number | null;
  avgReturnAfterBullish: number | null;
  avgReturnAfterBearish: number | null;
  byConfidenceBucket: EvaluationBucket[];
  bySession: Array<{ session: string; total: number; correct: number; accuracy: number | null }>;
}

export function buildEvaluationReport(db: SignalDatabase): {
  minReliableSamples: number;
  overall: HorizonEvaluationReport;
  horizons: HorizonEvaluationReport[];
} {
  const all = db.getEvaluations();
  const horizons = HORIZONS.map((h) => summarize(h, all.filter((e) => e.horizon === h)));
  return {
    minReliableSamples: MIN_RELIABLE_SAMPLES,
    overall: summarize('overall', all),
    horizons,
  };
}

function summarize(horizon: Horizon | 'overall', rows: EvaluationRow[]): HorizonEvaluationReport {
  const byLabel = (label: string) => rows.filter((r) => r.predicted_label === label);
  const bullish = byLabel('BULLISH');
  const bearish = byLabel('BEARISH');
  const neutral = byLabel('NEUTRAL');

  const buckets: EvaluationBucket[] = CONFIDENCE_BUCKETS.map(({ key, min, max }) => {
    const inBucket = rows.filter((r) => r.confidence >= min && r.confidence <= max);
    const correct = inBucket.filter((r) => r.correct === 1).length;
    const directional = inBucket.filter((r) => r.predicted_label !== 'NEUTRAL');
    return {
      bucket: key,
      total: inBucket.length,
      correct,
      accuracy: acc(correct, inBucket.length),
      avgConfidence: avg(inBucket.map((r) => r.confidence)),
      avgReturn: avg(directional.map((r) => (r.predicted_label === 'BULLISH' ? r.pct_change : -r.pct_change))),
    };
  });

  const sessions = ['Asia', 'Europe', 'EU/US overlap', 'US', 'Overnight'].map((session) => {
    const inSession = rows.filter((r) => r.session === session);
    const correct = inSession.filter((r) => r.correct === 1).length;
    return { session, total: inSession.length, correct, accuracy: acc(correct, inSession.length) };
  });

  return {
    horizon,
    totalEvaluated: rows.length,
    reliable: rows.length >= MIN_RELIABLE_SAMPLES,
    directionalAccuracy: acc(rows.filter((r) => r.correct === 1).length, rows.length),
    rawDirectionalAccuracy: acc(rows.filter((r) => r.raw_correct === 1).length, rows.length),
    bullishAccuracy: acc(bullish.filter((r) => r.correct === 1).length, bullish.length),
    bearishAccuracy: acc(bearish.filter((r) => r.correct === 1).length, bearish.length),
    neutralAccuracy: acc(neutral.filter((r) => r.correct === 1).length, neutral.length),
    avgReturnAfterBullish: avg(bullish.map((r) => r.pct_change)),
    avgReturnAfterBearish: avg(bearish.map((r) => r.pct_change)),
    byConfidenceBucket: buckets,
    bySession: sessions,
  };
}

// ---------------- component attribution ----------------

export interface ComponentAttribution {
  component: string;
  samples: number;
  /** How often the component's sign matched the realized direction (directional outcomes only). */
  directionAgreementPct: number | null;
  avgScoreWhenCorrect: number | null;
  avgScoreWhenIncorrect: number | null;
}

export interface AttributionReport {
  totalEvaluated: number;
  reliable: boolean;
  components: ComponentAttribution[];
  polymarketCategories: ComponentAttribution[];
}

/**
 * "When predictions were correct, which inputs were most useful?"
 * Measures only — never adjusts weights.
 */
export function buildAttributionReport(db: SignalDatabase): AttributionReport {
  const rows = db.getEvaluations();
  const componentNames = ['polymarket', 'technical', 'etf', 'macro', 'liquidity'];
  const catNames = ['btc-direct', 'fed', 'inflation', 'macro', 'geopolitical'];

  const compStats = new Map<string, { agree: number; directional: number; whenCorrect: number[]; whenIncorrect: number[]; samples: number }>();
  const init = () => ({ agree: 0, directional: 0, whenCorrect: [] as number[], whenIncorrect: [] as number[], samples: 0 });

  for (const row of rows) {
    let comps: Record<string, unknown>;
    try {
      comps = JSON.parse(row.components_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const realizedSign = row.actual_direction === 'up' ? 1 : row.actual_direction === 'down' ? -1 : 0;

    const record = (key: string, score: number) => {
      const stats = compStats.get(key) ?? init();
      stats.samples++;
      if (realizedSign !== 0 && Math.abs(score) > 3) {
        stats.directional++;
        if (Math.sign(score) === realizedSign) stats.agree++;
      }
      if (row.correct === 1) stats.whenCorrect.push(score);
      else stats.whenIncorrect.push(score);
      compStats.set(key, stats);
    };

    for (const name of componentNames) {
      const score = comps[name];
      if (typeof score === 'number') record(name, score);
    }
    const cats = comps.polymarketCategories as Record<string, number> | undefined;
    if (cats) {
      for (const cat of catNames) {
        if (typeof cats[cat] === 'number') record(`poly:${cat}`, cats[cat]);
      }
    }
  }

  const toAttribution = (name: string, key: string): ComponentAttribution => {
    const s = compStats.get(key);
    if (!s) return { component: name, samples: 0, directionAgreementPct: null, avgScoreWhenCorrect: null, avgScoreWhenIncorrect: null };
    return {
      component: name,
      samples: s.samples,
      directionAgreementPct: s.directional > 0 ? +((s.agree / s.directional) * 100).toFixed(1) : null,
      avgScoreWhenCorrect: avg(s.whenCorrect),
      avgScoreWhenIncorrect: avg(s.whenIncorrect),
    };
  };

  return {
    totalEvaluated: rows.length,
    reliable: rows.length >= MIN_RELIABLE_SAMPLES,
    components: componentNames.map((n) => toAttribution(n, n)),
    polymarketCategories: catNames.map((c) => toAttribution(c, `poly:${c}`)),
  };
}

// ---------------- divergence performance ----------------

export interface DivergencePerformance {
  events: Array<{
    id: number;
    ts: number;
    kind: string;
    message: string;
    btc_change_pct: number;
    poly_shift_score: number;
    outcome4h: number | null;
    outcome24h: number | null;
  }>;
  summary: Array<{ kind: string; total: number; resolved: number; agreeing: number; agreementPct: number | null }>;
}

/** Realized BTC move after each divergence event — measured, not acted on. */
export function buildDivergenceReport(db: SignalDatabase): DivergencePerformance {
  const events = db.getRecentDivergences(200);
  const enriched = events.map((e) => {
    const priceAt = db.getBtcPriceAt(e.ts, 10 * 60_000);
    const outcome = (hours: number): number | null => {
      const future = db.getBtcPriceAt(e.ts + hours * 3_600_000, 30 * 60_000);
      if (priceAt === null || future === null) return null;
      return +(((future - priceAt) / priceAt) * 100).toFixed(3);
    };
    return { ...e, outcome4h: outcome(4), outcome24h: outcome(24) };
  });

  const summary = ['bullish-divergence', 'bearish-divergence'].map((kind) => {
    const ofKind = enriched.filter((e) => e.kind === kind);
    const resolved = ofKind.filter((e) => e.outcome24h !== null);
    const agreeing = resolved.filter((e) =>
      kind === 'bullish-divergence' ? e.outcome24h! > 0 : e.outcome24h! < 0,
    ).length;
    return {
      kind,
      total: ofKind.length,
      resolved: resolved.length,
      agreeing,
      agreementPct: resolved.length > 0 ? +((agreeing / resolved.length) * 100).toFixed(1) : null,
    };
  });

  return { events: enriched, summary };
}
