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
  derivatives: envInt('REFRESH_DERIVATIVES_MS', 2 * 60_000),
  signalCompute: envInt('REFRESH_SIGNAL_MS', 60_000),
};

/** REST bases for spot candle sources (override for proxies/mirrors). */
export const EXCHANGE_API = {
  binance: process.env.BINANCE_API_URL ?? 'https://api.binance.com',
  kraken: process.env.KRAKEN_API_URL ?? 'https://api.kraken.com',
  coinbase: process.env.COINBASE_API_URL ?? 'https://api.exchange.coinbase.com',
};

/**
 * Candle sources are tried in this order until one answers; Binance is geo-blocked from
 * some hosting regions (HTTP 451), so Kraken/Coinbase keep technicals and the 1-minute
 * candle backfill alive there. Kraken/Coinbase candles carry no taker split (CVD comes
 * from the live trade streams instead).
 */
export const CANDLE_SOURCES = (process.env.CANDLE_SOURCES ?? 'binance,kraken,coinbase')
  .split(',')
  .map((s) => s.trim())
  .filter((s): s is 'binance' | 'kraken' | 'coinbase' => s === 'binance' || s === 'kraken' || s === 'coinbase');

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
  // Matched as whole words (see categorize()), so 'war' cannot match "awards" and
  // 'fed' matches "Fed's" / "the Fed?" without the old trailing-space hack.
  // A bare "interest rate" is deliberately NOT a Fed keyword: it also matches the RBA,
  // ECB, BoE and BoJ, whose decisions must not feed the US-rate expectation.
  keywords: {
    'btc-direct': ['bitcoin', 'btc'],
    fed: ['fed', 'federal reserve', 'fomc', 'rate cut', 'rate hike'],
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
  // Guards the backup download endpoint; disabled (404) when unset.
  backupToken: process.env.BACKUP_TOKEN,
};

/**
 * Nightly verified snapshot of the SQLite file. The collected evaluation history cannot be
 * recreated — a lost volume loses the product. Snapshots live beside the DB (same volume),
 * which protects against corruption and bad migrations but NOT against volume loss, so the
 * token-guarded download endpoint exists to pull them off-box.
 */
