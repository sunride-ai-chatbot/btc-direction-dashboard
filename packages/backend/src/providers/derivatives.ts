import { DERIVATIVES_CONFIG } from '../config.js';
import { fetchJson } from '../utils/fetchJson.js';
import { median } from '../utils/stats.js';
import type { Freshness } from '../types.js';
import type { SignalDatabase } from '../db/database.js';

/**
 * Derivatives positioning — funding rates, open interest and liquidations across the
 * major BTC perpetual venues. TRACKING ONLY: like CMC news it has zero model weight,
 * its own table/route/CSV, and never enters the scoring pipeline. It exists so the
 * data accumulates now and can be evaluated (and only then, maybe, weighted) later.
 */

export type DerivativesVenue = 'kraken-futures' | 'deribit' | 'bitmex' | 'bybit' | 'okx';
export const DERIVATIVES_VENUES: DerivativesVenue[] = ['kraken-futures', 'deribit', 'bitmex', 'bybit', 'okx'];

type JsonFetcher = typeof fetchJson;

export interface VenueReading {
  venue: DerivativesVenue;
  ts: number;
  /** Funding normalized to one 8-hour period, in percent (0.01 = 0.01% ≈ neutral). */
  fundingRate8hPct: number | null;
  predictedFundingRate8hPct: number | null;
  openInterestBtc: number | null;
  openInterestUsd: number | null;
  markPrice: number | null;
}

export interface LiquidationSummary {
  windowMinutes: number;
  longUsd: number;
  shortUsd: number;
  count: number;
  venues: string[];
}

export type PositioningState = 'long-crowded' | 'short-crowded' | 'balanced' | 'unknown';

export interface DerivativesSnapshot {
  venues: VenueReading[];
  /** Venue median of the 8h-normalized funding rate, %. */
  fundingRate8hPct: number | null;
  fundingAnnualizedPct: number | null;
  /** Max − min funding across venues, % — venues disagreeing is itself information. */
  fundingSpreadPct: number | null;
  /** Sum across the venues that answered (compare only against the same venue set). */
  openInterestUsd: number | null;
  openInterestBtc: number | null;
  /** Median per-venue OI change vs. our own reading ~24h ago; null until history exists. */
  oiChange24hPct: number | null;
  /** Mean of the stored venue-median funding over the last 24h. */
  fundingAvg24hPct: number | null;
  liquidations: LiquidationSummary | null;
  positioning: { state: PositioningState; note: string };
  source: string;
  timestamp: number;
  freshness: Freshness;
  available: boolean;
}

// ---------- pure parsers (unit-tested against real payload fixtures) ----------

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** fraction-per-period → percent, rounded to a stable precision. */
function pct(fraction: number | null): number | null {
  return fraction === null ? null : +(fraction * 100).toFixed(6);
}

/**
 * Kraken Futures publishes `fundingRate` as an ABSOLUTE hourly amount (quote currency per
 * unit of base), not a relative rate: relative 8h = amount / markPrice × 8.
 */
export function parseKrakenFutures(payload: unknown, ts: number): VenueReading | null {
  const tickers = (payload as { tickers?: Array<Record<string, unknown>> } | null)?.tickers;
  const t = Array.isArray(tickers) ? tickers.find((x) => x?.symbol === 'PF_XBTUSD') : undefined;
  if (!t) return null;
  const mark = num(t.markPrice);
  const rel8h = (v: unknown): number | null => {
    const abs = num(v);
    return abs !== null && mark ? pct((abs / mark) * 8) : null;
  };
  const oiBtc = num(t.openInterest);
  return {
    venue: 'kraken-futures',
    ts,
    fundingRate8hPct: rel8h(t.fundingRate),
    predictedFundingRate8hPct: rel8h(t.fundingRatePrediction),
    openInterestBtc: oiBtc,
    openInterestUsd: oiBtc !== null && mark ? +(oiBtc * mark).toFixed(0) : null,
    markPrice: mark,
  };
}

