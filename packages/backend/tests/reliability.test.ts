import { describe, expect, it } from 'vitest';
import { bernoulliCusum, conformalQuantile, linearFit, quantile, wilsonInterval } from '../src/utils/stats.js';
import { computeConsensus, computeCvd, parseRestKline, parseWsKline } from '../src/providers/priceStream.js';
import {
  classifyRegime, computeEdgeStats, conformalCoverage, driftReport, fitConformal, neutralBandPct,
  realizedHorizonSigmaPct, scoreBucket, similarStates, type EvalLike,
} from '../src/scoring/edge.js';
import { SignalDatabase } from '../src/db/database.js';
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

  it('parses REST and WS kline shapes', () => {
    const rest = parseRestKline([NOW, '1', '2', '0.5', '1.5', '100', 0, '0', 5, '60', '0', '0'])!;
    expect(rest.takerBuyVolume).toBe(60);
    expect(rest.close).toBe(1.5);
    const ws = parseWsKline({ k: { t: NOW, o: '1', h: '2', l: '0.5', c: '1.5', v: '100', V: '40', x: true } })!;
    expect(ws.closed).toBe(true);
    expect(ws.candle.takerBuyVolume).toBe(40);
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

/** n rows with hits spread evenly at agreeRate (interleaved, not front-loaded). */
function evals(horizon: Horizon, n: number, agreeRate: number, score = 20): EvalLike[] {
  return Array.from({ length: n }, (_, i) => {
    const agree = Math.floor((i + 1) * agreeRate) !== Math.floor(i * agreeRate);
    return {
      horizon,
      signal_ts: NOW - (n - i) * 60_000,
      final_score: score,
      pct_change: agree ? 1 : -1,
      actual_direction: agree ? 'up' : 'down',
      correct: agree ? 1 : 0,
    } as EvalLike;
  });
}

describe('edge gate (score-sign agreement with Wilson bounds)', () => {
  it('is insufficient below the sample floor', () => {
    expect(computeEdgeStats(evals('4h', 50, 0.9), '4h', NOW).status).toBe('insufficient');
  });

  it('proves edge only when the lower bound clears the threshold', () => {
    expect(computeEdgeStats(evals('4h', 400, 0.65), '4h', NOW).status).toBe('proven');
    expect(computeEdgeStats(evals('4h', 400, 0.53), '4h', NOW).status).toBe('unproven');
  });

  it('flags inverse edge when the model is reliably wrong', () => {
    const s = computeEdgeStats(evals('24h', 400, 0.2), '24h', NOW);
    expect(s.status).toBe('inverse');
    expect(s.upperBound!).toBeLessThan(EDGE_GATE_CONFIG.inverseUpperBound);
  });

  it('ignores flat outcomes and weak leans', () => {
    const rows = [...evals('1h', 200, 0.9, 2), ...evals('1h', 10, 0.5, 30)];
    const s = computeEdgeStats(rows, '1h', NOW);
    expect(s.n).toBe(10);
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
});

describe('similar states', () => {
  it('buckets scores and reports the empirical up-rate with a CI', () => {
    expect(scoreBucket(-30)).toBe('≤-25');
    expect(scoreBucket(0)).toBe('-3..3');
    expect(scoreBucket(15)).toBe('10..25');
    const s = similarStates(evals('4h', 200, 0.7, 15), '4h', 12, NOW);
    expect(s.bucket).toBe('10..25');
    expect(s.n).toBe(200);
    expect(s.upRate).toBeCloseTo(0.7, 2);
    expect(s.lowerBound!).toBeLessThan(0.7);
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
