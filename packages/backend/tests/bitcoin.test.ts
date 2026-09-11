import { describe, expect, it } from 'vitest';
import { ExchangeBitcoinProvider } from '../src/providers/bitcoin.js';

function krakenHourly(n: number) {
  const hour = Math.floor(Date.now() / 3_600_000) * 3600;
  return {
    error: [],
    result: {
      XXBTZUSD: Array.from({ length: n }, (_, i) => {
        const t = hour - (n - i) * 3600;
        const close = 70000 + Math.sin(i / 5) * 500 + i * 3;
        return [t, String(close - 10), String(close + 50), String(close - 60), String(close), String(close), '12.5', 100];
      }),
      last: hour - 3600,
    },
  };
}

describe('ExchangeBitcoinProvider', () => {
  it('REGRESSION: with Binance geo-blocked, hourly technicals (RSI/EMA/MACD) still come from the next venue instead of collapsing to price-only', async () => {
    const fetcher = async <T,>(url: string): Promise<T> => {
      if (url.includes('binance')) throw new Error('HTTP 451 from ' + url);
      if (url.includes('kraken')) return krakenHourly(260) as T;
      throw new Error('unexpected ' + url);
    };
    const tech = await new ExchangeBitcoinProvider(fetcher).fetchTechnicals();
    expect(tech.source).toBe('kraken');
    expect(tech.freshness).toBe('fresh');
    expect(tech.rsi14).not.toBeNull();
    expect(tech.ema200).not.toBeNull();
    expect(tech.macd).not.toBeNull();
    expect(tech.change24h).not.toBeNull();
    expect(tech.volume24h).toBeCloseTo(24 * 12.5, 6);
  });

  it('falls back to CoinGecko (price only) when every candle venue fails, then to the last good reading', async () => {
    let geckoUp = true;
    const fetcher = async <T,>(url: string): Promise<T> => {
      if (url.includes('coingecko')) {
        if (!geckoUp) throw new Error('offline');
        return { bitcoin: { usd: 77000, usd_24h_change: -1.2, usd_24h_vol: 30e9 } } as T;
      }
      throw new Error('HTTP 451 from ' + url);
    };
    const provider = new ExchangeBitcoinProvider(fetcher);
    const gecko = await provider.fetchTechnicals();
    expect(gecko.source).toBe('coingecko-fallback');
    expect(gecko.price).toBe(77000);
    expect(gecko.rsi14).toBeNull();

    geckoUp = false;
    const last = await provider.fetchTechnicals();
    expect(last.price).toBe(77000);
    expect(last.freshness).toBe('stale');
  });
});
