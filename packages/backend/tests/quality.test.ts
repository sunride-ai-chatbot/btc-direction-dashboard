import { describe, expect, it } from 'vitest';
import { informationValue, pathPersistence } from '../src/providers/polymarket.js';
import { detectDivergence } from '../src/scoring/divergence.js';
import { stabilizeLabel } from '../src/scoring/engine.js';
import { classifySession } from '../src/providers/liquidity.js';
import { SIGNAL_THRESHOLDS, HYSTERESIS_CONFIG } from '../src/config.js';
import type { BitcoinTechnicals, PolymarketMarket, PolymarketSnapshot } from '../src/types.js';

const now = Date.now();

function marketBase(overrides: Partial<PolymarketMarket>): Pick<
  PolymarketMarket,
  'probability' | 'liquidity' | 'volume' | 'expirationDate' | 'probChange15m' | 'probChange1h' | 'probChange4h'
> {
  return {
    probability: 0.5,
    liquidity: 200_000,
    volume: 200_000,
    expirationDate: new Date(now + 60 * 86_400_000).toISOString(),
    probChange15m: 0.002,
    probChange1h: 0.01,
    probChange4h: 0.02,
    ...overrides,
  };
}

describe('polymarket information value', () => {
  it('collapses for nearly resolved markets', () => {
    const mid = informationValue(marketBase({ probability: 0.5 }), now);
    const nearOne = informationValue(marketBase({ probability: 0.97 }), now);
    const nearZero = informationValue(marketBase({ probability: 0.03 }), now);
    expect(mid).toBeGreaterThan(0.5);
    expect(nearOne).toBeLessThan(mid * 0.5);
    expect(nearZero).toBeLessThan(mid * 0.5);
  });

  it('a liquid mid-probability market beats a 99% market decisively', () => {
    const liquid46 = informationValue(marketBase({ probability: 0.46, liquidity: 500_000 }), now);
    const resolved = informationValue(marketBase({ probability: 0.985, liquidity: 500_000 }), now);
    expect(liquid46).toBeGreaterThan(resolved * 3);
  });

  it('rewards depth', () => {
    const deep = informationValue(marketBase({ liquidity: 1_000_000, volume: 1_000_000 }), now);
    const shallow = informationValue(marketBase({ liquidity: 2_000, volume: 2_000 }), now);
    expect(deep).toBeGreaterThan(shallow);
  });

  it('decays markets about to resolve', () => {
    const far = informationValue(marketBase({}), now);
    const imminent = informationValue(marketBase({ expirationDate: new Date(now + 6 * 3_600_000).toISOString() }), now);
    expect(far).toBeGreaterThan(imminent);
  });

  it('dampens markets with zero recent activity', () => {
    const active = informationValue(marketBase({}), now);
    const dead = informationValue(marketBase({ probChange15m: 0, probChange1h: 0, probChange4h: 0 }), now);
    expect(active).toBeGreaterThan(dead);
  });

  it('stays within 0..1', () => {
    for (const p of [0.02, 0.2, 0.5, 0.8, 0.98]) {
      const v = informationValue(marketBase({ probability: p, liquidity: 10_000_000, volume: 10_000_000 }), now);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('probability momentum / persistence', () => {
  it('smooth one-way drift scores near 1', () => {
    expect(pathPersistence([0.42, 0.43, 0.45, 0.5])!).toBeGreaterThan(0.95);
  });

  it('spike-and-revert scores low', () => {
    expect(pathPersistence([0.42, 0.5, 0.43])!).toBeLessThan(0.15);
  });

  it('returns null for flat or too-short paths', () => {
    expect(pathPersistence([0.42, 0.42, 0.42])).toBeNull();
    expect(pathPersistence([0.42, 0.5])).toBeNull();
  });
});

function fakeTech(change4h: number | null): BitcoinTechnicals {
  return {
    price: 78_000, change1h: 0, change4h, change24h: 0, volume24h: 1000, volumeChange24h: 0,
    volatility24h: 0.4, rsi14: 50, ema20: 78_000, ema50: 78_000, ema200: 78_000, macd: null,
    source: 'fake', timestamp: now, freshness: 'fresh',
  };
}

function snapshotWithShift(probChange4h: number): PolymarketSnapshot {
  return {
    source: 'fake', timestamp: now, freshness: 'fresh', historyMinutes: 600,
    markets: [
      {
        id: 'm1', title: 'Will Bitcoin reach $150k?', probability: 0.45,
        probChange15m: 0, probChange1h: 0, probChange4h, probChange24h: 0,
        volume: 500_000, liquidity: 500_000, expirationDate: null,
        relevanceScore: 1, category: 'btc-direct', bullishDirection: 1, lastUpdated: now,
        informationValue: 0.9, velocityPpPerHour: null, persistence: null,
      },
    ],
  };
}

describe('divergence detection', () => {
  it('detects bullish divergence: price down, Polymarket up', () => {
    const d = detectDivergence(snapshotWithShift(0.03), fakeTech(-1.2), now);
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('bullish-divergence');
    expect(d!.btc_change_pct).toBeCloseTo(-1.2, 2);
    expect(d!.poly_shift_score).toBeGreaterThan(0);
  });

  it('detects bearish divergence: price up, Polymarket deteriorating', () => {
    const d = detectDivergence(snapshotWithShift(-0.03), fakeTech(1.5), now);
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('bearish-divergence');
  });

  it('stays silent when price and Polymarket agree', () => {
    expect(detectDivergence(snapshotWithShift(0.03), fakeTech(1.5), now)).toBeNull();
    expect(detectDivergence(snapshotWithShift(-0.03), fakeTech(-1.5), now)).toBeNull();
  });

  it('stays silent on small moves', () => {
    expect(detectDivergence(snapshotWithShift(0.002), fakeTech(-1.2), now)).toBeNull();
    expect(detectDivergence(snapshotWithShift(0.03), fakeTech(-0.2), now)).toBeNull();
  });

  it('requires both sources to be present', () => {
    expect(detectDivergence(snapshotWithShift(0.03), fakeTech(null), now)).toBeNull();
    const dead: PolymarketSnapshot = { markets: [], source: 'x', timestamp: now, freshness: 'unavailable', historyMinutes: 0 };
    expect(detectDivergence(dead, fakeTech(-1.2), now)).toBeNull();
  });
});

describe('signal hysteresis', () => {
  const enter = SIGNAL_THRESHOLDS.bullish;
  const { exitMargin, extremeScore } = HYSTERESIS_CONFIG;

  it('passes raw label through with no previous state', () => {
    expect(stabilizeLabel(null, 'BULLISH', 40)).toBe('BULLISH');
    expect(stabilizeLabel(null, 'BEARISH', -40)).toBe('BEARISH');
  });

  it('holds a directional label inside the sticky band', () => {
    expect(stabilizeLabel('BULLISH', 'NEUTRAL', enter - exitMargin + 1)).toBe('BULLISH');
    expect(stabilizeLabel('BULLISH', 'NEUTRAL', enter - exitMargin - 5)).toBe('NEUTRAL');
    expect(stabilizeLabel('BEARISH', 'NEUTRAL', -enter + exitMargin - 1)).toBe('BEARISH');
    expect(stabilizeLabel('BEARISH', 'NEUTRAL', -enter + exitMargin + 5)).toBe('NEUTRAL');
  });

  it('routes moderate direct flips through NEUTRAL', () => {
    expect(stabilizeLabel('BULLISH', 'BEARISH', -30)).toBe('NEUTRAL');
    expect(stabilizeLabel('BEARISH', 'BULLISH', 30)).toBe('NEUTRAL');
  });

  it('allows a direct flip on extreme score change', () => {
    expect(stabilizeLabel('BULLISH', 'BEARISH', -extremeScore)).toBe('BEARISH');
    expect(stabilizeLabel('BEARISH', 'BULLISH', extremeScore)).toBe('BULLISH');
  });

  it('enters directional states normally from NEUTRAL', () => {
    expect(stabilizeLabel('NEUTRAL', 'BULLISH', 30)).toBe('BULLISH');
    expect(stabilizeLabel('NEUTRAL', 'BEARISH', -30)).toBe('BEARISH');
    expect(stabilizeLabel('NEUTRAL', 'NEUTRAL', 0)).toBe('NEUTRAL');
  });
});

describe('session classification', () => {
  it('maps UTC timestamps to Israel-hour sessions', () => {
    // 2026-01-15 (winter, IST=UTC+2): 16:00 UTC = 18:00 IL → EU/US overlap
    expect(classifySession(Date.parse('2026-01-15T16:00:00Z'))).toBe('EU/US overlap');
    // 18:00 UTC = 20:00 IL → US session
    expect(classifySession(Date.parse('2026-01-15T18:00:00Z'))).toBe('US');
    // 10:00 UTC = 12:00 IL → Europe
    expect(classifySession(Date.parse('2026-01-15T10:00:00Z'))).toBe('Europe');
    // 03:00 UTC = 05:00 IL → Asia
    expect(classifySession(Date.parse('2026-01-15T03:00:00Z'))).toBe('Asia');
    // 23:00 UTC = 01:00 IL → Overnight
    expect(classifySession(Date.parse('2026-01-15T23:00:00Z'))).toBe('Overnight');
  });

  it('respects Israel DST (summer, IDT=UTC+3)', () => {
    // 2026-07-15 15:00 UTC = 18:00 IL → EU/US overlap
    expect(classifySession(Date.parse('2026-07-15T15:00:00Z'))).toBe('EU/US overlap');
  });
});
