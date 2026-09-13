export type Horizon = '1h' | '4h' | '24h' | '72h';
export const HORIZONS: Horizon[] = ['1h', '4h', '24h', '72h'];

export type SignalLabel = 'BULLISH' | 'NEUTRAL' | 'BEARISH';

export type Freshness = 'fresh' | 'stale' | 'unavailable';

export interface DataPoint<T> {
  value: T;
  source: string;
  timestamp: number;
  freshness: Freshness;
}

export type PolymarketCategory = 'btc-direct' | 'fed' | 'inflation' | 'macro' | 'geopolitical';

export interface PolymarketMarket {
  id: string;
  title: string;
  probability: number;
  probChange15m: number | null;
  probChange1h: number | null;
  probChange4h: number | null;
  probChange24h: number | null;
  volume: number;
  liquidity: number;
  expirationDate: string | null;
  relevanceScore: number;
  category: PolymarketCategory;
  bullishDirection: 1 | -1;
  lastUpdated: number;
  /** 0..1 — how much usable directional information this market carries right now. */
  informationValue: number;
  /** Probability velocity over the last hour, in percentage points per hour (null: no history). */
  velocityPpPerHour: number | null;
  /** 0..1 — how consistent recent probability steps are (1 = smooth one-way drift). */
  persistence: number | null;
}

export interface PolymarketSnapshot {
  markets: PolymarketMarket[];
  source: string;
  timestamp: number;
  freshness: Freshness;
  /** How long we have been collecting snapshots, in minutes (drives cold-start labeling). */
  historyMinutes: number;
}

export interface BitcoinTechnicals {
  price: number;
  change1h: number | null;
  change4h: number | null;
  change24h: number | null;
  volume24h: number | null;
  volumeChange24h: number | null;
  volatility24h: number | null;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  source: string;
  timestamp: number;
  freshness: Freshness;
}

export interface EtfFlows {
  netFlowToday: number | null;
  netFlowPrevDay: number | null;
  rolling3Day: number | null;
  rolling5Day: number | null;
  /** Calendar date (YYYY-MM-DD) of the latest available trading-day observation. */
  dataDate: string | null;
  source: string;
  timestamp: number;
  freshness: Freshness;
  available: boolean;
}

export interface MacroData {
  dxy: number | null;
  dxyChange24h: number | null;
  us2y: number | null;
  us10y: number | null;
  fedCutProbability: number | null;
  cpiContext: string | null;
  upcomingEvents: Array<{ name: string; date: string }>;
  source: string;
  timestamp: number;
  freshness: Freshness;
  available: boolean;
}

export interface LiquidityContext {
  sessionName: string;
  sessionQuality: number;
  volumeQuality: number;
  israelHour: number;
  timestamp: number;
}

export interface ComponentScore {
  score: number;
  weight: number;
  available: boolean;
  freshness: Freshness;
  details: Record<string, unknown>;
  reasons: string[];
  risks: string[];
}

export type EdgeStatus = 'proven' | 'unproven' | 'inverse' | 'insufficient';

/** Score-sign agreement statistics for one horizon (the honest edge measure). */
export interface EdgeStats {
  horizon: Horizon;
  status: EdgeStatus;
  window: string;
  n: number;
  agree: number;
  rate: number | null;
  lowerBound: number | null;
  upperBound: number | null;
}

/** Split-conformal interval for the horizon's realized % move. */
export interface ConformalInterval {
  center: number;
  lo80: number;
  hi80: number;
  lo50: number;
  hi50: number;
  beta: number;
  nCalibration: number;
  baselineHalfWidth80: number;
}

/** Empirical up-rate among past non-flat outcomes with a similar score. */
export interface SimilarStates {
  bucket: string;
  n: number;
  upRate: number | null;
  lowerBound: number | null;
  upperBound: number | null;
}

export interface HorizonSignal {
  horizon: Horizon;
  /** Stabilized label (hysteresis applied) — what the UI shows. */
  label: SignalLabel;
  /** Label straight from thresholds, before hysteresis. */
  rawLabel: SignalLabel;
  finalScore: number;
  confidence: number;
  reasons: string[];
  risks: string[];
  components: {
    polymarket: ComponentScore;
    technical: ComponentScore;
    etf: ComponentScore;
    macro: ComponentScore;
    liquidity: ComponentScore;
  };
  btcPrice: number | null;
  timestamp: number;
  /** True while probability history is too short for this horizon's Polymarket deltas. */
  limitedHistory: boolean;
  historyNote: string | null;
  /** Everything needed to reproduce why this signal was generated (persisted as JSON). */
  context: SignalContext;
  /** Edge gate: when not 'proven', the UI must not present the label as actionable. */
  edge: EdgeStats | null;
  gated: boolean;
  conformal: ConformalInterval | null;
  similarStates: SimilarStates | null;
  regime: MarketRegime;
}

