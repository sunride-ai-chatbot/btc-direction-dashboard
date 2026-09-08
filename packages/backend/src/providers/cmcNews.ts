import type { SignalLabel, Freshness } from '../types.js';
import { fetchJson } from '../utils/fetchJson.js';
import type { SignalDatabase } from '../db/database.js';

export type NewsCategory = 'market' | 'regulation' | 'institutional' | 'security' | 'macro' | 'defi' | 'other';
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CmcNewsItem {
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
}

export interface CmcNewsSnapshot {
  posts: CmcNewsItem[];
  score: number;
  direction: SignalLabel;
  source: string;
  timestamp: number;
  freshness: Freshness;
}

interface CommunityPost {
  gravityId?: string | number;
  postTime?: string | number;
  textContent?: string;
  owner?: { handle?: string };
}

interface CommunityResponse {
  data?: { tweetDTOList?: CommunityPost[] };
}

type JsonFetcher = typeof fetchJson;

const PROFILE_URL = 'https://coinmarketcap.com/community/profile/CMC_News/';
const PUBLIC_FEED_URL = 'https://api.coinmarketcap.com/gravity/v3/gravity/user/query';

const POSITIVE: Array<[RegExp, number]> = [
  [/\b(rose|gained|rally|surge[ds]?|rebound|recovery|record high|breakout)\b/gi, 14],
  [/\b(inflow|inflows|accumulat(?:e|es|ed|ion)|buy|buys|bought|purchase[ds]?)\b/gi, 16],
  [/\b(approve[ds]?|approval|adoption|launch(?:es|ed)?|integration|expansion)\b/gi, 10],
  [/\b(rate cut|easing|dovish|short liquidations?)\b/gi, 14],
];

const NEGATIVE: Array<[RegExp, number]> = [
  [/\b(fell|decline[ds]?|drop(?:s|ped)?|sell(?:s|ing)?|sold|breakdown)\b/gi, 14],
  [/\b(outflow|outflows|hack(?:ed)?|exploit(?:ed)?|stolen|breach|lawsuit|ban(?:ned)?)\b/gi, 18],
  [/\b(rate hike|tightening|hawkish|long liquidations?|shutdown|halted)\b/gi, 14],
  [/\b(crackdown|fraud|bankrupt(?:cy)?|default|attack(?:ed)?)\b/gi, 18],
];

export function classifyNews(text: string): Pick<CmcNewsItem, 'category' | 'relevance' | 'sentimentScore' | 'direction' | 'impact'> {
  const lower = text.toLowerCase();
  let relevance = 0;
  if (/\b(bitcoin|btc)\b/i.test(text)) relevance += 55;
  if (/\b(crypto|digital asset|total market cap)\b/i.test(text)) relevance += 18;
  if (/\b(etf|institution|treasury|bank|funding rate|liquidation)\b/i.test(text)) relevance += 15;
  if (/\b(fed|fomc|cpi|inflation|interest rate|dollar index|dxy)\b/i.test(text)) relevance += 15;
  if (/\b(sec|cftc|regulat|lawsuit|legislation)\b/i.test(text)) relevance += 12;
  relevance = Math.min(100, relevance);

  let sentimentScore = 0;
  for (const [pattern, weight] of POSITIVE) {
    pattern.lastIndex = 0;
    sentimentScore += (lower.match(pattern) ?? []).length * weight;
  }
  for (const [pattern, weight] of NEGATIVE) {
    pattern.lastIndex = 0;
    sentimentScore -= (lower.match(pattern) ?? []).length * weight;
  }
  sentimentScore = Math.max(-100, Math.min(100, sentimentScore));

  const category: NewsCategory = /\b(hack\w*|exploit\w*|stolen|breach\w*|attack\w*)\b/i.test(text)
    ? 'security'
    : /\b(sec|cftc|regulat|lawsuit|legislation|court)\b/i.test(text)
      ? 'regulation'
      : /\b(fed|fomc|cpi|inflation|interest rate|dxy|dollar index)\b/i.test(text)
        ? 'macro'
        : /\b(etf|institution|treasury|bank|fundrais|financing)\b/i.test(text)
          ? 'institutional'
          : /\b(defi|dex|amm|liquidity protocol)\b/i.test(text)
            ? 'defi'
            : /\b(bitcoin|btc|crypto|market cap|liquidation|funding rate)\b/i.test(text)
              ? 'market'
              : 'other';

  const direction: SignalLabel = sentimentScore >= 15 ? 'BULLISH' : sentimentScore <= -15 ? 'BEARISH' : 'NEUTRAL';
  const impact: NewsImpact = relevance >= 65 || (relevance >= 40 && Math.abs(sentimentScore) >= 35)
    ? 'HIGH'
    : relevance >= 25 || Math.abs(sentimentScore) >= 20
      ? 'MEDIUM'
      : 'LOW';
  return { category, relevance, sentimentScore, direction, impact };
}

