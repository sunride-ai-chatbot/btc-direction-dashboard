import type { Horizon } from './types.js';

export interface ComponentWeights {
  polymarket: number;
  technical: number;
  etf: number;
  macro: number;
  liquidity: number;
}

export const HORIZON_WEIGHTS: Record<Horizon, ComponentWeights> = {
  '1h': { polymarket: 0.35, technical: 0.40, etf: 0.05, macro: 0.05, liquidity: 0.15 },
  '4h': { polymarket: 0.45, technical: 0.30, etf: 0.10, macro: 0.05, liquidity: 0.10 },
  '24h': { polymarket: 0.50, technical: 0.20, etf: 0.15, macro: 0.10, liquidity: 0.05 },
  '72h': { polymarket: 0.50, technical: 0.10, etf: 0.20, macro: 0.15, liquidity: 0.05 },
};

export const SIGNAL_THRESHOLDS = {
  bullish: 25,
  bearish: -25,
};

export const REFRESH_INTERVALS_MS = {
  btcPrice: envInt('REFRESH_BTC_MS', 60_000),
  polymarket: envInt('REFRESH_POLYMARKET_MS', 300_000),
  macro: envInt('REFRESH_MACRO_MS', 900_000),
  etf: envInt('REFRESH_ETF_MS', 3_600_000),
  signalCompute: envInt('REFRESH_SIGNAL_MS', 60_000),
};

export const FRESHNESS_LIMITS_MS = {
  btcPrice: 5 * 60_000,
  polymarket: 20 * 60_000,
  macro: 2 * 3_600_000,
  etf: 48 * 3_600_000,
};

export const ALERT_THRESHOLDS = {
  confidenceJump: 15,
  polymarketProbJump: 0.05,
  volumeSpikeRatio: 2.0,
};

export const POLYMARKET_CONFIG = {
  gammaBase: process.env.POLYMARKET_GAMMA_URL ?? 'https://gamma-api.polymarket.com',
  keywords: {
    'btc-direct': ['bitcoin', 'btc'],
    fed: ['fed ', 'federal reserve', 'rate cut', 'rate hike', 'fomc', 'interest rate'],
    inflation: ['cpi', 'inflation'],
    macro: ['recession', 'gdp', 'unemployment', 'treasury', 'stock market', 's&p'],
    geopolitical: ['war', 'election', 'tariff', 'china', 'sanctions'],
  } as Record<string, string[]>,
  categoryRelevance: {
    'btc-direct': 1.0,
    fed: 0.6,
    inflation: 0.45,
    macro: 0.4,
    geopolitical: 0.3,
  } as Record<string, number>,
  minLiquidity: 1_000,
  maxMarketsPerCategory: 12,
};

export const SERVER_CONFIG = {
  port: envInt('PORT', 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: process.env.DB_PATH ?? './data/signals.db',
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
