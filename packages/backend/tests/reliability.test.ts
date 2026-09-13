import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bernoulliCusum, conformalQuantile, linearFit, quantile, wilsonInterval } from '../src/utils/stats.js';
import { computeConsensus, computeCvd, parseRestKline } from '../src/providers/priceStream.js';
import {
  classifyRegime, computeEdgeStats, conformalCoverage, driftReport, fitConformal, neutralBandPct,
  realizedHorizonSigmaPct, scoreBucket, similarStates, thinToNonOverlapping, HORIZON_MINUTES, type EvalLike,
} from '../src/scoring/edge.js';
import { SignalDatabase, LATEST_SCHEMA_VERSION } from '../src/db/database.js';
import { currentBands, runEvaluationPass, HORIZON_MS } from '../src/scoring/evaluator.js';
import { buildSignal, type ComponentSet } from '../src/scoring/engine.js';
import { NEUTRAL_THRESHOLD_PCT, EDGE_GATE_CONFIG } from '../src/config.js';
import type { Candle1m, Horizon, HorizonSignal, LiquidityContext } from '../src/types.js';

const NOW = Date.parse('2026-09-08T18:00:00Z');

// ---------------- stats ----------------

describe('statistics helpers', () => {
  it('Wilson interval brackets the proportion and narrows with n', () => {
    const [lo1, hi1] = wilsonInterval(60, 100);
    const [lo2, hi2] = wilsonInterval(600, 1000);
    expect(lo1).toBeLessThan(0.6);
    expect(hi1).toBeGreaterThan(0.6);
    expect(hi2 - lo2).toBeLessThan(hi1 - lo1);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it('quantile and conformal quantile behave on small samples', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([], 0.5)).toBeNull();
    // conformal quantile is at least the plain empirical quantile (finite-sample correction)
    const r = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    expect(conformalQuantile(r, 0.2)!).toBeGreaterThanOrEqual(quantile(r, 0.8)!);
  });

  it('linear fit recovers slope/intercept', () => {
    const fit = linearFit([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(fit.slope).toBeCloseTo(2, 6);
    expect(fit.intercept).toBeCloseTo(1, 6);
    expect(linearFit([2, 2, 2], [1, 2, 3])!.slope).toBe(0);
  });

  it('Bernoulli CUSUM alarms on a degraded hit-rate but not on a healthy one', () => {
    const healthy = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 1 : 0) as 0 | 1);
    const degraded = Array.from({ length: 400 }, (_, i) => (i % 5 === 0 ? 1 : 0) as 0 | 1);
    expect(bernoulliCusum(healthy, 0.5, 0.05, 8).alarm).toBe(false);
    expect(bernoulliCusum(degraded, 0.5, 0.05, 8).alarm).toBe(true);
  });

  it('CUSUM alarm clears once performance recovers — it must not stay stuck true forever', () => {
    const badThenGood: Array<0 | 1> = [
      ...Array.from({ length: 200 }, (_, i) => (i % 5 === 0 ? 1 : 0) as 0 | 1), // clearly degraded, alarms
      ...Array.from({ length: 400 }, () => 1 as const), // long healthy recovery
    ];
    const midpoint = bernoulliCusum(badThenGood.slice(0, 200), 0.5, 0.05, 8);
    expect(midpoint.alarm).toBe(true);
    const full = bernoulliCusum(badThenGood, 0.5, 0.05, 8);
    expect(full.alarm).toBe(false); // recovered — must not be permanently stuck from the bad stretch
    expect(full.max).toBeGreaterThanOrEqual(8); // historical peak is still visible
  });
});

// ---------------- price stream ----------------

describe('multi-exchange price consensus', () => {
  it('takes the median of fresh exchanges and ignores stale ones', () => {
    const c = computeConsensus(
      { binance: { price: 100_000, ts: NOW }, coinbase: { price: 100_050, ts: NOW - 1000 }, kraken: { price: 90_000, ts: NOW - 60_000 } },
      NOW,
    );
    expect(c.freshExchanges).toBe(2);
    expect(c.price).toBe(100_025);
    expect(c.anomaly).toBe(false);
  });

  it('flags an anomaly when one exchange deviates from consensus', () => {
    const c = computeConsensus(
      { binance: { price: 100_000, ts: NOW }, coinbase: { price: 100_020, ts: NOW }, kraken: { price: 101_500, ts: NOW } },
      NOW,
    );
    expect(c.anomaly).toBe(true);
    expect(c.anomalyNote).toContain('kraken');
    expect(c.price).toBe(100_020);
  });

  it('returns null price with no fresh feeds', () => {
    const c = computeConsensus({ binance: null, coinbase: null, kraken: null }, NOW);
    expect(c.price).toBeNull();
    expect(c.freshExchanges).toBe(0);
  });
});

