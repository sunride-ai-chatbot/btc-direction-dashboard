export type Horizon = '1h' | '4h' | '24h' | '72h';
export const HORIZONS: Horizon[] = ['1h', '4h', '24h', '72h'];

export type SignalLabel = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type Freshness = 'fresh' | 'stale' | 'unavailable';

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
export type MarketRegime = 'trend-up' | 'trend-down' | 'range' | 'high-vol' | 'unknown';

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

export interface SimilarStates {
  bucket: string;
  n: number;
  upRate: number | null;
  lowerBound: number | null;
  upperBound: number | null;
}

export interface HorizonSignal {
  horizon: Horizon;
  label: SignalLabel;
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
  limitedHistory: boolean;
  historyNote: string | null;
  edge: EdgeStats | null;
  gated: boolean;
  conformal: ConformalInterval | null;
  similarStates: SimilarStates | null;
  regime: MarketRegime;
}

export interface CvdSnapshot {
  ratio15m: number | null;
  ratio1h: number | null;
  ratio4h: number | null;
  candles: number;
}

export interface StreamTick {
  type: 'tick';
  price: number | null;
  ts: number;
  exchanges: Record<string, { price: number; ts: number } | null>;
  freshExchanges: number;
  spreadPct: number | null;
  anomaly: boolean;
  anomalyNote: string | null;
  cvd: CvdSnapshot;
  streamStatus: 'fresh' | 'stale' | 'unavailable';
}

export interface HorizonReliability {
  horizon: Horizon;
  edge7d: EdgeStats;
  edgeAll: EdgeStats;
  drift: {
    horizon: Horizon;
    n: number;
    cusum: number;
    cusumMax: number;
    alarm: boolean;
    daily: Array<{ day: string; n: number; agree: number; rate: number | null; lower: number | null; upper: number | null }>;
  };
  byRegime: Array<{ regime: string; n: number; agree: number; rate: number | null; lower: number | null; upper: number | null }>;
  scoreDistribution: { p50Abs: number | null; p90Abs: number | null; maxAbs: number | null; directionalCallPct: number | null; flatRatePct: number | null; n: number };
  band: { currentPct: number; method: string; sigmaPct: number | null; fixedPct: number; adaptiveRowsPct: number | null };
  conformal: { available: boolean; nCalibration: number; coverage80: number | null; coverageN: number; halfWidth80AtZero: number | null; baselineHalfWidth80: number | null; beta: number | null };
}

export interface ReliabilityReport {
  generatedAt: number;
  minSamplesForEdge: number;
  horizons: HorizonReliability[];
}

export interface SignalBundle {
  signals: Record<Horizon, HorizonSignal>;
  generatedAt: number;
}

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
  category: string;
  bullishDirection: 1 | -1;
  informationValue: number;
  velocityPpPerHour: number | null;
  persistence: number | null;
}

export interface PolymarketSnapshot {
  markets: PolymarketMarket[];
  source: string;
  timestamp: number;
  freshness: Freshness;
  historyMinutes: number;
}

export interface HistoryRow {
  id: number;
  ts: number;
  horizon: Horizon;
  btc_price: number | null;
  polymarket_score: number;
  technical_score: number;
  etf_score: number;
  macro_score: number;
  liquidity_score: number;
  final_score: number;
  label: SignalLabel;
  raw_label: SignalLabel | null;
  confidence: number;
  reasons: string[];
  risks: string[];
}

export interface EvaluationBucket {
  bucket: string;
  total: number;
  correct: number;
  accuracy: number | null;
  avgConfidence: number | null;
  avgReturn: number | null;
}

export interface HorizonEvaluationReport {
  horizon: Horizon | 'overall';
  totalEvaluated: number;
  reliable: boolean;
  directionalAccuracy: number | null;
  rawDirectionalAccuracy: number | null;
  bullishAccuracy: number | null;
  bearishAccuracy: number | null;
  neutralAccuracy: number | null;
  avgReturnAfterBullish: number | null;
  avgReturnAfterBearish: number | null;
  byConfidenceBucket: EvaluationBucket[];
  bySession: Array<{ session: string; total: number; correct: number; accuracy: number | null }>;
}

export interface EvaluationReportPayload {
  minReliableSamples: number;
  overall: HorizonEvaluationReport;
  horizons: HorizonEvaluationReport[];
}

export interface ComponentAttribution {
  component: string;
  samples: number;
  directionAgreementPct: number | null;
  avgScoreWhenCorrect: number | null;
  avgScoreWhenIncorrect: number | null;
}

export interface AttributionReport {
  totalEvaluated: number;
  reliable: boolean;
  components: ComponentAttribution[];
  polymarketCategories: ComponentAttribution[];
}

export interface DivergencePerformance {
  events: Array<{
    id: number;
    ts: number;
    kind: string;
    message: string;
    btc_change_pct: number;
    poly_shift_score: number;
    outcome4h: number | null;
    outcome24h: number | null;
  }>;
  summary: Array<{ kind: string; total: number; resolved: number; agreeing: number; agreementPct: number | null }>;
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

export interface HealthPayload {
  processStartTs: number;
  serverTime: number;
  providers: ProviderHealth[];
  evaluationsStored: number;
  neutralThresholdsPct: Record<Horizon, number>;
  evaluationJobMs: number;
}

export interface AlertRow {
  id: number;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  horizon: Horizon | null;
  ts: number;
  acknowledged: number;
}

export type NewsCategory = 'market' | 'regulation' | 'institutional' | 'security' | 'macro' | 'defi' | 'other';
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW';

export interface NewsPost {
  id: string;
  text: string;
  publishedTs: number;
  fetchedAt: number;
  url: string;
  category: NewsCategory;
  relevance: number;
  sentimentScore: number;
  direction: SignalLabel;
  impact: NewsImpact;
  btcReaction: { m15: number | null; h1: number | null; h4: number | null; h24: number | null };
}

export interface NewsPayload {
  posts: NewsPost[];
  score: number;
  direction: SignalLabel;
  source: string;
  timestamp: number;
  freshness: Freshness;
  modelWeight: number;
  trackingOnly: boolean;
}
