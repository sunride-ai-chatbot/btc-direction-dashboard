import { describe, expect, it } from 'vitest';
import { classify, composeFinalScore, computeConfidence, buildSignal, type ComponentSet } from '../src/scoring/engine.js';
import { scoreEtf, scoreLiquidity, scorePolymarket, scoreTechnical } from '../src/scoring/scorers.js';
import { HORIZON_WEIGHTS, SIGNAL_THRESHOLDS } from '../src/config.js';
import { categorize, bullishDirection, fedPolicyDirection, relevance } from '../src/providers/polymarket.js';
import { getLiquidityContext, sessionFor } from '../src/providers/liquidity.js';
import { HORIZONS, type ComponentScore, type LiquidityContext, type PolymarketSnapshot, type BitcoinTechnicals, type EtfFlows } from '../src/types.js';

function comp(score: number, available = true): ComponentScore {
  return { score, weight: 0, available, freshness: available ? 'fresh' : 'unavailable', details: {}, reasons: [], risks: [] };
}

function componentSet(overrides: Partial<Record<keyof ComponentSet, ComponentScore>> = {}): ComponentSet {
  return {
    polymarket: comp(0),
    technical: comp(0),
    etf: comp(0),
    macro: comp(0),
    liquidity: comp(0),
    ...overrides,
  };
}

const neutralLiquidity: LiquidityContext = {
  sessionName: 'test', sessionQuality: 0.8, volumeQuality: 0.6, israelHour: 12, timestamp: 0,
};

describe('threshold classification', () => {
  it('classifies according to configured thresholds', () => {
    expect(classify(SIGNAL_THRESHOLDS.bullish)).toBe('BULLISH');
    expect(classify(100)).toBe('BULLISH');
    expect(classify(SIGNAL_THRESHOLDS.bearish)).toBe('BEARISH');
    expect(classify(-100)).toBe('BEARISH');
    expect(classify(0)).toBe('NEUTRAL');
    expect(classify(SIGNAL_THRESHOLDS.bullish - 1)).toBe('NEUTRAL');
    expect(classify(SIGNAL_THRESHOLDS.bearish + 1)).toBe('NEUTRAL');
  });
});

