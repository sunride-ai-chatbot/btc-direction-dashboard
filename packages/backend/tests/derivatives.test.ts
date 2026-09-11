import { describe, expect, it } from 'vitest';
import { SignalDatabase } from '../src/db/database.js';
import {
  DerivativesProvider, aggregateVenues, buildDerivativesSeries, oiChange24hPct, parseBitmex, parseBybit, parseDeribit,
  parseKrakenFutures, parseOkx, parseOkxLiquidations, positioningFor, type VenueReading,
} from '../src/providers/derivatives.js';

// Real payload shapes captured from each venue on 2026-09-11 10:25 UTC.
const TS = 1789122340000;

const KRAKEN = {
  tickers: [
    { symbol: 'PF_ETHUSD', markPrice: 4000, fundingRate: 0.01, openInterest: 100 },
    { symbol: 'PF_XBTUSD', last: 77051, markPrice: 77053.46160261765, openInterest: 1928.2152, fundingRate: -0.235195377873609, fundingRatePrediction: 0.23369336085375 },
  ],
};
const DERIBIT = { result: { funding_8h: 4.2e-7, current_funding: 3.642e-5, open_interest: 826624180, mark_price: 77077.31, index_price: 77055.24 } };
const BITMEX = [{ symbol: 'XBTUSD', fundingRate: 0.0001, indicativeFundingRate: 8.9e-5, openInterest: 12155000, openValue: 15771477150, markPrice: 77069.42, isInverse: true }];
const BYBIT = { retCode: 0, result: { list: [{ symbol: 'BTCUSDT', fundingRate: '0.00004409', openInterest: '56489.004', openInterestValue: '4352524079.18', markPrice: '77050.82' }] } };
const OKX_FUNDING = { code: '0', data: [{ instId: 'BTC-USDT-SWAP', fundingRate: '0.0000146068517841', nextFundingRate: '' }] };
const OKX_OI = { code: '0', data: [{ instId: 'BTC-USDT-SWAP', oiCcy: '29083.1050000000809', oiUsd: '2240876506.73400623340972' }] };
const OKX_MARK = { code: '0', data: [{ instId: 'BTC-USDT-SWAP', markPx: '77050.8' }] };
const OKX_LIQ = {
  code: '0',
  data: [
    {
      details: [
        { posSide: 'long', side: 'sell', sz: '2.3', bkPx: '77106.8', ts: '1789121961572' },
        { posSide: 'short', side: 'buy', sz: '1', bkPx: '77000', ts: '1789121900000' },
        { posSide: 'long', side: 'sell', sz: '6.93', bkPx: '76830.3', ts: '1789100000000' }, // outside the window
      ],
    },
  ],
};

