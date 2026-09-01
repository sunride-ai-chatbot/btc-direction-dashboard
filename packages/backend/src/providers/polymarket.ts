import { fetchJson } from '../utils/fetchJson.js';
import { clamp } from '../utils/indicators.js';
import { POLYMARKET_CONFIG, FRESHNESS_LIMITS_MS } from '../config.js';
import type { PolymarketCategory, PolymarketMarket, PolymarketSnapshot } from '../types.js';
import type { SignalDatabase } from '../db/database.js';

interface GammaMarket {
  id: string;
  question: string;
  outcomes?: string;
  outcomePrices?: string;
  volumeNum?: number;
  volume?: string | number;
  liquidityNum?: number;
  liquidity?: string | number;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
}

export interface PolymarketProvider {
  fetchSnapshot(): Promise<PolymarketSnapshot>;
}

export class GammaPolymarketProvider implements PolymarketProvider {
  private lastGood: PolymarketSnapshot | null = null;

  constructor(private db: SignalDatabase) {}

  async fetchSnapshot(): Promise<PolymarketSnapshot> {
    const now = Date.now();
    try {
      const raw = await this.discoverMarkets();
      const markets = raw
        .map((m) => this.normalize(m, now))
        .filter((m): m is PolymarketMarket => m !== null);

      this.db.insertPolymarketSnapshot(
        markets.map((m) => ({
          marketId: m.id,
          title: m.title,
          probability: m.probability,
          volume: m.volume,
          liquidity: m.liquidity,
          ts: now,
        })),
      );

      for (const m of markets) {
        m.probChange1h = this.change(m.id, m.probability, now, 1);
        m.probChange4h = this.change(m.id, m.probability, now, 4);
        m.probChange24h = this.change(m.id, m.probability, now, 24);
      }

      const snapshot: PolymarketSnapshot = {
        markets: markets.sort((a, b) => b.relevanceScore * Math.log10(1 + b.liquidity) - a.relevanceScore * Math.log10(1 + a.liquidity)),
        source: 'polymarket-gamma',
        timestamp: now,
        freshness: 'fresh',
      };
      this.lastGood = snapshot;
      return snapshot;
    } catch (err) {
      if (this.lastGood) {
        const age = now - this.lastGood.timestamp;
        return { ...this.lastGood, freshness: age > FRESHNESS_LIMITS_MS.polymarket ? 'unavailable' : 'stale' };
      }
      return { markets: [], source: 'polymarket-gamma', timestamp: now, freshness: 'unavailable' };
    }
  }

  /** Discovery: pull active markets ordered by 24h volume, multiple pages, then keyword-filter. */
  private async discoverMarkets(): Promise<GammaMarket[]> {
    const base = POLYMARKET_CONFIG.gammaBase;
    const pages = await Promise.allSettled([
      fetchJson<GammaMarket[]>(`${base}/markets?closed=false&active=true&limit=100&order=volume24hr&ascending=false`),
      fetchJson<GammaMarket[]>(`${base}/markets?closed=false&active=true&limit=100&offset=100&order=volume24hr&ascending=false`),
      fetchJson<GammaMarket[]>(`${base}/markets?closed=false&active=true&limit=100&order=liquidity&ascending=false`),
    ]);
    const seen = new Map<string, GammaMarket>();
    for (const page of pages) {
      if (page.status === 'fulfilled' && Array.isArray(page.value)) {
        for (const m of page.value) {
          if (m?.id && !seen.has(m.id)) seen.set(m.id, m);
        }
      }
    }
    if (seen.size === 0) throw new Error('Polymarket discovery returned no markets');
    return [...seen.values()];
  }

  private normalize(raw: GammaMarket, now: number): PolymarketMarket | null {
    if (!raw.question || raw.closed === true) return null;
    const category = categorize(raw.question);
    if (!category) return null;

    const probability = parseYesPrice(raw);
    if (probability === null) return null;

    const volume = toNum(raw.volumeNum ?? raw.volume) ?? 0;
    const liquidity = toNum(raw.liquidityNum ?? raw.liquidity) ?? 0;
    if (liquidity < POLYMARKET_CONFIG.minLiquidity && volume < POLYMARKET_CONFIG.minLiquidity) return null;

    const direction = bullishDirection(raw.question, category);
    if (direction === null) return null;

    return {
      id: raw.id,
      title: raw.question,
      probability,
      probChange1h: null,
      probChange4h: null,
      probChange24h: null,
      volume,
      liquidity,
      expirationDate: raw.endDate ?? null,
      relevanceScore: relevance(raw.question, category, liquidity),
      category,
      bullishDirection: direction,
      lastUpdated: now,
    };
  }