export function parseCommunityResponse(payload: CommunityResponse, fetchedAt = Date.now()): CmcNewsItem[] {
  const rows = payload.data?.tweetDTOList;
  if (!Array.isArray(rows)) throw new Error('CMC News response is missing tweetDTOList');
  return rows
    .filter((p) => p.owner?.handle === 'CMC_News' && p.gravityId !== undefined && typeof p.textContent === 'string')
    .map((p) => {
      const publishedTs = Number(p.postTime);
      if (!Number.isFinite(publishedTs)) throw new Error('CMC News post has an invalid timestamp');
      const id = String(p.gravityId);
      return {
        id,
        text: p.textContent!.replace(/\s+/g, ' ').trim(),
        publishedTs,
        fetchedAt,
        url: PROFILE_URL,
        ...classifyNews(p.textContent!),
      };
    });
}

export function aggregateNews(posts: CmcNewsItem[], now = Date.now()): { score: number; direction: SignalLabel } {
  let numerator = 0;
  let denominator = 0;
  for (const post of posts) {
    const ageHours = Math.max(0, (now - post.publishedTs) / 3_600_000);
    if (ageHours > 72 || post.relevance < 15) continue;
    const recency = Math.exp(-ageHours / 18);
    const weight = recency * Math.max(0.15, post.relevance / 100);
    numerator += post.sentimentScore * weight;
    denominator += weight;
  }
  const score = denominator > 0 ? Math.round((numerator / denominator) * 10) / 10 : 0;
  return { score, direction: score >= 15 ? 'BULLISH' : score <= -15 ? 'BEARISH' : 'NEUTRAL' };
}

export class CmcNewsProvider {
  constructor(private readonly db: SignalDatabase, private readonly fetcher: JsonFetcher = fetchJson) {}

  async fetchNews(): Promise<CmcNewsSnapshot> {
    const fetchedAt = Date.now();
    try {
      const payload = await this.fetcher<CommunityResponse>(PUBLIC_FEED_URL, {
        method: 'POST',
        body: JSON.stringify({ filter: 'USER', handle: 'CMC_News' }),
        headers: {
          'content-type': 'application/json',
          origin: 'https://coinmarketcap.com',
          referer: PROFILE_URL,
          'user-agent': 'BTCDirectionDashboard/1.0',
        },
      });
      const posts = parseCommunityResponse(payload, fetchedAt);
      if (posts.length === 0) throw new Error('CMC News returned no posts');
      this.db.upsertNewsItems(posts);
      return { posts, ...aggregateNews(posts, fetchedAt), source: 'CMC News (@CMC_News)', timestamp: fetchedAt, freshness: 'fresh' };
    } catch (err) {
      const fallback = this.db.getRecentNewsItems(20);
      if (fallback.length === 0) throw err;
      console.warn('[cmc-news] source unavailable — serving last-known stored posts');
      return { posts: fallback, ...aggregateNews(fallback, fetchedAt), source: 'CMC News (@CMC_News)', timestamp: fetchedAt, freshness: 'stale' };
    }
  }
}