describe('derivatives venue parsers', () => {
  it('Kraken Futures: the absolute hourly funding amount is converted to a relative 8h rate', () => {
    const r = parseKrakenFutures(KRAKEN, TS)!;
    expect(r.venue).toBe('kraken-futures');
    expect(r.fundingRate8hPct).toBeCloseTo((-0.235195377873609 / 77053.46160261765) * 8 * 100, 6);
    expect(r.predictedFundingRate8hPct).toBeCloseTo((0.23369336085375 / 77053.46160261765) * 8 * 100, 6);
    expect(r.openInterestBtc).toBe(1928.2152);
    expect(r.openInterestUsd).toBe(Math.round(1928.2152 * 77053.46160261765));
    expect(parseKrakenFutures({ tickers: [] }, TS)).toBeNull();
  });

  it('Deribit: funding_8h is already per 8h; open interest is USD notional', () => {
    const r = parseDeribit(DERIBIT, TS)!;
    expect(r.fundingRate8hPct).toBeCloseTo(0.000042, 6);
    expect(r.openInterestUsd).toBe(826624180);
    expect(r.openInterestBtc).toBeCloseTo(826624180 / 77077.31, 3);
    expect(r.markPrice).toBe(77077.31);
  });

  it('BitMEX XBTUSD: inverse contracts are USD; openValue is satoshi', () => {
    const r = parseBitmex(BITMEX, TS)!;
    expect(r.fundingRate8hPct).toBe(0.01);
    expect(r.predictedFundingRate8hPct).toBeCloseTo(0.0089, 6);
    expect(r.openInterestUsd).toBe(12155000);
    expect(r.openInterestBtc).toBeCloseTo(157.7148, 3);
    expect(parseBitmex([{ symbol: 'ETHUSD' }], TS)).toBeNull();
  });

  it('Bybit: numeric strings, OI in BTC and USD', () => {
    const r = parseBybit(BYBIT, TS)!;
    expect(r.fundingRate8hPct).toBeCloseTo(0.004409, 6);
    expect(r.openInterestBtc).toBe(56489.004);
    expect(r.openInterestUsd).toBeCloseTo(4352524079.18, 2);
    expect(parseBybit({ retCode: 10001, result: {} }, TS)).toBeNull();
  });

  it('OKX: three endpoints combine; an empty nextFundingRate is null, not 0', () => {
    const r = parseOkx(OKX_FUNDING, OKX_OI, OKX_MARK, TS)!;
    expect(r.fundingRate8hPct).toBeCloseTo(0.001461, 6); // parser rounds funding to 6 decimals of a percent
    expect(r.predictedFundingRate8hPct).toBeNull();
    expect(r.openInterestBtc).toBeCloseTo(29083.105, 3);
    expect(r.openInterestUsd).toBeCloseTo(2240876506.734, 2);
    expect(r.markPrice).toBe(77050.8);
    expect(parseOkx({ code: '50011' }, { code: '50011' }, { code: '50011' }, TS)).toBeNull();
  });

  it('OKX liquidations: windowed by timestamp, long/short split, USD = contracts × 0.01 BTC × bankruptcy price', () => {
    const liq = parseOkxLiquidations(OKX_LIQ, 1789121000000, 60)!;
    expect(liq.count).toBe(2);
    expect(liq.longUsd).toBe(Math.round(2.3 * 0.01 * 77106.8));
    expect(liq.shortUsd).toBe(770);
    expect(liq.venues).toEqual(['okx']);
    expect(parseOkxLiquidations({ code: '1' }, 0, 60)).toBeNull();
  });
});

describe('derivatives aggregation', () => {
  const readings: VenueReading[] = [
    parseKrakenFutures(KRAKEN, TS)!,
    parseDeribit(DERIBIT, TS)!,
    parseBitmex(BITMEX, TS)!,
    parseBybit(BYBIT, TS)!,
    parseOkx(OKX_FUNDING, OKX_OI, OKX_MARK, TS)!,
  ];

  it('takes the venue MEDIAN for funding (one outlier venue cannot move it) and sums OI', () => {
    const agg = aggregateVenues(readings);
    const sorted = readings.map((r) => r.fundingRate8hPct!).sort((a, b) => a - b);
    expect(agg.fundingRate8hPct).toBeCloseTo(sorted[2], 6);
    expect(agg.fundingAnnualizedPct).toBeCloseTo(sorted[2] * 3 * 365, 2);
    expect(agg.fundingSpreadPct).toBeCloseTo(sorted[4] - sorted[0], 6);
    expect(agg.openInterestUsd).toBe(Math.round(readings.reduce((a, r) => a + r.openInterestUsd!, 0)));
    expect(aggregateVenues([]).fundingRate8hPct).toBeNull();
    expect(aggregateVenues([readings[0]]).fundingSpreadPct).toBeNull();
  });

  it('positioning thresholds read long-crowded / short-crowded / balanced / unknown', () => {
    expect(positioningFor(0.05).state).toBe('long-crowded');
    expect(positioningFor(-0.02).state).toBe('short-crowded');
    expect(positioningFor(0.01).state).toBe('balanced');
    expect(positioningFor(null).state).toBe('unknown');
  });

  it('24h OI change compares each venue against its OWN reading ~24h ago and is null without history', () => {
    const now = TS;
    const dayAgo = now - 24 * 3_600_000;
    const history: VenueReading[] = [
      { ...readings[3], ts: dayAgo + 5 * 60_000, openInterestUsd: 4_000_000_000 }, // bybit, +8.8% since
      { ...readings[4], ts: dayAgo - 10 * 60_000, openInterestUsd: 2_500_000_000 }, // okx, −10.4% since
      { ...readings[0], ts: now - 2 * 3_600_000, openInterestUsd: 1 }, // kraken: only 2h old — not a 24h reference
    ];
    const change = oiChange24hPct(readings, history, now)!;
    const bybit = ((readings[3].openInterestUsd! - 4_000_000_000) / 4_000_000_000) * 100;
    const okx = ((readings[4].openInterestUsd! - 2_500_000_000) / 2_500_000_000) * 100;
    expect(change).toBeCloseTo(+((bybit + okx) / 2).toFixed(2), 2); // median of two = their mean
    expect(oiChange24hPct(readings, [], now)).toBeNull();
  });

  it('builds one chart point per refresh timestamp', () => {
    const rows = [...readings, ...readings.map((r) => ({ ...r, ts: TS + 120_000, fundingRate8hPct: 0.05 }))];
    const series = buildDerivativesSeries(rows);
    expect(series).toHaveLength(2);
    expect(series[0].ts).toBe(TS);
    expect(series[0].venues).toBe(5);
    expect(series[1].fundingRate8hPct).toBe(0.05);
  });
});