/** Deribit BTC-PERPETUAL: funding_8h is already an 8h fraction; open_interest is USD notional. */
export function parseDeribit(payload: unknown, ts: number): VenueReading | null {
  const r = (payload as { result?: Record<string, unknown> } | null)?.result;
  if (!r) return null;
  const mark = num(r.mark_price);
  const oiUsd = num(r.open_interest);
  return {
    venue: 'deribit',
    ts,
    fundingRate8hPct: pct(num(r.funding_8h)),
    predictedFundingRate8hPct: pct(num(r.current_funding)),
    openInterestBtc: oiUsd !== null && mark ? +(oiUsd / mark).toFixed(4) : null,
    openInterestUsd: oiUsd,
    markPrice: mark,
  };
}

/** BitMEX XBTUSD (inverse): fundingRate is an 8h fraction; openInterest is in contracts = USD; openValue is in satoshi. */
export function parseBitmex(payload: unknown, ts: number): VenueReading | null {
  const r = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : undefined;
  if (!r || r.symbol !== 'XBTUSD') return null;
  const openValueSat = num(r.openValue);
  return {
    venue: 'bitmex',
    ts,
    fundingRate8hPct: pct(num(r.fundingRate)),
    predictedFundingRate8hPct: pct(num(r.indicativeFundingRate)),
    openInterestBtc: openValueSat !== null ? +(openValueSat / 1e8).toFixed(4) : null,
    openInterestUsd: num(r.openInterest),
    markPrice: num(r.markPrice),
  };
}

/** Bybit linear BTCUSDT: strings; fundingRate is an 8h fraction; openInterest in BTC, openInterestValue in USD. */
export function parseBybit(payload: unknown, ts: number): VenueReading | null {
  const p = payload as { retCode?: number; result?: { list?: Array<Record<string, unknown>> } } | null;
  const r = p?.retCode === 0 ? p.result?.list?.[0] : undefined;
  if (!r) return null;
  return {
    venue: 'bybit',
    ts,
    fundingRate8hPct: pct(num(r.fundingRate)),
    predictedFundingRate8hPct: null,
    openInterestBtc: num(r.openInterest),
    openInterestUsd: num(r.openInterestValue),
    markPrice: num(r.markPrice),
  };
}

/** OKX BTC-USDT-SWAP: funding (8h fraction), open interest (oiCcy BTC / oiUsd) and mark price come from three endpoints. */
export function parseOkx(funding: unknown, openInterest: unknown, mark: unknown, ts: number): VenueReading | null {
  const first = (p: unknown): Record<string, unknown> | undefined => {
    const x = p as { code?: string; data?: Array<Record<string, unknown>> } | null;
    return x?.code === '0' ? x.data?.[0] : undefined;
  };
  const f = first(funding);
  const oi = first(openInterest);
  const m = first(mark);
  if (!f && !oi) return null;
  return {
    venue: 'okx',
    ts,
    fundingRate8hPct: pct(num(f?.fundingRate)),
    predictedFundingRate8hPct: pct(num(f?.nextFundingRate)),
    openInterestBtc: num(oi?.oiCcy),
    openInterestUsd: num(oi?.oiUsd),
    markPrice: num(m?.markPx),
  };
}

/**
 * OKX liquidation orders for the BTC-USDT swap (contract value 0.01 BTC). A liquidated
 * LONG is force-sold (posSide 'long'); USD notional = contracts × 0.01 × bankruptcy price.
 */
export function parseOkxLiquidations(payload: unknown, sinceTs: number, windowMinutes: number, contractBtc = 0.01): LiquidationSummary | null {
  const p = payload as { code?: string; data?: Array<{ details?: Array<Record<string, unknown>> }> } | null;
  if (p?.code !== '0' || !Array.isArray(p.data)) return null;
  let longUsd = 0;
  let shortUsd = 0;
  let count = 0;
  for (const entry of p.data) {
    for (const d of entry.details ?? []) {
      const ts = num(d.ts);
      const sz = num(d.sz);
      const px = num(d.bkPx);
      if (ts === null || sz === null || px === null || ts < sinceTs) continue;
      const usd = sz * contractBtc * px;
      if (d.posSide === 'long') longUsd += usd;
      else if (d.posSide === 'short') shortUsd += usd;
      else continue;
      count++;
    }
  }
  return { windowMinutes, longUsd: +longUsd.toFixed(0), shortUsd: +shortUsd.toFixed(0), count, venues: ['okx'] };
}

