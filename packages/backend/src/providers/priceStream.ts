import { STREAM_CONFIG } from '../config.js';
import { median } from '../utils/stats.js';
import type { Candle1m, CvdSnapshot, ExchangeTick, PriceConsensus } from '../types.js';

export type ExchangeName = 'binance' | 'coinbase' | 'kraken';
export const EXCHANGES: ExchangeName[] = ['binance', 'coinbase', 'kraken'];

// ---------- pure functions (unit-tested) ----------

/**
 * Median-of-fresh-exchanges consensus. An exchange older than freshMs is
 * ignored; a spread above anomalyPct (or a single exchange deviating from the
 * median by more than it) flags a data anomaly rather than silently trusting one feed.
 */
export function computeConsensus(
  ticks: Record<string, ExchangeTick | null>,
  now: number,
  freshMs = STREAM_CONFIG.tickFreshMs,
  anomalyPct = STREAM_CONFIG.anomalyPct,
): PriceConsensus {
  const fresh = Object.entries(ticks).filter(([, t]) => t !== null && now - t.ts <= freshMs) as Array<[string, ExchangeTick]>;
  if (fresh.length === 0) {
    return { price: null, ts: now, exchanges: ticks, freshExchanges: 0, spreadPct: null, anomaly: false, anomalyNote: null };
  }
  const prices = fresh.map(([, t]) => t.price);
  const med = median(prices)!;
  const spreadPct = prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / med) * 100 : 0;
  const deviant = fresh.find(([, t]) => Math.abs((t.price - med) / med) * 100 > anomalyPct);
  const anomaly = spreadPct > anomalyPct || deviant !== undefined;
  return {
    price: med,
    ts: now,
    exchanges: ticks,
    freshExchanges: fresh.length,
    spreadPct: +spreadPct.toFixed(4),
    anomaly,
    anomalyNote: anomaly
      ? deviant
        ? `${deviant[0]} deviates ${(Math.abs((deviant[1].price - med) / med) * 100).toFixed(2)}% from consensus`
        : `cross-exchange spread ${spreadPct.toFixed(2)}%`
      : null,
  };
}

/**
 * CVD ratios from closed 1-minute candles (newest last): (buy − sell) / (buy + sell).
 * The window is TIME-bounded (by candle timestamp), not count-bounded: a gap in the
 * candle series (a WebSocket outage) shrinks the sample instead of silently
 * stretching the window to cover a longer real period than its label says.
 * Candles without a taker split (REST backfill from venues that don't publish one)
 * are excluded — they carry price, not order flow.
 */
export function computeCvd(candles: Candle1m[], windows = { m15: 15, h1: 60, h4: 240 }, minCandles = 15): CvdSnapshot {
  const newest = candles.length > 0 ? candles[candles.length - 1].ts : null;
  const ratio = (n: number): number | null => {
    if (newest === null) return null;
    const slice = candles.filter((c) => c.ts > newest - n * 60_000 && c.takerBuyVolume !== null);
    if (slice.length < minCandles) return null;
    let buy = 0;
    let total = 0;
    for (const c of slice) {
      buy += c.takerBuyVolume!;
      total += c.volume;
    }
    if (total <= 0) return null;
    const sell = total - buy;
    return +((buy - sell) / total).toFixed(4);
  };
  return { ratio15m: ratio(windows.m15), ratio1h: ratio(windows.h1), ratio4h: ratio(windows.h4), candles: candles.length };
}

/** Parse a Binance REST kline row (index 9 = taker buy base volume) into a candle. */
export function parseRestKline(row: unknown[]): Candle1m | null {
  const num = (i: number) => Number.parseFloat(String(row[i]));
  const ts = Number(row[0]);
  if (!Number.isFinite(ts)) return null;
  const c: Candle1m = { ts, open: num(1), high: num(2), low: num(3), close: num(4), volume: num(5), takerBuyVolume: num(9) };
  return [c.open, c.high, c.low, c.close, c.volume, c.takerBuyVolume].every(Number.isFinite) ? c : null;
}

/**
 * Merge rule shared by the in-memory series and the DB: a candle that knows its taker
 * split is never replaced by one that doesn't, so a REST backfill (no split) can fill
 * gaps without erasing the order-flow information the live trade streams captured.
 */
export function preferCandle(existing: Candle1m | undefined, incoming: Candle1m): Candle1m {
  if (existing && existing.takerBuyVolume !== null && incoming.takerBuyVolume === null) return existing;
  return incoming;
}

export interface Trade {
  price: number;
  size: number;
  /** True when the aggressor bought (lifted the ask). */
  takerBuy: boolean;
  ts: number;
}

/**
 * Builds 1-minute candles from live trades, pooled across exchanges. A minute is only
 * closed once it is graceMs in the past, so a late trade from a slower venue still
 * lands in the right bucket instead of leaking into the next one.
 */
export class TradeCandleBuilder {
  private buckets = new Map<number, Candle1m>();

  constructor(private graceMs = STREAM_CONFIG.tradeCandleGraceMs) {}