function candle(i: number, buyShare: number, volume = 10): Candle1m {
  return { ts: NOW - (300 - i) * 60_000, open: 1, high: 1, low: 1, close: 1, volume, takerBuyVolume: volume * buyShare };
}

describe('CVD from 1-minute candles', () => {
  it('computes buy/sell imbalance per window and withholds when too few candles', () => {
    const buyers = Array.from({ length: 300 }, (_, i) => candle(i, 0.6));
    const cvd = computeCvd(buyers);
    expect(cvd.ratio15m).toBeCloseTo(0.2, 3);
    expect(cvd.ratio1h).toBeCloseTo(0.2, 3);
    expect(cvd.ratio4h).toBeCloseTo(0.2, 3);
    expect(computeCvd(buyers.slice(0, 5)).ratio1h).toBeNull();
  });

  it('recent selling shows up in short windows before long ones', () => {
    const mixed = [...Array.from({ length: 280 }, (_, i) => candle(i, 0.6)), ...Array.from({ length: 20 }, (_, i) => candle(280 + i, 0.2))];
    const cvd = computeCvd(mixed);
    expect(cvd.ratio15m!).toBeLessThan(0);
    expect(cvd.ratio4h!).toBeGreaterThan(0);
  });

  it('a gap in the candle series shrinks the window instead of silently stretching it', () => {
    // 20 recent candles (20% buy-heavy) preceded by a 6-hour gap (a stream outage), then
    // 280 older candles (80% buy-heavy) further back still. The gap exceeds every window
    // checked here (15m/1h/4h), so none of the old, buy-heavy block is genuinely "within
    // the last hour/4h" of real time — a correct time-bounded window must see only the 20
    // recent candles for both ratio1h and ratio4h, both landing clearly negative.
    // The old count-based `slice(-n)` would instead pull in the tail of the 80%-buy older
    // block to pad out the count, flipping the sign positive — exactly the bug this closes.
    const recent = Array.from({ length: 20 }, (_, i) => ({
      ts: NOW - (20 - i) * 60_000, open: 1, high: 1, low: 1, close: 1, volume: 10, takerBuyVolume: 2, // 20% buy
    }));
    const older = Array.from({ length: 280 }, (_, i) => ({
      ts: NOW - 6 * 3_600_000 - (280 - i) * 60_000, open: 1, high: 1, low: 1, close: 1, volume: 10, takerBuyVolume: 8, // 80% buy
    }));
    const withGap = [...older, ...recent];

    // The old (buggy) count-based behavior on this exact data, for contrast:
    const buggyRatio4h = (() => {
      const slice = withGap.slice(-240);
      const buy = slice.reduce((a, c) => a + (c.takerBuyVolume ?? 0), 0);
      const total = slice.reduce((a, c) => a + c.volume, 0);
      return (buy - (total - buy)) / total;
    })();
    expect(buggyRatio4h).toBeGreaterThan(0); // confirms the old logic really did flip the sign

    const cvd = computeCvd(withGap, { m15: 15, h1: 60, h4: 240 }, 15);
    expect(cvd.ratio1h).not.toBeNull();
    expect(cvd.ratio1h!).toBeLessThan(0);
    expect(cvd.ratio4h).not.toBeNull();
    expect(cvd.ratio4h!).toBeLessThan(0); // fixed: correctly excludes the pre-gap block
  });

  it('parses the Binance REST kline shape (taker buy volume at index 9)', () => {
    const rest = parseRestKline([NOW, '1', '2', '0.5', '1.5', '100', 0, '0', 5, '60', '0', '0'])!;
    expect(rest.takerBuyVolume).toBe(60);
    expect(rest.close).toBe(1.5);
    expect(parseRestKline(['x'])).toBeNull();
  });
});

// ---------------- adaptive band / regime ----------------