describe('horizon weights', () => {
  it('sum to 1.0 for every horizon', () => {
    for (const horizon of HORIZONS) {
      const w = HORIZON_WEIGHTS[horizon];
      const sum = w.polymarket + w.technical + w.etf + w.macro + w.liquidity;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it('gives short horizons more technical weight and long horizons more macro/etf weight', () => {
    expect(HORIZON_WEIGHTS['1h'].technical).toBeGreaterThan(HORIZON_WEIGHTS['72h'].technical);
    expect(HORIZON_WEIGHTS['72h'].macro).toBeGreaterThan(HORIZON_WEIGHTS['1h'].macro);
    expect(HORIZON_WEIGHTS['72h'].etf).toBeGreaterThan(HORIZON_WEIGHTS['1h'].etf);
  });

  it('keeps polymarket as the dominant component for 24h', () => {
    const w = HORIZON_WEIGHTS['24h'];
    expect(w.polymarket).toBeGreaterThanOrEqual(w.technical);
    expect(w.polymarket).toBeGreaterThanOrEqual(w.etf + w.macro);
  });
});

describe('score normalization / composition', () => {
  it('produces weighted sum when all components available', () => {
    const set = componentSet({ polymarket: comp(80), technical: comp(40) });
    const { finalScore } = composeFinalScore(set, '24h');
    expect(finalScore).toBeCloseTo(80 * 0.5 + 40 * 0.2, 1);
  });

  it('clamps to [-100, 100]', () => {
    const set = componentSet({
      polymarket: comp(100), technical: comp(100), etf: comp(100), macro: comp(100), liquidity: comp(100),
    });
    const { finalScore } = composeFinalScore(set, '24h');
    expect(finalScore).toBeLessThanOrEqual(100);
    expect(finalScore).toBeGreaterThanOrEqual(-100);
  });

  it('renormalizes weights when a provider is unavailable', () => {
    const set = componentSet({ polymarket: comp(60), etf: comp(0, false) });
    const { finalScore, appliedWeights } = composeFinalScore(set, '24h');
    expect(appliedWeights.etf).toBe(0);
    expect(finalScore).toBeCloseTo(60 * (0.5 / 0.85), 1);
  });

  it('returns 0 when everything is unavailable', () => {
    const set = componentSet({
      polymarket: comp(50, false), technical: comp(50, false), etf: comp(50, false),
      macro: comp(50, false), liquidity: comp(50, false),
    });
    expect(composeFinalScore(set, '4h').finalScore).toBe(0);
  });
});

describe('confidence calculation', () => {
  it('rises with agreement between components', () => {
    const agreeing = componentSet({ polymarket: comp(60), technical: comp(45), etf: comp(30), macro: comp(20) });
    const conflicting = componentSet({ polymarket: comp(60), technical: comp(-45), etf: comp(-30), macro: comp(-20) });
    const scoreA = composeFinalScore(agreeing, '24h').finalScore;
    const scoreC = composeFinalScore(conflicting, '24h').finalScore;
    expect(computeConfidence(agreeing, scoreA, neutralLiquidity)).toBeGreaterThan(
      computeConfidence(conflicting, scoreC, neutralLiquidity),
    );
  });

  it('drops when providers are unavailable', () => {
    const full = componentSet({ polymarket: comp(50), technical: comp(40) });
    const degraded = componentSet({ polymarket: comp(50), technical: comp(40), etf: comp(0, false), macro: comp(0, false) });
    const s = composeFinalScore(full, '24h').finalScore;
    const s2 = composeFinalScore(degraded, '24h').finalScore;
    expect(computeConfidence(degraded, s2, neutralLiquidity)).toBeLessThan(computeConfidence(full, s, neutralLiquidity));
  });

  it('is reduced in thin liquidity sessions', () => {
    const set = componentSet({ polymarket: comp(50), technical: comp(40) });
    const score = composeFinalScore(set, '24h').finalScore;
    const deep: LiquidityContext = { ...neutralLiquidity, sessionQuality: 1.0, volumeQuality: 1.0 };
    const thin: LiquidityContext = { ...neutralLiquidity, sessionQuality: 0.4, volumeQuality: 0.3 };
    expect(computeConfidence(set, score, deep)).toBeGreaterThan(computeConfidence(set, score, thin));
  });

  it('never reaches 0 or 100', () => {
    const max = componentSet({ polymarket: comp(100), technical: comp(100), etf: comp(100), macro: comp(100) });
    const scoreMax = composeFinalScore(max, '24h').finalScore;
    const c = computeConfidence(max, scoreMax, { ...neutralLiquidity, sessionQuality: 1, volumeQuality: 1 });
    expect(c).toBeLessThanOrEqual(95);
    expect(c).toBeGreaterThanOrEqual(5);

    const none = componentSet({
      polymarket: comp(0, false), technical: comp(0, false), etf: comp(0, false), macro: comp(0, false), liquidity: comp(0, false),
    });
    const c2 = computeConfidence(none, 0, { ...neutralLiquidity, sessionQuality: 0.4, volumeQuality: 0.3 });
    expect(c2).toBeGreaterThanOrEqual(5);
  });
});

describe('polymarket relevance + categorization', () => {
  it('categorizes titles correctly', () => {
    expect(categorize('Will Bitcoin reach $100k by December 31?')).toBe('btc-direct');
    expect(categorize('Will the Fed cut rates in September?')).toBe('fed');
    expect(categorize('Will CPI come in above 3.0%?')).toBe('inflation');
    expect(categorize('US recession declared in 2026?')).toBe('macro');
    expect(categorize('Who will win the dog show?')).toBeNull();
  });

  it('scores BTC-direct markets as most relevant', () => {
    const btc = relevance('Will Bitcoin reach $100k?', 'btc-direct', 100_000);
    const fed = relevance('Will the Fed cut rates?', 'fed', 100_000);
    const geo = relevance('Will tariffs increase?', 'geopolitical', 100_000);
    expect(btc).toBeGreaterThan(fed);
    expect(fed).toBeGreaterThan(geo);
  });

  it('boosts relevance with liquidity', () => {
    expect(relevance('Bitcoin $100k?', 'btc-direct', 1_000_000)).toBeGreaterThan(
      relevance('Bitcoin $100k?', 'btc-direct', 2_000),
    );
  });

  it('infers bullish direction from titles', () => {
    expect(bullishDirection('Will Bitcoin reach $150,000 by June?', 'btc-direct')).toBe(1);
    expect(bullishDirection('Will Bitcoin dip to $60,000 in 2026?', 'btc-direct')).toBe(-1);
    expect(bullishDirection('Will the Fed cut rates in October?', 'fed')).toBe(1);
    expect(bullishDirection('Will the Fed hike rates in 2026?', 'fed')).toBe(-1);
    expect(bullishDirection('Will CPI exceed 4% in September?', 'inflation')).toBe(-1);
    expect(bullishDirection('US recession in 2026?', 'macro')).toBe(-1);
  });

  it('returns null (excluded) when direction cannot be inferred', () => {
    expect(bullishDirection('Something ambiguous about bitcoin', 'btc-direct')).toBeNull();
  });

  // Titles below are verbatim from production on 2026-09-13, where the most liquid Fed
  // market ($1.12M, 79.5%) was scored BULLISH because "incr(ease)" matched a substring
  // test on /ease/ — inverting the highest-weight component and the derived cut probability.
  it('REGRESSION: a rate-HIKE market is bearish even when its wording contains "ease"', () => {
    const hikes = [
      'Will the Fed increase interest rates by 25 bps after the September 2026 meeting?',
      'Fed Rate Hike by October 2026 Meeting?',
      'Fed rate hike in 2026?',
      'Will the Fed raise rates in December?',
      'Fed increases rates before July?',
    ];
    for (const title of hikes) {
      expect(fedPolicyDirection(title), title).toBe('hike');
      expect(bullishDirection(title, 'fed'), title).toBe(-1);
    }
  });

  it('keeps genuine easing markets bullish, and reads "no rate cut" as a bet against easing', () => {
    expect(fedPolicyDirection('Will the Fed cut rates in October?')).toBe('cut');
    expect(bullishDirection('Will the Fed cut rates in October?', 'fed')).toBe(1);
    expect(bullishDirection('Fed emergency rate cut in 2026?', 'fed')).toBe(1);
    expect(fedPolicyDirection('No rate cut in September?')).toBe('hike');
    expect(bullishDirection('No rate cut in September?', 'fed')).toBe(-1);
    // Genuinely two-sided wording must stay excluded rather than guessed.
    expect(fedPolicyDirection('Will the Fed cut or hike in March?')).toBeNull();
    expect(bullishDirection('Will the Fed cut or hike in March?', 'fed')).toBeNull();
  });

  it('REGRESSION: whole-word matching — "war" must not fire on "Awards", nor "fed" on other central banks', () => {
    expect(categorize('Who will win Album of the Year at the Awards?')).toBeNull();
    expect(categorize('Will Warner Bros be sold in 2026?')).toBeNull();
    expect(categorize('Will China invade Taiwan by end of 2026?')).toBe('geopolitical');
    expect(bullishDirection('Will China invade Taiwan by end of 2026?', 'geopolitical')).toBe(-1);
    // Other central banks must not be mistaken for the Fed.
    expect(categorize('Will the RBA raise interest rates in November?')).not.toBe('fed');
    expect(categorize('Will the ECB cut interest rates in Q4?')).not.toBe('fed');
    // ...while real Fed phrasings still categorize, including possessives and end-of-string.
    expect(categorize("What will the Fed's decision be?")).toBe('fed');
    expect(categorize('Emergency rate cut by the Fed?')).toBe('fed');
  });
});

describe('unavailable providers', () => {
  it('polymarket scorer flags unavailable snapshot', () => {
    const snapshot: PolymarketSnapshot = { markets: [], source: 'x', timestamp: 0, freshness: 'unavailable', historyMinutes: 0 };
    const result = scorePolymarket(snapshot, '24h');
    expect(result.available).toBe(false);
    expect(result.score).toBe(0);
  });

  it('etf scorer never fabricates when unavailable', () => {
    const etf: EtfFlows = {
      netFlowToday: null, netFlowPrevDay: null, rolling3Day: null, rolling5Day: null,
      source: 'none', timestamp: 0, freshness: 'unavailable', available: false,
    };
    const result = scoreEtf(etf);
    expect(result.available).toBe(false);
    expect(result.score).toBe(0);
    expect(result.risks.length).toBeGreaterThan(0);
  });

  it('technical scorer handles unavailable price data', () => {
    const tech: BitcoinTechnicals = {
      price: 0, change1h: null, change4h: null, change24h: null, volume24h: null,
      volumeChange24h: null, volatility24h: null, rsi14: null, ema20: null, ema50: null,
      ema200: null, macd: null, source: 'none', timestamp: 0, freshness: 'unavailable',
    };
    expect(scoreTechnical(tech, '1h').available).toBe(false);
  });

  it('buildSignal still produces a signal with all providers down', () => {
    const set = componentSet({
      polymarket: comp(0, false), technical: comp(0, false), etf: comp(0, false), macro: comp(0, false),
    });
    const signal = buildSignal(set, '24h', neutralLiquidity, null, Date.now());
    expect(signal.label).toBe('NEUTRAL');
    expect(signal.confidence).toBeLessThan(40);
    expect(signal.risks.length).toBeGreaterThan(0);
  });
});

describe('liquidity component', () => {
  it('never contributes to direction (score always 0)', () => {
    const deep = scoreLiquidity({ sessionName: 'EU/US overlap', sessionQuality: 1, volumeQuality: 1, israelHour: 18, timestamp: 0 });
    const thin = scoreLiquidity({ sessionName: 'Overnight', sessionQuality: 0.4, volumeQuality: 0.2, israelHour: 1, timestamp: 0 });
    expect(deep.score).toBe(0);
    expect(thin.score).toBe(0);
  });

  it('maps Israel hours to sessions', () => {
    expect(sessionFor(18).name).toContain('overlap');
    expect(sessionFor(20).quality).toBeGreaterThan(sessionFor(1).quality);
  });

  it('builds a context with Israel hour', () => {
    const ctx = getLiquidityContext(new Date(), 0.5);
    expect(ctx.israelHour).toBeGreaterThanOrEqual(0);
    expect(ctx.israelHour).toBeLessThan(24);
  });
});
