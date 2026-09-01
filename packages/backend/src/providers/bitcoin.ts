import { fetchJson } from '../utils/fetchJson.js';
import { ema, rsi, macd, volatility, pctChange } from '../utils/indicators.js';
import { FRESHNESS_LIMITS_MS } from '../config.js';
import type { BitcoinTechnicals } from '../types.js';

export interface BitcoinPriceProvider {
  fetchTechnicals(): Promise<BitcoinTechnicals>;
}

type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

export class BinanceBitcoinProvider implements BitcoinPriceProvider {
  private lastGood: BitcoinTechnicals | null = null;
  private base = process.env.BINANCE_API_URL ?? 'https://api.binance.com';

  async fetchTechnicals(): Promise<BitcoinTechnicals> {
    const now = Date.now();
    try {
      const klines = await fetchJson<BinanceKline[]>(
        `${this.base}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=500`,
      );
      if (!Array.isArray(klines) || klines.length < 30) throw new Error('insufficient kline data');

      const closes = klines.map((k) => Number.parseFloat(k[4]));
      const volumes = klines.map((k) => Number.parseFloat(k[5]));
      const price = closes[closes.length - 1];

      const vol24 = sum(volumes.slice(-24));
      const volPrev24 = sum(volumes.slice(-48, -24));

      const result: BitcoinTechnicals = {
        price,
        change1h: closes.length >= 2 ? pctChange(closes[closes.length - 2], price) : null,
        change4h: closes.length >= 5 ? pctChange(closes[closes.length - 5], price) : null,
        change24h: closes.length >= 25 ? pctChange(closes[closes.length - 25], price) : null,
        volume24h: vol24,
        volumeChange24h: volPrev24 > 0 ? pctChange(volPrev24, vol24) : null,
        volatility24h: volatility(closes, 24),
        rsi14: rsi(closes.slice(-100), 14),
        ema20: ema(closes, 20),
        ema50: ema(closes, 50),
        ema200: ema(closes, 200),
        macd: macd(closes),
        source: 'binance',
        timestamp: now,
        freshness: 'fresh',
      };
      this.lastGood = result;
      return result;
    } catch {
      return this.fallbackCoinGecko(now);
    }
  }

  private async fallbackCoinGecko(now: number): Promise<BitcoinTechnicals> {
    try {
      const data = await fetchJson<{
        bitcoin: { usd: number; usd_24h_change?: number; usd_24h_vol?: number };
      }>(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true',
      );
      const result: BitcoinTechnicals = {
        price: data.bitcoin.usd,
        change1h: null,
        change4h: null,
        change24h: data.bitcoin.usd_24h_change ?? null,
        volume24h: data.bitcoin.usd_24h_vol ?? null,
        volumeChange24h: null,
        volatility24h: null,
        rsi14: null,
        ema20: null,
        ema50: null,
        ema200: null,
        macd: null,
        source: 'coingecko-fallback',
        timestamp: now,
        freshness: 'fresh',
      };
      this.lastGood = result;
      return result;
    } catch {
      if (this.lastGood) {
        const age = now - this.lastGood.timestamp;
        return {
          ...this.lastGood,
          freshness: age > FRESHNESS_LIMITS_MS.btcPrice ? 'unavailable' : 'stale',
        };
      }
      return {
        price: 0,
        change1h: null,
        change4h: null,
        change24h: null,
        volume24h: null,
        volumeChange24h: null,
        volatility24h: null,
        rsi14: null,
        ema20: null,
        ema50: null,
        ema200: null,
        macd: null,
        source: 'none',
        timestamp: now,
        freshness: 'unavailable',
      };
    }
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