describe('volatility-adaptive neutral band', () => {
  it('scales σ by sqrt(horizon) and reproduces fixed bands at typical vol', () => {
    // 1-minute log returns with σ ≈ 0.05% → σ_4h ≈ 0.05 × sqrt(240) ≈ 0.77%
    const prices: number[] = [100_000];
    for (let i = 1; i < 2000; i++) prices.push(prices[i - 1] * (1 + (i % 2 === 0 ? 0.0005 : -0.0005)));
    const s4 = realizedHorizonSigmaPct(prices, 1, '4h')!;
    expect(s4).toBeGreaterThan(0.6);
    expect(s4).toBeLessThan(0.9);
    const band = neutralBandPct('4h', s4);
    expect(band.method).toBe('vol-adaptive-v2');
    expect(band.bandPct).toBeGreaterThan(0.3);
    expect(band.bandPct).toBeLessThan(0.5);
  });

  it('clamps to floor/cap and falls back to fixed when σ is unknown', () => {
    expect(neutralBandPct('1h', null)).toEqual({ bandPct: NEUTRAL_THRESHOLD_PCT['1h'], method: 'fixed-v1' });
    expect(neutralBandPct('1h', 100).bandPct).toBe(+(NEUTRAL_THRESHOLD_PCT['1h'] * 3).toFixed(4));
    expect(neutralBandPct('1h', 0.0001).bandPct).toBe(+(NEUTRAL_THRESHOLD_PCT['1h'] * 0.5).toFixed(4));
  });
});

describe('regime classification', () => {
  it('detects trend, range, high-vol and unknown', () => {
    expect(classifyRegime({ price: 101_000, ema20: 100_000, ema50: 99_000, volatility24h: 0.5 })).toBe('trend-up');
    expect(classifyRegime({ price: 98_000, ema20: 99_000, ema50: 100_000, volatility24h: 0.5 })).toBe('trend-down');
    expect(classifyRegime({ price: 100_050, ema20: 100_000, ema50: 100_020, volatility24h: 0.5 })).toBe('range');
    expect(classifyRegime({ price: 100_000, ema20: 100_000, ema50: 100_000, volatility24h: 2 })).toBe('high-vol');
    expect(classifyRegime(null)).toBe('unknown');
    expect(classifyRegime({ price: 'x' })).toBe('unknown');
  });
});

// ---------------- edge gate ----------------

/**
 * n GENUINELY INDEPENDENT trials for a horizon: spaced exactly one horizon-length
 * apart, so thinToNonOverlapping is a no-op on this data (every row survives) and
 * `n` really does mean n independent outcomes — the property these tests need.
 * agreeRate is spread evenly (interleaved, not front-loaded).
 */
function evals(horizon: Horizon, n: number, agreeRate: number, score = 20): EvalLike[] {
  const stepMs = HORIZON_MINUTES[horizon] * 60_000;
  return Array.from({ length: n }, (_, i) => {
    const agree = Math.floor((i + 1) * agreeRate) !== Math.floor(i * agreeRate);
    return {
      horizon,
      signal_ts: NOW - (n - i) * stepMs,
      final_score: score,
      pct_change: agree ? 1 : -1,
      actual_direction: agree ? 'up' : 'down',
      correct: agree ? 1 : 0,
    } as EvalLike;
  });
}

/** Rows at PRODUCTION cadence (every 5 minutes) — the realistic, overlapping case. */
function productionCadenceEvals(horizon: Horizon, n: number, label: 'up' | 'down' = 'up', score = 20): EvalLike[] {
  return Array.from({ length: n }, (_, i) => ({
    horizon,
    signal_ts: NOW - (n - i) * 5 * 60_000,
    final_score: score,
    pct_change: 1,
    actual_direction: label,
    correct: 1,
  } as EvalLike));
}