export const BACKUP_CONFIG = {
  enabled: process.env.BACKUPS !== 'off',
  /** Directory for snapshots; defaults next to the database so it lands on the volume. */
  dir: process.env.BACKUP_DIR ?? `${(process.env.DATABASE_PATH ?? process.env.DB_PATH ?? './data/signals.db').replace(/\/[^/]*$/, '')}/backups`,
  keep: envInt('BACKUP_KEEP', 7),
  intervalMs: envInt('BACKUP_INTERVAL_MS', 24 * 3_600_000),
  /** Minutes past midnight UTC for the first run — 03:00, away from the evaluator tick. */
  firstRunUtcMinute: envInt('BACKUP_UTC_MINUTE', 3 * 60),
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

/**
 * Live price stream (WebSocket → SSE). Consensus = median of fresh exchange
 * prices; an exchange deviating more than anomalyPct from the median, or a
 * cross-exchange spread above it, flags a data anomaly (lowers confidence).
 */
export const STREAM_CONFIG = {
  enabled: process.env.PRICE_STREAM !== 'off',
  binanceWs: process.env.BINANCE_WS_URL ?? 'wss://stream.binance.com:9443/stream?streams=btcusdt@trade',
  coinbaseWs: process.env.COINBASE_WS_URL ?? 'wss://ws-feed.exchange.coinbase.com',
  krakenWs: process.env.KRAKEN_WS_URL ?? 'wss://ws.kraken.com',
  tickFreshMs: 15_000,
  degradedAfterMs: 10_000,
  downAfterMs: 60_000,
  anomalyPct: 0.5,
  ssePushIntervalMs: 500,
  candleBackfillLimit: 300,
  /** How far back the one-time boot backfill pages 1-minute history (the chart's context). */
  candleHistoryHours: envInt('CANDLE_HISTORY_HOURS', 72),
  reconnectBaseMs: 2_000,
  reconnectMaxMs: 60_000,
  /**
   * 1-minute candles (and the taker buy/sell split behind CVD) are built from the live
   * trade streams of every connected exchange. A minute is closed only once it is this
   * far in the past, so a late trade from a slower venue still lands in the right minute.
   */
  tradeCandleGraceMs: 3_000,
  tradeCandleFlushMs: 5_000,
};

/**
 * Derivatives positioning (funding / open interest / liquidations) — tracking-only,
 * exactly like CMC news: zero model weight, its own table, route and CSV. Venues are
 * queried in parallel and any subset may answer; funding is normalized to an 8-hour
 * rate before venues are compared.
 */
export const DERIVATIVES_CONFIG = {
  enabled: process.env.DERIVATIVES !== 'off',
  krakenFuturesApi: process.env.KRAKEN_FUTURES_API_URL ?? 'https://futures.kraken.com',
  deribitApi: process.env.DERIBIT_API_URL ?? 'https://www.deribit.com',
  bitmexApi: process.env.BITMEX_API_URL ?? 'https://www.bitmex.com',
  bybitApi: process.env.BYBIT_API_URL ?? 'https://api.bybit.com',
  okxApi: process.env.OKX_API_URL ?? 'https://www.okx.com',
  requestTimeoutMs: 6_000,
  /** Positioning read on the venue-median 8h funding rate, in % (0.01% ≈ neutral). */
  crowdedLongPct: 0.03,
  crowdedShortPct: -0.01,
  liquidationWindowMinutes: 60,
  historyLookbackMs: 24 * 3_600_000,
};

/**
 * Order-flow (CVD) term inside the technical component: buy-vs-sell taker
 * imbalance over the horizon window, scaled so a 10% imbalance ≈ ±25.
 * Weight is INSIDE the technical composite; component weights are untouched.
 */
export const CVD_CONFIG = {
  enabled: process.env.CVD !== 'off',
  scale: 250,
  weightByHorizon: { '1h': 0.25, '4h': 0.25, '24h': 0.1, '72h': 0 } as Record<Horizon, number>,
  windowMinutesByHorizon: { '1h': 60, '4h': 240, '24h': 240, '72h': 240 } as Record<Horizon, number>,
  minCandles: 15,
};

/**
 * Volatility-adaptive neutral band (evaluation v2): band = k × realized σ of the
 * horizon, clamped to [floor, cap] around the legacy fixed band. k = 0.5
 * reproduces the fixed bands at typical BTC volatility and adapts elsewhere.
 * Every evaluation row stores the band it used, so old (fixed-v1) and new
 * (vol-adaptive-v2) rows are never confused.
 */
export const ADAPTIVE_BAND_CONFIG = {
  enabled: process.env.ADAPTIVE_BAND !== 'off',
  k: envFloat('BAND_K', 0.5),
  lookbackHours: 24 * 7,
  minSamples: 240,
  floorFactor: 0.5,
  capFactor: 3,
};

/**
 * "No proven edge" gate: a horizon may present a directional label only when
 * the lower Wilson bound of its score-sign agreement (non-flat outcomes,
 * |score| ≥ minScore) exceeds minLowerBound on at least minSamples evaluations.
 * The model's label/score are still computed, stored and evaluated — only the
 * presentation is gated, so edge can be proven later from the same data.
 */
export const EDGE_GATE_CONFIG = {
  enabled: process.env.EDGE_GATE !== 'off',
  minSamples: 100,
  minScore: 5,
  minLowerBound: 0.55,
  inverseUpperBound: 0.45,
  windowDays: 7,
  wilsonZ: 1.96,
};

/** Split conformal intervals: older half fits the center, newer half calibrates residuals. */
export const CONFORMAL_CONFIG = {
  maxWindow: 2000,
  minSamples: 60,
  alphas: [0.2, 0.5] as const,
  coverageCheckSamples: 200,
};

/** Bernoulli CUSUM drift alarm on score-sign agreement (reference 0.5, allowance k). */
export const DRIFT_CONFIG = {
  cusumK: 0.05,
  cusumH: 8,
  minSamples: 100,
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