  add(t: Trade): void {
    if (!Number.isFinite(t.price) || !Number.isFinite(t.size) || t.size <= 0 || !Number.isFinite(t.ts)) return;
    const minute = Math.floor(t.ts / 60_000) * 60_000;
    const buy = t.takerBuy ? t.size : 0;
    const b = this.buckets.get(minute);
    if (!b) {
      this.buckets.set(minute, { ts: minute, open: t.price, high: t.price, low: t.price, close: t.price, volume: t.size, takerBuyVolume: buy });
      return;
    }
    b.high = Math.max(b.high, t.price);
    b.low = Math.min(b.low, t.price);
    b.close = t.price;
    b.volume += t.size;
    b.takerBuyVolume = (b.takerBuyVolume ?? 0) + buy;
  }

  /** Candles whose minute ended at least graceMs ago (chronological); they leave the builder. */
  closeDue(now: number): Candle1m[] {
    const out: Candle1m[] = [];
    for (const [minute, c] of this.buckets) {
      if (minute + 60_000 + this.graceMs <= now) {
        out.push(c);
        this.buckets.delete(minute);
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  get pending(): number {
    return this.buckets.size;
  }
}

// ---------- live stream ----------

export interface StreamStatus {
  freshness: 'fresh' | 'stale' | 'unavailable';
  lastTickTs: number | null;
  connected: Record<ExchangeName, boolean>;
  reconnects: number;
}

type Listener = (c: PriceConsensus, cvd: CvdSnapshot) => void;

/**
 * Multi-exchange BTC/USD WebSocket aggregator (Binance, Coinbase, Kraken) with
 * exponential-backoff reconnects. Every exchange's trade feed is pooled into our own
 * 1-minute candles (with the real taker buy/sell split) — no venue-specific kline
 * stream is needed, so order flow keeps working wherever at least one venue is reachable.
 * Uses the global WebSocket available in Node ≥ 22 — no dependency.
 */
export class PriceStream {
  private ticks: Record<ExchangeName, ExchangeTick | null> = { binance: null, coinbase: null, kraken: null };
  private sockets: Partial<Record<ExchangeName, WebSocket>> = {};
  private connectedFlags: Record<ExchangeName, boolean> = { binance: false, coinbase: false, kraken: false };
  private attempts: Record<ExchangeName, number> = { binance: 0, coinbase: 0, kraken: 0 };
  private everOpened: Record<ExchangeName, boolean> = { binance: false, coinbase: false, kraken: false };
  private reconnectTimers: Partial<Record<ExchangeName, NodeJS.Timeout>> = {};
  private candles: Candle1m[] = [];
  private builder = new TradeCandleBuilder();
  private flushTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<Listener>();
  private stopped = false;
  private reconnects = 0;
  private lastTickTs: number | null = null;

  constructor(
    private onClosedCandle: (c: Candle1m) => void = () => {},
    private maxCandles = 600,
    /** Fired when an exchange re-establishes a connection it had previously held (not the
     *  first connect) — used to re-run the REST candle backfill and close any gap the
     *  outage left in btc_candles_1m / the in-memory series. */
    private onReopen?: (ex: ExchangeName) => void,
  ) {}

  /** Seed candle history (e.g. from REST backfill or the DB) before/after connecting. */
  seedCandles(candles: Candle1m[]): void {
    const byTs = new Map<number, Candle1m>();
    for (const c of [...this.candles, ...candles]) byTs.set(c.ts, preferCandle(byTs.get(c.ts), c));
    this.candles = [...byTs.values()].sort((a, b) => a.ts - b.ts).slice(-this.maxCandles);
  }

  start(): void {
    if (typeof WebSocket === 'undefined') {
      console.error('[stream] global WebSocket unavailable — live price stream disabled');
      return;
    }
    for (const ex of EXCHANGES) this.connect(ex);
    this.flushTimer = setInterval(() => this.flushCandles(), STREAM_CONFIG.tradeCandleFlushMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    for (const t of Object.values(this.reconnectTimers)) if (t) clearTimeout(t);
    for (const ws of Object.values(this.sockets)) {
      try {
        ws?.close();
      } catch {}
    }
  }

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  consensus(now = Date.now()): PriceConsensus {
    return computeConsensus(this.ticks, now);
  }

  cvd(): CvdSnapshot {
    return computeCvd(this.candles);
  }

  recentCandles(n: number): Candle1m[] {
    return this.candles.slice(-n);
  }

  status(now = Date.now()): StreamStatus {
    const age = this.lastTickTs === null ? Infinity : now - this.lastTickTs;
    return {
      freshness: age <= STREAM_CONFIG.degradedAfterMs ? 'fresh' : age <= STREAM_CONFIG.downAfterMs ? 'stale' : 'unavailable',
      lastTickTs: this.lastTickTs,
      connected: { ...this.connectedFlags },
      reconnects: this.reconnects,
    };
  }

  /** Close every minute that is due; exposed for tests and for a final flush on shutdown. */
  flushCandles(now = Date.now()): void {
    for (const c of this.builder.closeDue(now)) {
      this.seedCandles([c]);
      this.onClosedCandle(c);
    }
  }

  // ----- internals -----

  private connect(ex: ExchangeName): void {
    if (this.stopped) return;
    const url = ex === 'binance' ? STREAM_CONFIG.binanceWs : ex === 'coinbase' ? STREAM_CONFIG.coinbaseWs : STREAM_CONFIG.krakenWs;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect(ex, err instanceof Error ? err.message : 'ws ctor failed');
      return;
    }
    this.sockets[ex] = ws;

    ws.onopen = () => {
      this.connectedFlags[ex] = true;
      // Backoff resets on proof of a WORKING feed (see tick()), not merely a completed
      // handshake — an exchange that accepts then immediately closes (maintenance,
      // load-shedding) would otherwise be hammered every reconnectBaseMs forever.
      if (this.everOpened[ex]) this.onReopen?.(ex);
      this.everOpened[ex] = true;
      if (ex === 'coinbase') {
        ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker', 'matches'] }));
      } else if (ex === 'kraken') {
        ws.send(JSON.stringify({ event: 'subscribe', pair: ['XBT/USD'], subscription: { name: 'ticker' } }));
        ws.send(JSON.stringify({ event: 'subscribe', pair: ['XBT/USD'], subscription: { name: 'trade' } }));
      }
    };
    ws.onmessage = (ev) => {
      try {
        this.handleMessage(ex, typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        // malformed frame — ignore, never crash the stream
      }
    };
    ws.onerror = () => {
      // onclose follows; reconnect handled there
    };
    ws.onclose = () => {
      this.connectedFlags[ex] = false;
      this.scheduleReconnect(ex, 'closed');
    };
  }

  private scheduleReconnect(ex: ExchangeName, reason: string): void {
    if (this.stopped) return;
    const attempt = this.attempts[ex]++;
    const delay = Math.min(STREAM_CONFIG.reconnectBaseMs * 2 ** attempt, STREAM_CONFIG.reconnectMaxMs);
    this.reconnects++;
    if (attempt === 0 || attempt % 5 === 0) console.error(`[stream] ${ex} ${reason} — reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimers[ex] = setTimeout(() => this.connect(ex), delay);
  }

  private handleMessage(ex: ExchangeName, raw: string): void {
    const msg = JSON.parse(raw) as unknown;
    const now = Date.now();
    if (ex === 'binance') {
      // Combined-stream envelope: { stream, data: { p: price, q: qty, T: tradeTime, m: buyerIsMaker } }
      const env = msg as { stream?: string; data?: Record<string, unknown> };
      if (!env.data || !env.stream?.endsWith('@trade')) return;
      const price = Number.parseFloat(String(env.data.p));
      if (!Number.isFinite(price)) return;
      this.tick(ex, price, now);
      const ts = Number(env.data.T);
      this.builder.add({ price, size: Number.parseFloat(String(env.data.q)), takerBuy: env.data.m === false, ts: Number.isFinite(ts) ? ts : now });
    } else if (ex === 'coinbase') {
      const m = msg as { type?: string; price?: string; size?: string; side?: string; time?: string };
      if (m.type === 'ticker' && m.price) {
        const price = Number.parseFloat(m.price);
        if (Number.isFinite(price)) this.tick(ex, price, now);
      } else if (m.type === 'match' && m.price && m.size) {
        // `side` is the MAKER side: a sell-side maker means the taker bought.
        const ts = m.time ? Date.parse(m.time) : NaN;
        this.builder.add({ price: Number.parseFloat(m.price), size: Number.parseFloat(m.size), takerBuy: m.side === 'sell', ts: Number.isFinite(ts) ? ts : now });
      }
    } else if (ex === 'kraken') {
      if (!Array.isArray(msg) || msg.length < 4) return;
      if (msg[2] === 'ticker') {
        const payload = msg[1] as { c?: [string, string] };
        const price = Number.parseFloat(payload?.c?.[0] ?? '');
        if (Number.isFinite(price)) this.tick(ex, price, now);
      } else if (msg[2] === 'trade' && Array.isArray(msg[1])) {
        // [[price, volume, time(s), side 'b'|'s' (taker), orderType, misc], …]
        for (const row of msg[1] as unknown[]) {
          if (!Array.isArray(row) || row.length < 4) continue;
          const ts = Number.parseFloat(String(row[2])) * 1000;
          this.builder.add({ price: Number.parseFloat(String(row[0])), size: Number.parseFloat(String(row[1])), takerBuy: row[3] === 'b', ts: Number.isFinite(ts) ? ts : now });
        }
      }
    }
  }

  private tick(ex: ExchangeName, price: number, now: number): void {
    // A real message is proof the feed actually works — reset backoff here, not on
    // handshake (onopen), so a connect-then-immediately-close loop still backs off.
    this.attempts[ex] = 0;
    this.ticks[ex] = { price, ts: now };
    this.lastTickTs = now;
    if (this.listeners.size === 0) return;
    const c = this.consensus(now);
    const cvd = this.cvd();
    for (const l of this.listeners) l(c, cvd);
  }
}