describe('edge gate (score-sign agreement with Wilson bounds)', () => {
  it('is insufficient below the sample floor', () => {
    expect(computeEdgeStats(evals('4h', 50, 0.9), '4h', NOW, 90).status).toBe('insufficient');
  });

  it('proves edge only when the lower bound clears the threshold, given enough independent trials', () => {
    // 400 independent 4h trials need a window wide enough to contain them (400×4h ≈ 66.7 days).
    expect(computeEdgeStats(evals('4h', 400, 0.65), '4h', NOW, 90).status).toBe('proven');
    expect(computeEdgeStats(evals('4h', 400, 0.53), '4h', NOW, 90).status).toBe('unproven');
  });

  it('flags inverse edge when the model is reliably wrong', () => {
    // 400 independent 24h trials span ~400 days.
    const s = computeEdgeStats(evals('24h', 400, 0.2), '24h', NOW, 450);
    expect(s.status).toBe('inverse');
    expect(s.upperBound!).toBeLessThan(EDGE_GATE_CONFIG.inverseUpperBound);
  });

  it('ignores flat outcomes and weak leans', () => {
    const rows = [...evals('1h', 200, 0.9, 2), ...evals('1h', 10, 0.5, 30)];
    const s = computeEdgeStats(rows, '1h', NOW, 30);
    expect(s.n).toBe(10);
    expect(s.status).toBe('insufficient');
  });

  it('REGRESSION: 100 overlapping 5-minute-cadence rows inside one short stretch must NOT read as 100 independent trials', () => {
    // The exact scenario the review found: 100 signals persisted every 5 minutes across a
    // single ~8-hour bullish stretch, all correct — before the fix this returned status
    // 'proven' with n=100 despite representing roughly ONE real 24h outcome.
    const rows = productionCadenceEvals('24h', 100, 'up');
    const s = computeEdgeStats(rows, '24h', NOW, 30);
    expect(s.n).toBeLessThan(5); // ~1-2 genuinely independent 24h outcomes fit in an 8h stretch
    expect(s.status).toBe('insufficient');
  });
});

// ---------------- conformal ----------------

describe('split conformal intervals', () => {
  it('achieves ~80% coverage on exchangeable data and exposes β', () => {
    const rows: EvalLike[] = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 1000; i++) {
      const score = (rand() - 0.5) * 60;
      const noise = (rand() + rand() + rand() - 1.5) * 2;
      rows.push({ horizon: '4h', signal_ts: NOW - (1000 - i) * 60_000, final_score: score, pct_change: 0.02 * score + noise, actual_direction: 'up', correct: 1 });
    }
    const interval = fitConformal(rows, '4h')!;
    expect(interval).not.toBeNull();
    const iv = interval(20);
    expect(iv.beta).toBeGreaterThan(0.01);
    expect(iv.lo80).toBeLessThan(iv.center);
    expect(iv.hi80).toBeGreaterThan(iv.center);
    expect(iv.hi50 - iv.lo50).toBeLessThan(iv.hi80 - iv.lo80);
    const cov = conformalCoverage(rows, '4h', interval, 300);
    expect(cov.coverage80!).toBeGreaterThan(0.72);
    expect(cov.coverage80!).toBeLessThan(0.9);
  });

  it('returns null below the minimum sample size', () => {
    expect(fitConformal(evals('72h', 10, 0.5), '72h')).toBeNull();
  });

  it('REGRESSION: coverage must be measured on held-out rows, not the rows used to calibrate the interval', () => {
    // Build 1000 rows where the score/return relationship SHIFTS in the newest 200 rows
    // (a regime change) — a realistic case where the model's calibration goes stale.
    const rows: EvalLike[] = [];
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 800; i++) {
      const score = (rand() - 0.5) * 60;
      const noise = (rand() - 0.5) * 2;
      rows.push({ horizon: '4h', signal_ts: NOW - (1000 - i) * 60_000, final_score: score, pct_change: 0.02 * score + noise, actual_direction: 'up', correct: 1 });
    }
    for (let i = 800; i < 1000; i++) {
      const score = (rand() - 0.5) * 60;
      const noise = (rand() - 0.5) * 12; // 6x the earlier noise — a regime change concentrated in the tail
      rows.push({ horizon: '4h', signal_ts: NOW - (1000 - i) * 60_000, final_score: score, pct_change: 0.02 * score + noise, actual_direction: 'up', correct: 1 });
    }
    const heldOut = rows.slice(-200);
    const trainForCoverage = rows.slice(0, -200);

    // OLD (buggy) approach — what reports.ts did before the fix: fit on ALL rows (so the
    // calibration set already contains the 200 rows about to be "checked"), then check
    // coverage on that same tail.
    const tautologicalInterval = fitConformal(rows, '4h')!;
    const tautologicalCoverage = conformalCoverage(rows, '4h', tautologicalInterval, 200).coverage80!;

    // FIXED approach — exactly what reports.ts does now: fit only on rows BEFORE the held-out
    // tail, then check coverage exclusively on that genuinely unseen tail.
    const holdoutInterval = fitConformal(trainForCoverage, '4h')!;
    expect(holdoutInterval).not.toBeNull();
    const holdoutCoverage = conformalCoverage(heldOut, '4h', holdoutInterval, 200).coverage80!;

    // The point of the fix: these are no longer computed from overlapping data, so they are
    // free to diverge — and with a real regime shift concentrated in the tail, they do. A
    // tautological check (old behavior) cannot be trusted to reveal this kind of drift;
    // that is exactly the defect being closed here.
    expect(Math.abs(holdoutCoverage - tautologicalCoverage)).toBeGreaterThan(0.05);
    expect(holdoutInterval(0).nCalibration).not.toBe(tautologicalInterval(0).nCalibration);
  });
});