// ---------- pure aggregation ----------

export function aggregateVenues(readings: VenueReading[]): Pick<DerivativesSnapshot, 'fundingRate8hPct' | 'fundingAnnualizedPct' | 'fundingSpreadPct' | 'openInterestUsd' | 'openInterestBtc'> {
  const fundings = readings.map((r) => r.fundingRate8hPct).filter((v): v is number => v !== null);
  const funding = fundings.length > 0 ? median(fundings) : null;
  const oiUsd = readings.map((r) => r.openInterestUsd).filter((v): v is number => v !== null);
  const oiBtc = readings.map((r) => r.openInterestBtc).filter((v): v is number => v !== null);
  return {
    fundingRate8hPct: funding === null ? null : +funding.toFixed(6),
    fundingAnnualizedPct: funding === null ? null : +(funding * 3 * 365).toFixed(2),
    fundingSpreadPct: fundings.length >= 2 ? +(Math.max(...fundings) - Math.min(...fundings)).toFixed(6) : null,
    openInterestUsd: oiUsd.length > 0 ? +oiUsd.reduce((a, b) => a + b, 0).toFixed(0) : null,
    openInterestBtc: oiBtc.length > 0 ? +oiBtc.reduce((a, b) => a + b, 0).toFixed(2) : null,
  };
}

export function positioningFor(funding8hPct: number | null, cfg = DERIVATIVES_CONFIG): DerivativesSnapshot['positioning'] {
  if (funding8hPct === null) return { state: 'unknown', note: 'No funding data' };
  if (funding8hPct >= cfg.crowdedLongPct) return { state: 'long-crowded', note: `Longs paying ${funding8hPct.toFixed(4)}% / 8h — crowded long, squeeze risk to the downside` };
  if (funding8hPct <= cfg.crowdedShortPct) return { state: 'short-crowded', note: `Shorts paying ${Math.abs(funding8hPct).toFixed(4)}% / 8h — crowded short, squeeze risk to the upside` };
  return { state: 'balanced', note: `Funding ${funding8hPct.toFixed(4)}% / 8h — positioning near neutral` };
}

/** Median across venues of (OI now vs. our stored reading closest to 24h ago, within ±45 min). */
export function oiChange24hPct(now: VenueReading[], history: VenueReading[], nowTs: number, lookbackMs = DERIVATIVES_CONFIG.historyLookbackMs): number | null {
  const target = nowTs - lookbackMs;
  const tolerance = 45 * 60_000;
  const changes: number[] = [];
  for (const r of now) {
    if (r.openInterestUsd === null) continue;
    let best: VenueReading | null = null;
    for (const h of history) {
      if (h.venue !== r.venue || h.openInterestUsd === null || Math.abs(h.ts - target) > tolerance) continue;
      if (!best || Math.abs(h.ts - target) < Math.abs(best.ts - target)) best = h;
    }
    if (best && best.openInterestUsd! > 0) changes.push(((r.openInterestUsd - best.openInterestUsd!) / best.openInterestUsd!) * 100);
  }
  const m = changes.length > 0 ? median(changes) : null;
  return m === null ? null : +m.toFixed(2);
}

/** One point per refresh timestamp: venue-median funding and summed OI — the chartable series. */
export function buildDerivativesSeries(rows: VenueReading[]): Array<{ ts: number; fundingRate8hPct: number | null; openInterestUsd: number | null; venues: number }> {
  const byTs = new Map<number, VenueReading[]>();
  for (const r of rows) {
    const list = byTs.get(r.ts) ?? [];
    list.push(r);
    byTs.set(r.ts, list);
  }
  return [...byTs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ts, group]) => {
      const agg = aggregateVenues(group);
      return { ts, fundingRate8hPct: agg.fundingRate8hPct, openInterestUsd: agg.openInterestUsd, venues: group.length };
    });
}

