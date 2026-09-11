import { describe, expect, it } from 'vitest';
import { fetchCandleHistory, fetchCandles, parseBinanceKlines, parseCoinbaseCandles, parseKrakenOhlc } from '../src/providers/candles.js';

// Real payload shapes captured from each venue on 2026-09-11.
const NOW = 1789122340000;

const KRAKEN_1M = {
  error: [],
  result: {
    XXBTZUSD: [
      [1789122240, '77069.0', '77074.4', '77066.9', '77074.4', '77068.8', '0.57571909', 32],
      [1789122300, '77074.4', '77074.4', '77060.4', '77060.4', '77074.1', '0.06717594', 12],
    ],
    last: 1789122240,
  },
};

const COINBASE_1M = [
  [1789122060, 77087.24, 77090.9, 77087.24, 77090.89, 0.12441061],
  [1789122000, 77049.73, 77107.35, 77103.89, 77087.23, 6.2739147],
];

describe('exchange candle parsers', () => {
  it('Kraken: maps [time,o,h,l,c,vwap,vol,count], drops rows newer than `last`, and reports no taker split', () => {
    const candles = parseKrakenOhlc(KRAKEN_1M, 60_000, NOW);
    expect(candles).toHaveLength(1);
    expect(candles[0]).toEqual({ ts: 1789122240000, open: 77069, high: 77074.4, low: 77066.9, close: 77074.4, volume: 0.57571909, takerBuyVolume: null });
    expect(parseKrakenOhlc({ error: ['EGeneral:Invalid arguments'] }, 60_000, NOW)).toEqual([]);
  });

  it('Coinbase: rows are [time, LOW, HIGH, OPEN, close, volume] newest-first — open/low must not be swapped', () => {
    const candles = parseCoinbaseCandles(COINBASE_1M, 60_000, NOW);
    expect(candles.map((c) => c.ts)).toEqual([1789122000000, 1789122060000]); // re-sorted chronological
    expect(candles[0]).toEqual({ ts: 1789122000000, open: 77103.89, high: 77107.35, low: 77049.73, close: 77087.23, volume: 6.2739147, takerBuyVolume: null });
  });

  it('a candle whose interval has not ended yet is never treated as closed', () => {
    // At 10:21:40 the 10:21 minute is still forming — only the 10:20 candle is closed.
    expect(parseCoinbaseCandles(COINBASE_1M, 60_000, 1789122100000).map((c) => c.ts)).toEqual([1789122000000]);
    const binance = parseBinanceKlines(
      [
        [NOW - 120_000, '1', '2', '0.5', '1.5', '100', 0, '0', 5, '60', '0', '0'],
        [NOW - 30_000, '1', '2', '0.5', '1.5', '100', 0, '0', 5, '60', '0', '0'], // still open
      ],
      60_000,
      NOW,
    );
    expect(binance).toHaveLength(1);
    expect(binance[0].takerBuyVolume).toBe(60); // Binance is the one REST source that knows the split
  });
});

describe('fetchCandles fallback chain', () => {
  const krakenHourly = (n: number) => ({
    error: [],
    result: {
      XXBTZUSD: Array.from({ length: n }, (_, i) => {
        const t = Math.floor(NOW / 3_600_000) * 3600 - (n - i) * 3600;
        return [t, '70000', '70100', '69900', String(70000 + i), '70000', '1.5', 10];
      }),
      last: Math.floor(NOW / 3_600_000) * 3600 - 3600,
    },
  });

  it('skips a geo-blocked Binance (HTTP 451) and uses the next venue, remembering which one answered', async () => {
    const fetcher = async <T,>(url: string): Promise<T> => {
      if (url.includes('binance')) throw new Error('HTTP 451 from ' + url);
      if (url.includes('kraken')) return krakenHourly(50) as T;
      throw new Error('should not reach coinbase');
    };
    const series = await fetchCandles({ interval: '1h', limit: 500, minCandles: 30 }, fetcher, ['binance', 'kraken', 'coinbase'], NOW);
    expect(series.source).toBe('kraken');
    expect(series.candles).toHaveLength(50);
    expect(series.candles[49].close).toBe(70049);
  });

  it('pages deep 1-minute history oldest → newest through Coinbase start/end, skipping Kraken (which cannot page) and a blocked Binance', async () => {
    const minute = 60_000;
    const from = NOW - 30 * minute; // ask for 30 minutes; Coinbase returns newest-first pages of 300 max — here the window is 300 minutes wide
    const urls: string[] = [];
    const fetcher = async <T,>(url: string): Promise<T> => {
      urls.push(url);
      if (url.includes('binance')) throw new Error('HTTP 451');
      if (url.includes('kraken')) throw new Error('kraken must not be asked to page history');
      const u = new URL(url);
      const start = Date.parse(u.searchParams.get('start')!);
      const end = Date.parse(u.searchParams.get('end')!);
      // Newest-first, like the real endpoint, and only closed minutes.
      const rows: number[][] = [];
      for (let t = start; t < end && t + minute <= NOW; t += minute) rows.unshift([t / 1000, 1, 2, 1.5, t / 1000, 0.1]);
      return rows as T;
    };
    const series = await fetchCandleHistory(from, fetcher, ['binance', 'kraken', 'coinbase'], NOW);
    expect(series.source).toBe('coinbase');
    expect(urls.some((u) => u.includes('kraken'))).toBe(false);
    expect(series.candles).toHaveLength(30);
    expect(series.candles[0].ts).toBe(from);
    expect(series.candles[29].ts).toBe(NOW - minute);
    expect(new Set(series.candles.map((c) => c.ts)).size).toBe(30);
    expect(series.candles.every((c) => c.takerBuyVolume === null)).toBe(true);
    expect(series.candles[0].open).toBe(1.5); // Coinbase column order respected while paging too
  });

  it('a venue that answers with too few candles is treated as a failure, not as data', async () => {
    const fetcher = async <T,>(url: string): Promise<T> => {
      if (url.includes('kraken')) return krakenHourly(5) as T;
      if (url.includes('coinbase')) return [[Math.floor(NOW / 3_600_000) * 3600 - 3600, 1, 2, 1.5, 1.8, 3]] as T;
      throw new Error('HTTP 451');
    };
    await expect(fetchCandles({ interval: '1h', limit: 500, minCandles: 30 }, fetcher, ['binance', 'kraken', 'coinbase'], NOW)).rejects.toThrow(
      /binance: HTTP 451; kraken: only 5 candles; coinbase: only 1 candles/,
    );
  });
});