describe('similar states', () => {
  it('buckets scores and reports the empirical up-rate with a CI', () => {
    expect(scoreBucket(-30)).toBe('≤-25');
    expect(scoreBucket(0)).toBe('-3..3');
    expect(scoreBucket(15)).toBe('10..25');
    // 200 independent 4h trials span ~33.3 days.
    const s = similarStates(evals('4h', 200, 0.7, 15), '4h', 12, NOW, 40);
    expect(s.bucket).toBe('10..25');
    expect(s.n).toBe(200);
    expect(s.upRate).toBeCloseTo(0.7, 2);
    expect(s.lowerBound!).toBeLessThan(0.7);
  });

  it('REGRESSION: thins overlapping production-cadence peers before computing the up-rate', () => {
    const rows = productionCadenceEvals('4h', 100, 'up');
    const s = similarStates(rows, '4h', 20, NOW, 30);
    expect(s.n).toBeLessThan(100); // must not count 100 5-min-apart rows as 100 peers
  });
});

describe('drift report', () => {
  it('produces a daily series and alarms when agreement collapses', () => {
    const bad = evals('24h', 400, 0.2);
    const d = driftReport(bad, '24h');
    expect(d.alarm).toBe(true);
    expect(d.daily.length).toBeGreaterThan(0);
    const good = evals('24h', 400, 0.6);
    expect(driftReport(good, '24h').alarm).toBe(false);
  });

  it('REGRESSION: does not treat overlapping production-cadence rows as independent daily samples', () => {
    const rows = productionCadenceEvals('4h', 300, 'up'); // 300 rows × 5min ≈ 25 real hours
    const d = driftReport(rows, '4h');
    expect(d.n).toBeLessThan(10); // ~6 genuinely independent 4h outcomes fit in ~25 hours
  });
});

describe('thinToNonOverlapping', () => {
  it('keeps roughly one row per non-overlapping horizon-length window', () => {
    // 12 rows, 5 minutes apart, horizon = 1h (60 min) → windows hold up to 12 rows each,
    // so only 1 of these 12 survives.
    const rows = Array.from({ length: 12 }, (_, i) => ({ signal_ts: NOW + i * 5 * 60_000 }));
    expect(thinToNonOverlapping(rows, 60)).toHaveLength(1);
  });

  it('keeps a row exactly at the window boundary (inclusive) and drops one that falls just inside it', () => {
    const rows = [
      { signal_ts: NOW },
      { signal_ts: NOW + 60 * 60_000 }, // exactly one horizon later — boundary is inclusive, must survive
      { signal_ts: NOW + 61 * 60_000 }, // only 1 minute into the next window — must be dropped
    ];
    const kept = thinToNonOverlapping(rows, 60);
    expect(kept.map((r) => r.signal_ts)).toEqual([NOW, NOW + 60 * 60_000]);
  });

  it('is stable regardless of input order (sorts internally)', () => {
    const rows = [{ signal_ts: NOW + 200 * 60_000 }, { signal_ts: NOW }, { signal_ts: NOW + 100 * 60_000 }];
    const kept = thinToNonOverlapping(rows, 60);
    expect(kept.map((r) => r.signal_ts)).toEqual([NOW, NOW + 100 * 60_000, NOW + 200 * 60_000]);
  });
});

// ---------------- evaluator persistence + migration ----------------

function comp(score: number) {
  return { score, weight: 0.2, available: true, freshness: 'fresh' as const, details: {}, reasons: [], risks: [] };
}

