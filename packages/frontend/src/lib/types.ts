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
