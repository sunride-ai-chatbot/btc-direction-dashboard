import { describe, expect, it } from 'vitest';
import { runPipeline, type PipelineProviders } from '../src/scoring/pipeline.js';
import { HORIZONS } from '../src/types.js';
import type { BitcoinTechnicals, EtfFlows, MacroData, PolymarketSnapshot } from '../src/types.js';

const now = Date.now();

function fakePolymarket(freshness: 'fresh' | 'unavailable' = 'fresh'): PolymarketSnapshot {
  if (freshness === 'unavailable') return { markets: [], source: 'fake', timestamp: now, freshness, historyMinutes: 0 };
  return {
    source: 'fake',
    timestamp: now,
    freshness,
    historyMinutes: 2000,
    markets: [
      {
        id: 'm1', title: 'Will Bitcoin reach $150k by Dec 31?', probability: 0.42,
        probChange15m: 0.003, probChange1h: 0.01, probChange4h: 0.03, probChange24h: 0.08,
        volume: 2_000_000, liquidity: 500_000, expirationDate: '2026-12-31',
        relevanceScore: 1.0, category: 'btc-direct', bullishDirection: 1, lastUpdated: now,
        informationValue: 0.9, velocityPpPerHour: 1.0, persistence: 0.8,
      },
      {
        id: 'm2', title: 'Will the Fed cut rates in October?', probability: 0.7,
        probChange15m: 0.001, probChange1h: 0.005, probChange4h: 0.01, probChange24h: 0.04,
        volume: 900_000, liquidity: 300_000, expirationDate: '2026-10-30',
        relevanceScore: 0.6, category: 'fed', bullishDirection: 1, lastUpdated: now,
        informationValue: 0.7, velocityPpPerHour: 0.5, persistence: 0.6,
      },
      {
        id: 'm3', title: 'Will Bitcoin dip to $60k in 2026?', probability: 0.15,
        probChange15m: -0.001, probChange1h: -0.002, probChange4h: -0.01, probChange24h: -0.03,
        volume: 400_000, liquidity: 150_000, expirationDate: '2026-12-31',
        relevanceScore: 1.0, category: 'btc-direct', bullishDirection: -1, lastUpdated: now,
        informationValue: 0.5, velocityPpPerHour: -0.2, persistence: 0.5,
      },
    ],
  };
}

function fakeTech(): BitcoinTechnicals {
  return {
    price: 79_000, change1h: 0.4, change4h: 1.1, change24h: 2.6,
    volume24h: 25_000, volumeChange24h: 18, volatility24h: 0.5,
    rsi14: 61, ema20: 78_200, ema50: 77_000, ema200: 71_000,
    macd: { line: 120, signal: 80, histogram: 0.8 },
    source: 'fake-binance', timestamp: now, freshness: 'fresh',
  };
}

function fakeEtf(available: boolean): EtfFlows {
  if (!available) {
    return { netFlowToday: null, netFlowPrevDay: null, rolling3Day: null, rolling5Day: null, dataDate: null, source: 'none', timestamp: now, freshness: 'unavailable', available: false };
  }
  return {
    netFlowToday: 80_000_000, netFlowPrevDay: 120_000_000, rolling3Day: 260_000_000, rolling5Day: 410_000_000, dataDate: '2026-08-31',
    source: 'fake-file', timestamp: now, freshness: 'fresh', available: true,
  };
}

function fakeMacro(available: boolean): MacroData {
  if (!available) {
    return { dxy: null, dxyChange24h: null, us2y: null, us10y: null, fedCutProbability: null, cpiContext: null, upcomingEvents: [], source: 'none', timestamp: now, freshness: 'unavailable', available: false };
  }
  return {
    dxy: 98.4, dxyChange24h: -0.45, us2y: 3.6, us10y: 4.1,
    fedCutProbability: null, cpiContext: null,
    upcomingEvents: [{ name: 'FOMC meeting', date: '2026-09-16' }],
    source: 'fake-stooq', timestamp: now, freshness: 'fresh', available: true,
  };
}

function providers(opts: { poly?: 'fresh' | 'unavailable'; etf?: boolean; macro?: boolean } = {}): PipelineProviders {
  return {
    polymarket: { fetchSnapshot: async () => fakePolymarket(opts.poly ?? 'fresh') },
    bitcoin: { fetchTechnicals: async () => fakeTech() },
    etf: { fetchFlows: async () => fakeEtf(opts.etf ?? true) },
    macro: { fetchMacro: async () => fakeMacro(opts.macro ?? true) },
  };
}

describe('scoring pipeline integration', () => {
  it('produces signals for all four horizons', async () => {
    const { bundle } = await runPipeline(providers());
    for (const h of HORIZONS) {
      const s = bundle.signals[h];
      expect(s).toBeDefined();
      expect(s.horizon).toBe(h);
      expect(['BULLISH', 'NEUTRAL', 'BEARISH']).toContain(s.label);
      expect(s.confidence).toBeGreaterThanOrEqual(5);
      expect(s.confidence).toBeLessThanOrEqual(95);
      expect(s.finalScore).toBeGreaterThanOrEqual(-100);
      expect(s.finalScore).toBeLessThanOrEqual(100);
      expect(s.reasons.length).toBeGreaterThan(0);
      expect(s.reasons.length).toBeLessThanOrEqual(3);
      expect(s.risks.length).toBeGreaterThan(0);
      expect(s.risks.length).toBeLessThanOrEqual(2);
    }
  });

  it('bullish inputs produce a bullish 24h signal', async () => {
    const { bundle } = await runPipeline(providers());
    const s = bundle.signals['24h'];
    expect(s.finalScore).toBeGreaterThan(0);
    expect(s.label).toBe('BULLISH');
    expect(s.btcPrice).toBe(79_000);
  });

  it('derives fed-cut probability from Polymarket fed markets', async () => {
    const { bundle } = await runPipeline(providers());
    const macroDetails = bundle.signals['24h'].components.macro.details as { fedCutProbability: number | null };
    expect(macroDetails.fedCutProbability).toBeCloseTo(0.7, 5);
  });

  it('survives Polymarket being down without crashing', async () => {
    const { bundle } = await runPipeline(providers({ poly: 'unavailable' }));
    const s = bundle.signals['24h'];
    expect(s.components.polymarket.available).toBe(false);
    expect(['BULLISH', 'NEUTRAL', 'BEARISH']).toContain(s.label);
  });

  it('reduces confidence when providers are missing', async () => {
    const full = await runPipeline(providers());
    const degraded = await runPipeline(providers({ etf: false, macro: false }));
    expect(degraded.bundle.signals['24h'].confidence).toBeLessThan(full.bundle.signals['24h'].confidence);
  });

  it('flags unavailable ETF source in risks or component state', async () => {
    const { bundle } = await runPipeline(providers({ etf: false }));
    expect(bundle.signals['24h'].components.etf.available).toBe(false);
  });
});