function signalAt(ts: number, horizon: Horizon = '1h'): HorizonSignal {
  return {
    horizon, label: 'BULLISH', rawLabel: 'BULLISH', finalScore: 40, confidence: 60, reasons: [], risks: [],
    components: { polymarket: comp(50), technical: { ...comp(30), details: { price: 101_000, ema20: 100_000, ema50: 99_000, volatility24h: 0.4 } }, etf: comp(0), macro: comp(5), liquidity: comp(0) },
    btcPrice: 100_000, timestamp: ts, limitedHistory: false, historyNote: null,
    context: {
      appliedWeights: {}, configuredWeights: {}, providerFreshness: {}, unavailableProviders: [], session: 'US',
      polymarketMarketsUsed: [], polymarketCategoryScores: {}, technicalValues: { price: 101_000, ema20: 100_000, ema50: 99_000, volatility24h: 0.4 },
      macroValues: {}, etfValues: {},
    },
    edge: null, gated: true, conformal: null, similarStates: null, regime: 'trend-up',
  };
}

describe('evaluator provenance (band + regime)', () => {
  it('persists the band that judged each row and the regime; falls back to fixed-v1 without price history', () => {
    const db = new SignalDatabase(':memory:');
    const t0 = Date.now() - HORIZON_MS['1h'] - 60_000;
    db.insertSignal(signalAt(t0));
    db.insertBtcPrice(t0 + HORIZON_MS['1h'], 100_500, null);
    runEvaluationPass(db);
    const [e] = db.getEvaluations('1h');
    expect(e.band_method).toBe('fixed-v1');
    expect(e.band_pct).toBe(NEUTRAL_THRESHOLD_PCT['1h']);
    expect(e.regime).toBe('trend-up');
    db.close();
  });

  it('switches to vol-adaptive-v2 once enough 1-minute history exists', () => {
    const db = new SignalDatabase(':memory:');
    const now = Date.now();
    let p = 100_000;
    for (let i = 600; i > 0; i--) {
      p *= 1 + (i % 2 === 0 ? 0.0004 : -0.0004);
      db.insertBtcPrice(now - i * 60_000, p, null);
    }
    const bands = currentBands(db, now);
    expect(bands['4h'].method).toBe('vol-adaptive-v2');
    expect(bands['4h'].sigmaPct).not.toBeNull();
    expect(bands['4h'].bandPct).toBeGreaterThan(0);
    db.close();
  });
});

describe('edge gate inside buildSignal', () => {
  const liquidity: LiquidityContext = { sessionName: 'US', sessionQuality: 0.9, volumeQuality: 0.8, israelHour: 20, timestamp: NOW };
  const components = (): ComponentSet => ({
    polymarket: comp(60), technical: { ...comp(50), details: { price: 101_000, ema20: 100_000, ema50: 99_000, volatility24h: 0.4 } }, etf: comp(20), macro: comp(10), liquidity: comp(0),
  });

  it('gates the label when edge is not proven and passes it through when proven', () => {
    const gated = buildSignal(components(), '4h', liquidity, 100_000, NOW, null, 'US', {
      edge: { horizon: '4h', status: 'unproven', window: '7d', n: 300, agree: 150, rate: 0.5, lowerBound: 0.44, upperBound: 0.56 },
    });
    expect(gated.label).toBe('BULLISH');
    expect(gated.gated).toBe(true);
    expect(gated.context.edgeGate?.status).toBe('unproven');

    const proven = buildSignal(components(), '4h', liquidity, 100_000, NOW, null, 'US', {
      edge: { horizon: '4h', status: 'proven', window: '7d', n: 300, agree: 200, rate: 0.67, lowerBound: 0.61, upperBound: 0.72 },
    });
    expect(proven.gated).toBe(false);
  });

  it('attaches conformal range, similar states, regime and anomaly penalty', () => {
    const base = buildSignal(components(), '4h', liquidity, 100_000, NOW);
    const enriched = buildSignal(components(), '4h', liquidity, 100_000, NOW, null, 'US', {
      conformal: (score) => ({ center: score / 100, lo80: score / 100 - 1, hi80: score / 100 + 1, lo50: score / 100 - 0.5, hi50: score / 100 + 0.5, beta: 0.01, nCalibration: 500, baselineHalfWidth80: 1.2 }),
      similar: () => ({ bucket: '≥25', n: 40, upRate: 0.6, lowerBound: 0.45, upperBound: 0.74 }),
      priceAnomaly: { anomaly: true, note: 'kraken deviates 0.8% from consensus', spreadPct: 0.8 },
    });
    expect(enriched.conformal!.hi80).toBeGreaterThan(enriched.conformal!.lo80);
    expect(enriched.similarStates!.n).toBe(40);
    expect(enriched.regime).toBe('trend-up');
    expect(enriched.confidence).toBeLessThan(base.confidence);
    expect(enriched.risks[0]).toContain('price anomaly');
  });
});

