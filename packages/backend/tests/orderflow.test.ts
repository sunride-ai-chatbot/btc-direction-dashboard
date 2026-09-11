import { describe, expect, it } from 'vitest';
import { PriceStream, TradeCandleBuilder, computeCvd, preferCandle } from '../src/providers/priceStream.js';
import type { Candle1m } from '../src/types.js';

const NOW = Date.parse('2026-09-11T10:00:00Z');
const MINUTE = Math.floor(NOW / 60_000) * 60_000;

function candle(ts: number, volume: number, takerBuyVolume: number | null): Candle1m {
  return { ts, open: 1, high: 1, low: 1, close: 1, volume, takerBuyVolume };
}

describe('CVD with mixed candle provenance', () => {
  it('uses only candles that know their taker split and withholds a window with too few of them', () => {
    // 20 older candles with a real 80% buy split, then 20 recent REST-backfilled candles (no split).
    const known = Array.from({ length: 20 }, (_, i) => candle(NOW - (40 - i) * 60_000, 10, 8));
    const unknown = Array.from({ length: 20 }, (_, i) => candle(NOW - (20 - i) * 60_000, 10, null));
    const cvd = computeCvd([...known, ...unknown]);
    expect(cvd.ratio1h).toBeCloseTo(0.6, 4); // (8 − 2) / 10 from the 20 known candles only
    expect(cvd.ratio15m).toBeNull(); // the last 15 minutes are all split-less — no order flow, not a fake 0
    expect(cvd.candles).toBe(40);
  });
});

describe('preferCandle merge rule', () => {
  const withSplit = candle(MINUTE, 10, 6);
  const noSplit = candle(MINUTE, 12, null);
  it('keeps the candle that knows its split when the incoming one does not', () => {
    expect(preferCandle(withSplit, noSplit)).toBe(withSplit);
  });
  it('otherwise the incoming candle wins', () => {
    expect(preferCandle(noSplit, withSplit)).toBe(withSplit);
    expect(preferCandle(noSplit, candle(MINUTE, 13, null)).volume).toBe(13);
    expect(preferCandle(undefined, noSplit)).toBe(noSplit);
  });
  it('PriceStream.seedCandles applies the same rule to the in-memory series', () => {
    const stream = new PriceStream();
    stream.seedCandles([withSplit]);
    stream.seedCandles([noSplit]);
    expect(stream.recentCandles(1)[0].takerBuyVolume).toBe(6);
    stream.seedCandles([candle(MINUTE, 20, 15)]);
    expect(stream.recentCandles(1)[0].volume).toBe(20);
  });
});

describe('TradeCandleBuilder — pooled trades → 1-minute candles', () => {
  it('pools trades from several venues into one minute with the real taker split and OHLC', () => {
    const b = new TradeCandleBuilder(3_000);
    b.add({ price: 100, size: 0.5, takerBuy: true, ts: MINUTE + 1_000 }); // coinbase
    b.add({ price: 101, size: 0.25, takerBuy: false, ts: MINUTE + 2_000 }); // kraken
    b.add({ price: 99, size: 0.25, takerBuy: true, ts: MINUTE + 59_000 });
    expect(b.pending).toBe(1);
    expect(b.closeDue(MINUTE + 60_000 + 2_999)).toEqual([]); // inside the grace period — not closed yet
    const [c] = b.closeDue(MINUTE + 63_000);
    expect(c).toEqual({ ts: MINUTE, open: 100, high: 101, low: 99, close: 99, volume: 1, takerBuyVolume: 0.75 });
    expect(b.pending).toBe(0);
  });

  it('a late trade from a slower venue still lands in its own minute, and only due minutes close', () => {
    const b = new TradeCandleBuilder(3_000);
    b.add({ price: 100, size: 1, takerBuy: true, ts: MINUTE + 61_000 }); // next minute already started
    b.add({ price: 100, size: 1, takerBuy: false, ts: MINUTE + 30_000 }); // late arrival for the previous minute
    expect(b.pending).toBe(2);
    const closed = b.closeDue(MINUTE + 63_000);
    expect(closed.map((c) => c.ts)).toEqual([MINUTE]);
    expect(closed[0].takerBuyVolume).toBe(0);
    expect(b.pending).toBe(1); // the current minute stays open
  });

  it('ignores malformed trades instead of poisoning a candle', () => {
    const b = new TradeCandleBuilder(0);
    b.add({ price: Number.NaN, size: 1, takerBuy: true, ts: MINUTE });
    b.add({ price: 100, size: 0, takerBuy: true, ts: MINUTE });
    b.add({ price: 100, size: -1, takerBuy: true, ts: MINUTE });
    expect(b.pending).toBe(0);
  });

  it('PriceStream.flushCandles seeds closed minutes into the series and reports them for persistence', () => {
    const persisted: Candle1m[] = [];
    const stream = new PriceStream((c) => persisted.push(c));
    // Reach the builder through a Coinbase 'match' frame, exactly as the socket would deliver it.
    (stream as unknown as { handleMessage: (ex: string, raw: string) => void }).handleMessage(
      'coinbase',
      JSON.stringify({ type: 'match', side: 'sell', size: '0.4', price: '77000', time: new Date(MINUTE + 5_000).toISOString() }),
    );
    (stream as unknown as { handleMessage: (ex: string, raw: string) => void }).handleMessage(
      'kraken',
      JSON.stringify([1, [['77010', '0.6', String((MINUTE + 6_000) / 1000), 's', 'l', '']], 'trade', 'XBT/USD']),
    );
    stream.flushCandles(MINUTE + 70_000);
    expect(persisted).toHaveLength(1);
    // Coinbase `side` is the maker side (sell maker ⇒ taker bought); Kraken `s` is the taker side (sold).
    expect(persisted[0]).toEqual({ ts: MINUTE, open: 77000, high: 77010, low: 77000, close: 77010, volume: 1, takerBuyVolume: 0.4 });
    expect(stream.cvd().candles).toBe(1);
  });
});