describe('DerivativesProvider', () => {
  function fetcherWith(down: string[] = []) {
    return async <T,>(url: string): Promise<T> => {
      if (down.some((d) => url.includes(d))) throw new Error(`HTTP 503 from ${url}`);
      if (url.includes('futures.kraken.com')) return KRAKEN as T;
      if (url.includes('deribit')) return DERIBIT as T;
      if (url.includes('bitmex')) return BITMEX as T;
      if (url.includes('bybit')) return BYBIT as T;
      if (url.includes('funding-rate')) return OKX_FUNDING as T;
      if (url.includes('open-interest')) return OKX_OI as T;
      if (url.includes('mark-price')) return OKX_MARK as T;
      if (url.includes('liquidation-orders')) return OKX_LIQ as T;
      throw new Error('unexpected url ' + url);
    };
  }

  it('any subset of venues is enough: one venue down is recorded in `source`, the rest are persisted and reported fresh', async () => {
    const db = new SignalDatabase(':memory:');
    const provider = new DerivativesProvider(db, fetcherWith(['bitmex']));
    const snap = await provider.fetchSnapshot();
    expect(snap.freshness).toBe('fresh');
    expect(snap.available).toBe(true);
    expect(snap.venues.map((v) => v.venue).sort()).toEqual(['bybit', 'deribit', 'kraken-futures', 'okx']);
    expect(snap.source).toContain('unreachable: bitmex');
    expect(snap.fundingRate8hPct).not.toBeNull();
    expect(snap.liquidations?.count).toBeGreaterThanOrEqual(0);
    expect(snap.oiChange24hPct).toBeNull(); // no history yet — honest null, never a fake 0
    expect(db.getLatestDerivativesByVenue()).toHaveLength(4);
    expect(db.countsByTable().derivatives_history).toBe(4);
    db.close();
  });

  it('serves the last stored readings marked STALE when every venue is down, and UNAVAILABLE when there is nothing stored', async () => {
    const db = new SignalDatabase(':memory:');
    const empty = await new DerivativesProvider(db, fetcherWith(['kraken', 'deribit', 'bitmex', 'bybit', 'okx'])).fetchSnapshot();
    expect(empty.available).toBe(false);
    expect(empty.freshness).toBe('unavailable');
    expect(empty.positioning.state).toBe('unknown');

    await new DerivativesProvider(db, fetcherWith()).fetchSnapshot();
    const stale = await new DerivativesProvider(db, fetcherWith(['kraken', 'deribit', 'bitmex', 'bybit', 'okx'])).fetchSnapshot();
    expect(stale.freshness).toBe('stale');
    expect(stale.available).toBe(true);
    expect(stale.venues).toHaveLength(5);
    expect(stale.fundingRate8hPct).not.toBeNull();
    db.close();
  });
});
