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
}

export interface SignalBundle {
  signals: Record<Horizon, HorizonSignal>;
  generatedAt: number;
}

export interface PolymarketMarket {
  id: string;
  title: string;
  probability: number;
  probChange1h: number | null;
  probChange4h: number | null;
  probChange24h: number | null;
  volume: number;
  liquidity: number;
  expirationDate: string | null;
  relevanceScore: number;
  category: string;
  bullishDirection: 1 | -1;
}

export interface PolymarketSnapshot {
  markets: PolymarketMarket[];
  source: string;
  timestamp: number;
  freshness: Freshness;
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
  confidence: number;
  reasons: string[];
  risks: string[];
}

export interface EvaluationBucket {
  bucket: string;
  total: number;
  correct: number;
  accuracy: number | null;
  avgReturn: number | null;
}

export interface EvaluationReport {
  horizon: Horizon;
  totalEvaluated: number;
  directionalAccuracy: number | null;
  bullishAccuracy: number | null;
  bearishAccuracy: number | null;
  neutralAccuracy: number | null;
  avgReturnAfterSignal: number | null;
  byConfidenceBucket: EvaluationBucket[];
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
