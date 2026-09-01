import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignalDatabase } from '../src/db/database.js';
import { buildEvaluationReport, buildAttributionReport, CONFIDENCE_BUCKETS } from '../src/scoring/reports.js';
import { runEvaluationPass, HORIZON_MS } from '../src/scoring/evaluator.js';
import type { HorizonSignal } from '../src/types.js';

function makeSignal(ts: number, label: 'BULLISH' | 'NEUTRAL' | 'BEARISH', confidence: number, price = 100_000): HorizonSignal {
  const comp = (score: number) => ({
    score, weight: 0.2, available: true, freshness: 'fresh' as const, details: {}, reasons: [], risks: [],
  });
  return {
    horizon: '1h', label, rawLabel: label, finalScore: label === 'BULLISH' ? 40 : label === 'BEARISH' ? -40 : 0,
    confidence, reasons: [], risks: [],
    components: { polymarket: comp(45), technical: comp(-20), etf: comp(0), macro: comp(5), liquidity: comp(0) },
    btcPrice: price, timestamp: ts, limitedHistory: false, historyNote: null,
    context: {
      appliedWeights: {}, configuredWeights: {}, providerFreshness: {}, unavailableProviders: ['etf'],
      session: 'US', polymarketMarketsUsed: [], polymarketCategoryScores: { 'btc-direct': 45 },
      technicalValues: {}, macroValues: {}, etfValues: {},
    },
  };
}

describe('historical snapshot calculations', () => {
  it('computes probability at a past timestamp within tolerance', () => {
    const db = new SignalDatabase(':memory:');
    const now = Date.now();
    db.insertPolymarketSnapshot([
      { marketId: 'm1', title: 't', probability: 0.4, volume: 1, liquidity: 1, ts: now - 3_600_000 },
      { marketId: 'm1', title: 't', probability: 0.45, volume: 1, liquidity: 1, ts: now },
    ]);
    expect(db.getProbabilityAt('m1', now - 3_600_000, 5 * 60_000)).toBe(0.4);
    expect(db.getProbabilityAt('m1', now - 2 * 3_600_000, 5 * 60_000)).toBeNull();
  });

  it('returns chronological probability series for momentum', () => {
    const db = new SignalDatabase(':memory:');
    const now = Date.now();
    for (const [i, p] of [0.42, 0.43, 0.45, 0.5].entries()) {
      db.insertPolymarketSnapshot([{ marketId: 'm1', title: 't', probability: p, volume: 1, liquidity: 1, ts: now - (3 - i) * 300_000 }]);
    }
    const series = db.getProbabilitySeries('m1', now - 3_600_000);
    expect(series.map((s) => s.probability)).toEqual([0.42, 0.43, 0.45, 0.5]);
    expect(db.getEarliestSnapshotTs()).toBe(now - 3 * 300_000);
  });
});

describe('database persistence & migration', () => {
  it('data survives close/reopen and re-migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btcdb-'));
    const path = join(dir, 'test.db');
    try {
      const db1 = new SignalDatabase(path);
      const t0 = Date.now() - HORIZON_MS['1h'] - 60_000;
      db1.insertSignal(makeSignal(t0, 'BULLISH', 72));
      db1.insertBtcPrice(t0 + HORIZON_MS['1h'], 101_000, null);
      db1.insertPolymarketSnapshot([{ marketId: 'm1', title: 't', probability: 0.5, volume: 1, liquidity: 1, ts: t0 }]);
      db1.insertAlert('test', 'hello', 'info', null, t0);
      runEvaluationPass(db1);
      expect(db1.countEvaluations()).toBe(1);
      db1.close();

      const db2 = new SignalDatabase(path);
      expect(db2.countEvaluations()).toBe(1);
      expect(db2.getSignalHistory('1h', 10)).toHaveLength(1);
      expect(db2.getRecentAlerts(10)).toHaveLength(1);
      expect(db2.getEarliestSnapshotTs()).toBe(t0);
      expect(db2.getLatestLabels()['1h']).toBe('BULLISH');
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('evaluation reports', () => {
  it('aggregates accuracy into the five confidence buckets', () => {
    const db = new SignalDatabase(':memory:');
    const base = Date.now() - HORIZON_MS['1h'] - 10 * 60_000;
    const cases: Array<{ conf: number; label: 'BULLISH' | 'BEARISH'; futurePrice: number }> = [
      { conf: 45, label: 'BULLISH', futurePrice: 101_000 },
      { conf: 55, label: 'BULLISH', futurePrice: 99_000 },
      { conf: 65, label: 'BEARISH', futurePrice: 99_000 },
      { conf: 75, label: 'BEARISH', futurePrice: 101_000 },
      { conf: 85, label: 'BULLISH', futurePrice: 101_000 },
    ];
    for (const [i, c] of cases.entries()) {
      const ts = base - i * 60_000;
      db.insertSignal({ ...makeSignal(ts, c.label, c.conf), horizon: '1h' });
      db.insertBtcPrice(ts + HORIZON_MS['1h'], c.futurePrice, null);
    }
    runEvaluationPass(db);
    const report = buildEvaluationReport(db);
    expect(report.overall.totalEvaluated).toBe(5);
    expect(report.overall.reliable).toBe(false);
    expect(CONFIDENCE_BUCKETS.map((b) => b.key)).toEqual(['0-49', '50-59', '60-69', '70-79', '80+']);

    const h1 = report.horizons.find((h) => h.horizon === '1h')!;
    const bucket = (k: string) => h1.byConfidenceBucket.find((b) => b.bucket === k)!;
    expect(bucket('0-49').total).toBe(1);
    expect(bucket('0-49').accuracy).toBe(100);
    expect(bucket('50-59').accuracy).toBe(0);
    expect(bucket('60-69').accuracy).toBe(100);
    expect(bucket('70-79').accuracy).toBe(0);
    expect(bucket('80+').accuracy).toBe(100);
    expect(h1.avgReturnAfterBullish).not.toBeNull();
    expect(h1.bySession.reduce((a, s) => a + s.total, 0)).toBe(5);
  });

  it('attribution report measures component agreement without changing weights', () => {
    const db = new SignalDatabase(':memory:');
    const t0 = Date.now() - HORIZON_MS['1h'] - 60_000;
    db.insertSignal(makeSignal(t0, 'BULLISH', 70));
    db.insertBtcPrice(t0 + HORIZON_MS['1h'], 101_000, null);
    runEvaluationPass(db);

    const report = buildAttributionReport(db);
    expect(report.totalEvaluated).toBe(1);
    const poly = report.components.find((c) => c.component === 'polymarket')!;
    const tech = report.components.find((c) => c.component === 'technical')!;
    expect(poly.directionAgreementPct).toBe(100);
    expect(tech.directionAgreementPct).toBe(0);
    const btcCat = report.polymarketCategories.find((c) => c.component === 'btc-direct')!;
    expect(btcCat.directionAgreementPct).toBe(100);
  });
});