// ---------------- v5 migration crash-safety ----------------

/** Hand-rolled v1-v4 schema (mirrors database.ts) so we can drive the DB into a known
 *  "about to run v5" state without depending on SignalDatabase's private methods. */
function createV4Database(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE polymarket_history (market_id TEXT, title TEXT, probability REAL, volume REAL, liquidity REAL, ts INTEGER);
    CREATE TABLE btc_price_history (ts INTEGER, price REAL, volume REAL);
    CREATE TABLE signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, horizon TEXT, btc_price REAL,
      polymarket_score REAL, technical_score REAL, etf_score REAL, macro_score REAL, liquidity_score REAL,
      final_score REAL, label TEXT, confidence REAL, reasons_json TEXT, risks_json TEXT,
      raw_label TEXT, context_json TEXT
    );
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, message TEXT, severity TEXT, horizon TEXT, ts INTEGER, acknowledged INTEGER DEFAULT 0);
    CREATE TABLE evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, signal_id INTEGER UNIQUE, horizon TEXT, signal_ts INTEGER, evaluated_ts INTEGER,
      entry_price REAL, future_price REAL, abs_change REAL, pct_change REAL, predicted_label TEXT, raw_label TEXT,
      actual_direction TEXT, correct INTEGER, raw_correct INTEGER, confidence REAL, final_score REAL, session TEXT, components_json TEXT
    );
    CREATE TABLE divergences (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, btc_change_pct REAL, poly_shift_score REAL, window_hours REAL, message TEXT);
    CREATE TABLE etf_flow_history (date TEXT PRIMARY KEY, net_flow REAL, source TEXT, fetched_at INTEGER);
    CREATE TABLE news_items (post_id TEXT PRIMARY KEY, published_ts INTEGER, fetched_at INTEGER, source TEXT, url TEXT, text TEXT, category TEXT, relevance REAL, sentiment_score REAL, direction TEXT, impact TEXT);
    INSERT INTO signals (id, ts, horizon, btc_price, polymarket_score, technical_score, etf_score, macro_score, liquidity_score, final_score, label, confidence, reasons_json, risks_json, raw_label, context_json)
      VALUES (1, 1000, '1h', 100000, 10, 10, 0, 0, 0, 10, 'BULLISH', 60, '[]', '[]', 'BULLISH', '{}');
    INSERT INTO evaluations (signal_id, horizon, signal_ts, evaluated_ts, entry_price, future_price, abs_change, pct_change, predicted_label, raw_label, actual_direction, correct, raw_correct, confidence, final_score, session, components_json)
      VALUES (1, '1h', 1000, 2000, 100000, 100500, 500, 0.5, 'BULLISH', 'BULLISH', 'up', 1, 1, 60, 10, 'US', '{}');
    PRAGMA user_version = 4;
  `);
  db.close();
}

describe('v5 migration crash-safety', () => {
  it('a clean run completes to user_version 5 with the new schema and preserves existing rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btcdb-v5-'));
    const path = join(dir, 'test.db');
    try {
      createV4Database(path);
      const db = new SignalDatabase(path);
      expect(db.countsByTable().signals).toBe(1);
      expect(db.countsByTable().evaluations).toBe(1);
      expect(db.getEvaluations(undefined, { allEpochs: true })[0].band_method).toBe('fixed-v1');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REGRESSION: an interrupted migration (uncommitted transaction) leaves the schema untouched, and a retry then succeeds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btcdb-v5-crash-'));
    const path = join(dir, 'test.db');
    try {
      createV4Database(path);

      // Simulate the process dying mid-migration: start the same DDL the v5 step runs,
      // inside an explicit transaction, then close the connection WITHOUT committing.
      // SQLite rolls back an open transaction when its connection closes without COMMIT —
      // exactly what happens on a hard process kill (e.g. Railway's SIGTERM window).
      const crashing = new DatabaseSync(path);
      crashing.exec('BEGIN');
      crashing.exec(`
        ALTER TABLE evaluations ADD COLUMN band_pct REAL;
        ALTER TABLE evaluations ADD COLUMN band_method TEXT;
        ALTER TABLE evaluations ADD COLUMN regime TEXT;
      `);
      crashing.close(); // no COMMIT — the ALTERs above must not survive

      // Confirm the "crash" really did leave the columns uncommitted, so this test would
      // have failed against the pre-fix code (which had no transaction to roll back).
      const check = new DatabaseSync(path);
      const cols = (check.prepare('PRAGMA table_info(evaluations)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols).not.toContain('band_pct');
      // Still at the pre-migration version: the rolled-back attempt changed nothing.
      expect((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
      check.close();

      // The real retry, through the actual (fixed) migration path, must succeed cleanly —
      // no "duplicate column name" from a half-applied prior attempt.
      const recovered = new SignalDatabase(path);
      expect(recovered.countsByTable().signals).toBe(1);
      expect(recovered.getEvaluations(undefined, { allEpochs: true })[0].band_method).toBe('fixed-v1');
      recovered.close();

      const final = new DatabaseSync(path);
      expect((final.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
      final.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** A genuine v5 database: the v4 fixture plus exactly the DDL the v5 step applied, including the NOT NULL taker column. */
function createV5Database(path: string): void {
  createV4Database(path);
  const db = new DatabaseSync(path);
  db.exec(`
    ALTER TABLE evaluations ADD COLUMN band_pct REAL;
    ALTER TABLE evaluations ADD COLUMN band_method TEXT;
    ALTER TABLE evaluations ADD COLUMN regime TEXT;
    CREATE TABLE btc_candles_1m (
      ts INTEGER PRIMARY KEY, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      volume REAL NOT NULL, taker_buy_volume REAL NOT NULL
    );
    INSERT INTO btc_candles_1m VALUES (60000, 1, 2, 0.5, 1.5, 100, 60);
    PRAGMA user_version = 5;
  `);
  db.close();
}

describe('v6 migration — nullable taker split + derivatives history', () => {
  it('rebuilds btc_candles_1m keeping every row, accepts candles without a taker split, and adds derivatives_history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btcdb-v6-'));
    const path = join(dir, 'test.db');
    try {
      createV5Database(path);
      const db = new SignalDatabase(path);
      expect(db.countsByTable().btc_candles_1m).toBe(1);
      expect(db.countsByTable().derivatives_history).toBe(0);
      expect(db.getRecentCandles(10)[0].takerBuyVolume).toBe(60);

      // The v5 schema would have rejected this (NOT NULL); v6 must accept it.
      db.upsertCandle({ ts: 120_000, open: 1, high: 1, low: 1, close: 1, volume: 5, takerBuyVolume: null });
      const candles = db.getRecentCandles(10);
      expect(candles.map((c) => c.takerBuyVolume)).toEqual([60, null]);
      db.close();

      const final = new DatabaseSync(path);
      expect((final.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
      expect(final.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'btc_candles_1m_v6'").all()).toHaveLength(0);
      final.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never lets a backfill candle without a taker split overwrite one that has it (DB side of preferCandle)', () => {
    const db = new SignalDatabase(':memory:');
    db.upsertCandle({ ts: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 10, takerBuyVolume: 7 });
    db.upsertCandle({ ts: 60_000, open: 2, high: 2, low: 2, close: 2, volume: 20, takerBuyVolume: null });
    let [c] = db.getRecentCandles(1);
    expect(c.takerBuyVolume).toBe(7);
    expect(c.volume).toBe(10); // the whole candle is kept, not just the split — buy/volume must share a basis
    // A candle WITH a split may replace either kind.
    db.upsertCandle({ ts: 60_000, open: 3, high: 3, low: 3, close: 3, volume: 30, takerBuyVolume: 9 });
    [c] = db.getRecentCandles(1);
    expect(c.takerBuyVolume).toBe(9);
    expect(c.volume).toBe(30);
    // A split-less candle may replace a split-less one (newer backfill wins).
    db.upsertCandle({ ts: 120_000, open: 1, high: 1, low: 1, close: 1, volume: 1, takerBuyVolume: null });
    db.upsertCandle({ ts: 120_000, open: 4, high: 4, low: 4, close: 4, volume: 4, takerBuyVolume: null });
    expect(db.getRecentCandles(1)[0].volume).toBe(4);
    db.close();
  });
});
