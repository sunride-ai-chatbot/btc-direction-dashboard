import { CANDLE_SOURCES, EXCHANGE_API } from '../config.js';
import { fetchJson } from '../utils/fetchJson.js';
import type { Candle1m } from '../types.js';
import { parseRestKline } from './priceStream.js';

export type CandleSource = 'binance' | 'kraken' | 'coinbase';
export type CandleInterval = '1m' | '1h';
export type JsonFetcher = typeof fetchJson;

export interface CandleSeries {
  /** Closed candles only, chronological. */
  candles: Candle1m[];
  source: CandleSource;
}

const INTERVAL_MS: Record<CandleInterval, number> = { '1m': 60_000, '1h': 3_600_000 };

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number.parseFloat(String(v));
}

/** A candle is closed once its whole interval lies in the past. */
function closedOnly(candles: Candle1m[], intervalMs: number, now: number): Candle1m[] {
  return candles.filter((c) => c.ts + intervalMs <= now).sort((a, b) => a.ts - b.ts);
}

/** Binance klines: [openTime(ms), o, h, l, c, v, closeTime, quoteVol, trades, takerBuyBase, …]. */
export function parseBinanceKlines(rows: unknown, intervalMs: number, now: number): Candle1m[] {
  if (!Array.isArray(rows)) return [];
  const parsed = rows.map((r) => (Array.isArray(r) ? parseRestKline(r) : null)).filter((c): c is Candle1m => c !== null);
  return closedOnly(parsed, intervalMs, now);
}

interface KrakenOhlcResponse {
  error?: string[];
  result?: Record<string, unknown>;
}

/**
 * Kraken OHLC: result[pair] = [[time(s), open, high, low, close, vwap, volume, count], …] and
 * result.last = the newest COMMITTED candle; anything newer is still forming. No taker split.
 */
export function parseKrakenOhlc(payload: unknown, intervalMs: number, now: number): Candle1m[] {
  const res = payload as KrakenOhlcResponse | null;
  if (!res?.result || (Array.isArray(res.error) && res.error.length > 0)) return [];
  const last = Number(res.result.last);
  const key = Object.keys(res.result).find((k) => k !== 'last');
  const rows = key ? res.result[key] : null;
  if (!Array.isArray(rows)) return [];
  const out: Candle1m[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const timeSec = num(row[0]);
    if (!Number.isFinite(timeSec) || (Number.isFinite(last) && timeSec > last)) continue;
    const c: Candle1m = { ts: timeSec * 1000, open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]), volume: num(row[6]), takerBuyVolume: null };
    if ([c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) out.push(c);
  }
  return closedOnly(out, intervalMs, now);
}

/** Coinbase Exchange candles: [time(s), low, high, open, close, volume], newest first. No taker split. */
export function parseCoinbaseCandles(rows: unknown, intervalMs: number, now: number): Candle1m[] {
  if (!Array.isArray(rows)) return [];
  const out: Candle1m[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const timeSec = num(row[0]);
    if (!Number.isFinite(timeSec)) continue;
    const c: Candle1m = { ts: timeSec * 1000, open: num(row[3]), high: num(row[2]), low: num(row[1]), close: num(row[4]), volume: num(row[5]), takerBuyVolume: null };
    if ([c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) out.push(c);
  }
  return closedOnly(out, intervalMs, now);
}

type SourceFetcher = (interval: CandleInterval, limit: number, fetcher: JsonFetcher, now: number) => Promise<Candle1m[]>;

// Each source gets one fast attempt (no library retries): a geo-block or outage should fail
// over to the next venue in seconds, not after several retry backoffs.
const REQUEST = { retries: 0, timeoutMs: 8_000 } as const;

const SOURCES: Record<CandleSource, SourceFetcher> = {
  binance: async (interval, limit, fetcher, now) => {
    const rows = await fetcher<unknown>(
      `${EXCHANGE_API.binance}/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${Math.min(limit + 1, 1000)}`,
      REQUEST,
    );
    return parseBinanceKlines(rows, INTERVAL_MS[interval], now).slice(-limit);
  },
  kraken: async (interval, limit, fetcher, now) => {
    const rows = await fetcher<unknown>(`${EXCHANGE_API.kraken}/0/public/OHLC?pair=XBTUSD&interval=${interval === '1m' ? 1 : 60}`, REQUEST);
    return parseKrakenOhlc(rows, INTERVAL_MS[interval], now).slice(-limit);
  },
  coinbase: async (interval, limit, fetcher, now) => {
    const rows = await fetcher<unknown>(`${EXCHANGE_API.coinbase}/products/BTC-USD/candles?granularity=${interval === '1m' ? 60 : 3600}`, {
      ...REQUEST,
      headers: { 'user-agent': 'BTCDirectionDashboard/1.0' },
    });
    return parseCoinbaseCandles(rows, INTERVAL_MS[interval], now).slice(-limit);
  },
};

/**
 * Closed BTC/USD candles from the first source that answers with enough rows. Every
 * source's failure is carried into the final error so a log line shows exactly which
 * venues were unreachable and why.
 */
export async function fetchCandles(
  opts: { interval: CandleInterval; limit: number; minCandles?: number },
  fetcher: JsonFetcher = fetchJson,
  sources: CandleSource[] = CANDLE_SOURCES,
  now = Date.now(),
): Promise<CandleSeries> {
  const failures: string[] = [];
  for (const source of sources) {
    try {
      const candles = await SOURCES[source](opts.interval, opts.limit, fetcher, now);
      if (candles.length < (opts.minCandles ?? 1)) throw new Error(`only ${candles.length} candles`);
      return { candles, source };
    } catch (err) {
      failures.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`no candle source reachable — ${failures.join('; ')}`);
}
