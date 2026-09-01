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
}

export interface PolymarketSnapshot {
  markets: PolymarketMarket[];
  source: string;
  timestamp: number;
  freshness: Freshness;
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
