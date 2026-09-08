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
  news: envInt('REFRESH_NEWS_MS', 5 * 60_000),
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

const onRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;

export const SERVER_CONFIG = {
  // Railway injects PORT; local default stays 8787.
  port: envInt('PORT', 8787),
  // Railway routes traffic to the container IP — must bind 0.0.0.0 there.
  host: process.env.HOST ?? (onRailway ? '0.0.0.0' : '127.0.0.1'),
  // Production: DATABASE_PATH points into the persistent volume (e.g. /data/bitcoin-dashboard.sqlite).
  // Local dev keeps ./data/signals.db. DB_PATH kept as legacy alias.
  dbPath: process.env.DATABASE_PATH ?? process.env.DB_PATH ?? './data/signals.db',
  // Comma-separated allowed origins; unset = allow all (dev / public read-only API).
  corsOrigin: process.env.CORS_ORIGIN,
  // One-time DB import guard; endpoint is disabled when unset.
  importToken: process.env.IMPORT_TOKEN,
};

/**
 * Evaluation: a realized move smaller than the horizon's band (in %) counts as
 * "flat" — a BULLISH/BEARISH call is only correct beyond it, and NEUTRAL is
 * correct inside it.
 */
export const NEUTRAL_THRESHOLD_PCT: Record<Horizon, number> = {
  '1h': envFloat('NEUTRAL_PCT_1H', 0.15),
  '4h': envFloat('NEUTRAL_PCT_4H', 0.35),
  '24h': envFloat('NEUTRAL_PCT_24H', 0.8),
  '72h': envFloat('NEUTRAL_PCT_72H', 1.5),
};

/** How close to the target horizon a future price must be to count (fraction of horizon). */
export const EVALUATION_CONFIG = {
  jobIntervalMs: envInt('EVAL_JOB_MS', 5 * 60_000),
  priceToleranceFraction: 0.1,
  minPriceToleranceMs: 10 * 60_000,
};

/**
 * Label hysteresis. Raw label comes straight from SIGNAL_THRESHOLDS; the displayed
 * (stabilized) label additionally requires:
 *  - crossing threshold + exitMargin to LEAVE a directional state, and
 *  - a direct BULLISH<->BEARISH flip only when the score reaches extremeScore.
 */
export const HYSTERESIS_CONFIG = {
  exitMargin: 7,
  extremeScore: 45,
};

/** Polymarket information value + momentum knobs. */
export const INFO_VALUE_CONFIG = {
  minUsefulDays: 2,
  fullValueDays: 30,
  activityWindowMs: 6 * 3_600_000,
  velocityFullPpPerHour: 2,
};

/** Divergence detection between BTC price and aggregate Polymarket direction. */
export const DIVERGENCE_CONFIG = {
  windowHours: 4,
  minPriceMovePct: 0.6,
  minPolyShiftScore: 8,
  dedupWindowMs: 2 * 3_600_000,
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