export function fundingAvg24hPct(history: VenueReading[]): number | null {
  const series = buildDerivativesSeries(history).map((p) => p.fundingRate8hPct).filter((v): v is number => v !== null);
  if (series.length === 0) return null;
  return +(series.reduce((a, b) => a + b, 0) / series.length).toFixed(6);
}

// ---------- provider ----------

export class DerivativesProvider {
  constructor(
    private readonly db: SignalDatabase,
    private readonly fetcher: JsonFetcher = fetchJson,
  ) {}

  async fetchSnapshot(): Promise<DerivativesSnapshot> {
    const now = Date.now();
    const cfg = DERIVATIVES_CONFIG;
    const opts = { timeoutMs: cfg.requestTimeoutMs, retries: 0 };
    const get = <T>(url: string) => this.fetcher<T>(url, opts);

    const attempts: Array<[DerivativesVenue, Promise<VenueReading | null>]> = [
      ['kraken-futures', get(`${cfg.krakenFuturesApi}/derivatives/api/v3/tickers`).then((p) => parseKrakenFutures(p, now))],
      ['deribit', get(`${cfg.deribitApi}/api/v2/public/ticker?instrument_name=BTC-PERPETUAL`).then((p) => parseDeribit(p, now))],
      ['bitmex', get(`${cfg.bitmexApi}/api/v1/instrument?symbol=XBTUSD`).then((p) => parseBitmex(p, now))],
      ['bybit', get(`${cfg.bybitApi}/v5/market/tickers?category=linear&symbol=BTCUSDT`).then((p) => parseBybit(p, now))],
      [
        'okx',
        Promise.all([
          get(`${cfg.okxApi}/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`),
          get(`${cfg.okxApi}/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP`),
          get(`${cfg.okxApi}/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP`),
        ]).then(([f, oi, m]) => parseOkx(f, oi, m, now)),
      ],
    ];
    const settled = await Promise.allSettled(attempts.map(([, p]) => p));
    const readings: VenueReading[] = [];
    const failures: string[] = [];
    settled.forEach((s, i) => {
      const venue = attempts[i][0];
      if (s.status === 'fulfilled' && s.value) readings.push(s.value);
      else failures.push(venue);
    });

    const sinceLiq = now - cfg.liquidationWindowMinutes * 60_000;
    const liquidations = await get(`${cfg.okxApi}/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=100`)
      .then((p) => parseOkxLiquidations(p, sinceLiq, cfg.liquidationWindowMinutes))
      .catch(() => null);

    if (readings.length > 0) {
      this.db.upsertDerivatives(readings);
      return this.compose(readings, liquidations, now, 'fresh', failures);
    }

    const stored = this.db.getLatestDerivativesByVenue();
    if (stored.length > 0) {
      console.warn('[derivatives] every venue unreachable — serving last-known stored readings');
      return this.compose(stored, liquidations, now, 'stale', failures);
    }
    return {
      venues: [],
      fundingRate8hPct: null,
      fundingAnnualizedPct: null,
      fundingSpreadPct: null,
      openInterestUsd: null,
      openInterestBtc: null,
      oiChange24hPct: null,
      fundingAvg24hPct: null,
      liquidations,
      positioning: { state: 'unknown', note: 'No venue reachable' },
      source: 'none',
      timestamp: now,
      freshness: 'unavailable',
      available: false,
    };
  }

  private compose(readings: VenueReading[], liquidations: LiquidationSummary | null, now: number, freshness: Freshness, failures: string[]): DerivativesSnapshot {
    const history = this.db.getDerivativesSince(now - DERIVATIVES_CONFIG.historyLookbackMs - 60 * 60_000);
    const agg = aggregateVenues(readings);
    return {
      venues: readings,
      ...agg,
      oiChange24hPct: oiChange24hPct(readings, history, now),
      fundingAvg24hPct: fundingAvg24hPct(history),
      liquidations,
      positioning: positioningFor(agg.fundingRate8hPct),
      source: `${readings.map((r) => r.venue).join('+')}${failures.length > 0 ? ` (unreachable: ${failures.join(', ')})` : ''}`,
      timestamp: now,
      freshness,
      available: true,
    };
  }
}