  private change(marketId: string, current: number, now: number, hoursAgo: number): number | null {
    const tolerance = Math.max(10 * 60_000, hoursAgo * 60_000 * 0.25);
    const past = this.db.getProbabilityAt(marketId, now - hoursAgo * 3_600_000, tolerance);
    if (past === null) return null;
    return current - past;
  }
}

export function categorize(title: string): PolymarketCategory | null {
  const t = title.toLowerCase();
  const kw = POLYMARKET_CONFIG.keywords;
  if (kw['btc-direct'].some((k) => t.includes(k))) return 'btc-direct';
  if (kw.fed.some((k) => t.includes(k))) return 'fed';
  if (kw.inflation.some((k) => t.includes(k))) return 'inflation';
  if (kw.macro.some((k) => t.includes(k))) return 'macro';
  if (kw.geopolitical.some((k) => t.includes(k))) return 'geopolitical';
  return null;
}

/**
 * Determines whether "YES probability rising" is bullish (+1) or bearish (-1) for BTC.
 * Returns null when direction cannot be inferred — such markets are excluded rather than guessed.
 */
export function bullishDirection(title: string, category: PolymarketCategory): 1 | -1 | null {
  const t = title.toLowerCase();
  const bearishPatterns = [/dip to/, /fall (below|to|under)/, /drop (below|to|under)/, /crash/, /below \$/, /less than \$/, /hike/, /raise rates/, /recession/, /above.*cpi/, /inflation.*(above|exceed|higher)/];
  const bullishPatterns = [/reach \$/, /hit \$/, /above \$/, /exceed \$/, /(all.time|ath)/, /\$\d+k?\s*(or higher|\+)/, /cut rates?/, /rate cut/, /lower rates/];

  if (category === 'btc-direct') {
    if (bearishPatterns.some((p) => p.test(t))) return -1;
    if (bullishPatterns.some((p) => p.test(t))) return 1;
    if (/\$\d/.test(t) && /(by|before|in) (dec|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|20\d\d)/.test(t)) return 1;
    return null;
  }
  if (category === 'fed') {
    if (/cut|lower|ease/.test(t)) return 1;
    if (/hike|raise|increase/.test(t)) return -1;
    return null;
  }
  if (category === 'inflation') {
    if (/(above|exceed|higher|over)/.test(t)) return -1;
    if (/(below|under|lower)/.test(t)) return 1;
    return null;
  }
  if (category === 'macro') {
    if (/recession|crash|default|shutdown/.test(t)) return -1;
    if (/(s&p|stock market|nasdaq).*(above|reach|hit|record)/.test(t)) return 1;
    return null;
  }
  if (category === 'geopolitical') {
    if (/war|invade|strike|conflict|sanctions|tariff/.test(t)) return -1;
    return null;
  }
  return null;
}

/** Relevance = category base scaled by liquidity depth (log scale), 0..1. */
export function relevance(title: string, category: PolymarketCategory, liquidity: number): number {
  const base = POLYMARKET_CONFIG.categoryRelevance[category] ?? 0.2;
  const liquidityFactor = clamp(Math.log10(1 + liquidity) / 6, 0, 1);
  const t = title.toLowerCase();
  const btcBonus = category !== 'btc-direct' && (t.includes('bitcoin') || t.includes('btc')) ? 0.1 : 0;
  return clamp(base * (0.7 + 0.3 * liquidityFactor) + btcBonus, 0, 1);
}

function parseYesPrice(raw: GammaMarket): number | null {
  try {
    if (!raw.outcomePrices) return null;
    const prices: string[] = JSON.parse(raw.outcomePrices);
    const outcomes: string[] = raw.outcomes ? JSON.parse(raw.outcomes) : [];
    let idx = 0;
    if (outcomes.length === prices.length) {
      const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
      if (yesIdx >= 0) idx = yesIdx;
      else return null;
    } else if (prices.length !== 2) {
      return null;
    }
    const p = Number.parseFloat(prices[idx]);
    // Near-resolved markets (<3% or >97%) carry no usable directional information.
    if (!Number.isFinite(p) || p < 0.03 || p > 0.97) return null;
    return p;
  } catch {
    return null;
  }
}

function toNum(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}
