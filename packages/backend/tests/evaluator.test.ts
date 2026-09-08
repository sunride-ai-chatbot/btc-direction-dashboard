import { describe, expect, it } from 'vitest';
import { SignalDatabase } from '../src/db/database.js';
import { actualDirection, isCorrect, runEvaluationPass, HORIZON_MS } from '../src/scoring/evaluator.js';
import { NEUTRAL_THRESHOLD_PCT } from '../src/config.js';
import type { HorizonSignal, SignalContext } from '../src/types.js';

function makeContext(): SignalContext {
  return {
    appliedWeights: { polymarket: 0.5 }, configuredWeights: { polymarket: 0.5 },
    providerFreshness: { polymarket: 'fresh' }, unavailableProviders: [],
    session: 'US', polymarketMarketsUsed: [],
    polymarketCategoryScores: { 'btc-direct': 40, fed: 10 },
    technicalValues: {}, macroValues: {}, etfValues: {},
  };
}

function makeSignal(overrides: Partial<HorizonSignal>): HorizonSignal {
  const comp = (score: number) => ({
    score, weight: 0.2, available: true, freshness: 'fresh' as const, details: {}, reasons: [], risks: [],
  });
  return {
    horizon: '1h', label: 'BULLISH', rawLabel: 'BULLISH', finalScore: 40, confidence: 60,
    reasons: ['r'], risks: ['k'],
    components: { polymarket: comp(50), technical: comp(30), etf: comp(0), macro: comp(10), liquidity: comp(0) },
    btcPrice: 100_000, timestamp: Date.now(), limitedHistory: false, historyNote: null,
    context: makeContext(),
    ...overrides,
  };
}

describe('neutral movement threshold', () => {
  it('classifies tiny moves as flat per explicit band', () => {
    expect(actualDirection(0.08, NEUTRAL_THRESHOLD_PCT['1h'])).toBe('flat');
    expect(actualDirection(NEUTRAL_THRESHOLD_PCT['1h'] + 0.01, NEUTRAL_THRESHOLD_PCT['1h'])).toBe('up');
    expect(actualDirection(-(NEUTRAL_THRESHOLD_PCT['1h'] + 0.01), NEUTRAL_THRESHOLD_PCT['1h'])).toBe('down');
    expect(actualDirection(0.5, NEUTRAL_THRESHOLD_PCT['24h'])).toBe('flat');
    expect(actualDirection(1.0, NEUTRAL_THRESHOLD_PCT['24h'])).toBe('up');
    expect(actualDirection(-2.0, NEUTRAL_THRESHOLD_PCT['72h'])).toBe('down');
    expect(actualDirection(-1.0, NEUTRAL_THRESHOLD_PCT['72h'])).toBe('flat');
  });

  it('scores correctness per label', () => {
    expect(isCorrect('BULLISH', 'up')).toBe(true);
    expect(isCorrect('BULLISH', 'flat')).toBe(false);
    expect(isCorrect('BEARISH', 'down')).toBe(true);
    expect(isCorrect('NEUTRAL', 'flat')).toBe(true);
    expect(isCorrect('NEUTRAL', 'up')).toBe(false);
  });
});

describe('future signal evaluation', () => {
  it('evaluates a due signal against the stored future price', () => {
    const db = new SignalDatabase(':memory:');
    const t0 = Date.now() - HORIZON_MS['1h'] - 5 * 60_000;
    db.insertSignal(makeSignal({ timestamp: t0, btcPrice: 100_000, label: 'BULLISH', rawLabel: 'BULLISH' }));
    db.insertBtcPrice(t0 + HORIZON_MS['1h'], 101_000, null);

    const result = runEvaluationPass(db);
    expect(result.evaluated).toBe(1);

    const evals = db.getEvaluations('1h');
    expect(evals).toHaveLength(1);
    expect(evals[0].entry_price).toBe(100_000);
    expect(evals[0].future_price).toBe(101_000);
    expect(evals[0].pct_change).toBeCloseTo(1.0, 3);
    expect(evals[0].actual_direction).toBe('up');
    expect(evals[0].correct).toBe(1);
    expect(evals[0].session).toBeTruthy();
    const comps = JSON.parse(evals[0].components_json);
    expect(comps.polymarket).toBe(50);
    expect(comps.polymarketCategories['btc-direct']).toBe(40);
  });

  it('marks a bullish call wrong when price fell', () => {
    const db = new SignalDatabase(':memory:');
    const t0 = Date.now() - HORIZON_MS['1h'] - 60_000;
    db.insertSignal(makeSignal({ timestamp: t0, btcPrice: 100_000 }));
    db.insertBtcPrice(t0 + HORIZON_MS['1h'], 99_000, null);
    runEvaluationPass(db);
    const [e] = db.getEvaluations('1h');
    expect(e.actual_direction).toBe('down');
    expect(e.correct).toBe(0);
  });

  it('records raw vs stabilized correctness separately', () => {
    const db = new SignalDatabase(':memory:');
    const t0 = Date.now() - HORIZON_MS['1h'] - 60_000;
    db.insertSignal(makeSignal({ timestamp: t0, btcPrice: 100_000, label: 'NEUTRAL', rawLabel: 'BEARISH' }));
    db.insertBtcPrice(t0 + HORIZON_MS['1h'], 99_000, null);
    runEvaluationPass(db);
    const [e] = db.getEvaluations('1h');
    expect(e.correct).toBe(0);
    expect(e.raw_correct).toBe(1);
  });

  it('does not evaluate signals whose horizon has not elapsed', () => {
    const db = new SignalDatabase(':memory:');
    db.insertSignal(makeSignal({ timestamp: Date.now() - 10 * 60_000 }));
    const result = runEvaluationPass(db);
    expect(result.evaluated).toBe(0);
    expect(db.getEvaluations()).toHaveLength(0);
  });

  it('never evaluates twice and never fabricates missing future prices', () => {
    const db = new SignalDatabase(':memory:');
    const t0 = Date.now() - HORIZON_MS['1h'] - 60_000;
    db.insertSignal(makeSignal({ timestamp: t0, btcPrice: 100_000 }));
    // no price history at all → cannot evaluate
    expect(runEvaluationPass(db).evaluated).toBe(0);
    db.insertBtcPrice(t0 + HORIZON_MS['1h'], 100_500, null);
    expect(runEvaluationPass(db).evaluated).toBe(1);
    expect(runEvaluationPass(db).evaluated).toBe(0);
    expect(db.getEvaluations()).toHaveLength(1);
  });
});