export type MarketRegime = 'trend-up' | 'trend-down' | 'range' | 'high-vol' | 'unknown';

export interface Candle1m {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * Volume bought by takers (aggressors). null when the source cannot tell the taker
   * side apart (Kraken/Coinbase REST candles) — such candles are excluded from CVD
   * rather than fabricated as a 50/50 split.
   */
  takerBuyVolume: number | null;
}

export interface CvdSnapshot {
  /** (buy − sell) / (buy + sell) per window, −1..1; null when too few candles. */
  ratio15m: number | null;
  ratio1h: number | null;
  ratio4h: number | null;
  candles: number;
}

export interface ExchangeTick {
  price: number;
  ts: number;
}

export interface PriceConsensus {
  price: number | null;
  ts: number;
  exchanges: Record<string, ExchangeTick | null>;
  freshExchanges: number;
  spreadPct: number | null;
  anomaly: boolean;
  anomalyNote: string | null;
}

export interface SignalContext {
  appliedWeights: Record<string, number>;
  configuredWeights: Record<string, number>;
  providerFreshness: Record<string, Freshness>;
  unavailableProviders: string[];
  session: string;
  polymarketMarketsUsed: Array<{
    id: string;
    title: string;
    category: PolymarketCategory;
    probability: number;
    changeUsedPp: number | null;
    informationValue: number;
    liquidity: number;
  }>;
  polymarketCategoryScores: Partial<Record<PolymarketCategory, number>>;
  technicalValues: Record<string, unknown>;
  macroValues: Record<string, unknown>;
  etfValues: Record<string, unknown>;
  /** Phase 5 provenance (optional for rows written before it existed). */
  regime?: MarketRegime;
  edgeGate?: { status: EdgeStatus; lowerBound: number | null; n: number; window: string } | null;
  conformal?: ConformalInterval | null;
  priceAnomaly?: { anomaly: boolean; note: string | null; spreadPct: number | null } | null;
  livePrice?: { source: 'consensus' | 'rest'; exchanges: number } | null;
  /** Experimental 1h score, recorded for out-of-sample comparison only. */
  hourlyShadow?: import('./scoring/shadow.js').HourlyShadowSignal | null;
}

export interface SignalBundle {
  signals: Record<Horizon, HorizonSignal>;
  generatedAt: number;
}

export interface Alert {
  id: number;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  horizon: Horizon | null;
  timestamp: number;
  acknowledged: boolean;
}

export interface HistoricalSignalRow {
  id: number;
  timestamp: number;
  horizon: Horizon;
  btc_price: number | null;
  polymarket_score: number;
  technical_score: number;
  etf_score: number;
  macro_score: number;
  liquidity_score: number;
  final_score: number;
  label: SignalLabel;
  confidence: number;
}

export interface EvaluationBucket {
  bucket: string;
  total: number;
  correct: number;
  accuracy: number | null;
  avgConfidence: number | null;
  avgReturn: number | null;
}

export type MarketSession = 'Asia' | 'Europe' | 'EU/US overlap' | 'US' | 'Overnight';

export interface StoredEvaluation {
  id: number;
  signal_id: number;
  horizon: Horizon;
  signal_ts: number;
  evaluated_ts: number;
  entry_price: number;
  future_price: number;
  abs_change: number;
  pct_change: number;
  predicted_label: SignalLabel;
  raw_label: SignalLabel;
  actual_direction: 'up' | 'down' | 'flat';
  correct: number;
  raw_correct: number;
  confidence: number;
  final_score: number;
  session: string;
  /** Neutral band (%) actually applied and which rule produced it — never mix v1/v2 rows blindly. */
  band_pct: number;
  band_method: 'fixed-v1' | 'vol-adaptive-v2';
  regime: MarketRegime;
}

export interface DivergenceEvent {
  id: number;
  ts: number;
  kind: 'bullish-divergence' | 'bearish-divergence';
  btc_change_pct: number;
  poly_shift_score: number;
  window_hours: number;
  message: string;
}

export interface ProviderHealth {
  name: string;
  status: 'LIVE' | 'DEGRADED' | 'DOWN' | 'UNAVAILABLE' | 'DAILY' | 'STALE';
  lastSuccessTs: number | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
  totalFailures: number;
  freshness: Freshness;
  note: string | null;
}
