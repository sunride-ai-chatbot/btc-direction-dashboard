import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type MouseEventParams,
} from 'lightweight-charts';
import { useApi } from '../lib/api';
import { useLive } from '../lib/live';
import { useI18n } from '../lib/i18n';
import type { Candle1m, CandlesPayload, ConformalInterval, Horizon } from '../lib/types';

// Bar size and how much history to pull per horizon — enough bars to read structure,
// plus room for the forward projection.
const BUCKET_MIN: Record<Horizon, number> = { '1h': 1, '4h': 5, '24h': 15, '72h': 30 };
const FETCH_N: Record<Horizon, number> = { '1h': 720, '4h': 1440, '24h': 2880, '72h': 4320 };
const HORIZON_MIN: Record<Horizon, number> = { '1h': 60, '4h': 240, '24h': 1440, '72h': 4320 };

// Validated with the dataviz palette checker (dark surface #121826): CVD-safe, distinct
// from the bull/bear status colors which stay reserved for candles and volume.
const EMA_COLORS = { 20: '#0284c7', 50: '#b45309', 200: '#7c3aed' } as const;
const BULL = '#22c55e';
const BEAR = '#ef4444';
const NEUTRAL = 'rgba(148,163,184,0.45)';
const UNKNOWN = 'rgba(148,163,184,0.22)';
// The band masks must be opaque and match this exactly, so the chart owns a solid ground.
const CHART_BG = '#121826';

interface Bar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** taker buy share 0..1 among candles that know their split; null when none did */
  buyShare: number | null;
}

function aggregate(candles: Candle1m[], bucketMin: number): Bar[] {
  const size = bucketMin * 60_000;
  const out: Bar[] = [];
  let cur: (Bar & { buyVol: number; splitVol: number }) | null = null;
  for (const c of candles) {
    const bucket = Math.floor(c.ts / size) * size;
    if (!cur || cur.time !== (bucket / 1000) as UTCTimestamp) {
      if (cur) out.push(finish(cur));
      cur = { time: (bucket / 1000) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0, buyShare: null, buyVol: 0, splitVol: 0 };
    }
    cur.high = Math.max(cur.high, c.high);
    cur.low = Math.min(cur.low, c.low);
    cur.close = c.close;
    cur.volume += c.volume;
    if (c.takerBuyVolume !== null) {
      cur.buyVol += c.takerBuyVolume;
      cur.splitVol += c.volume;
    }
  }
  if (cur) out.push(finish(cur));
  return out;

  function finish(b: Bar & { buyVol: number; splitVol: number }): Bar {
    const { buyVol, splitVol, ...bar } = b;
    return { ...bar, buyShare: splitVol > 0 ? buyVol / splitVol : null };
  }
}

function ema(values: number[], period: number): Array<number | null> {
  const k = 2 / (period + 1);
  const out: Array<number | null> = [];
  let prev: number | null = null;
  values.forEach((v, i) => {
    if (i < period - 1) {
      out.push(null);
      return;
    }
    if (prev === null) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  });
  return out;
}

function volumeColor(share: number | null): string {
  if (share === null) return UNKNOWN;
  if (share >= 0.55) return 'rgba(34,197,94,0.7)';
  if (share <= 0.45) return 'rgba(239,68,68,0.7)';
  return NEUTRAL;
}

/**
 * Conformal cone: the interval is calibrated for the horizon endpoint. Diffusion grows
 * with √t, drift (the center) linearly, so the band is scaled that way from "now" to the
 * horizon — an honest shape, not a flat tube.
 */
type Pt = { time: UTCTimestamp; value: number };

function projection(lastTime: UTCTimestamp, lastClose: number, conf: ConformalInterval, horizonMin: number, bucketMin: number) {
  const steps = Math.max(2, Math.round(horizonMin / bucketMin));
  const pts: { hi80: Pt[]; lo80: Pt[]; hi50: Pt[]; lo50: Pt[]; center: Pt[] } = { hi80: [], lo80: [], hi50: [], lo50: [], center: [] };
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const time = (lastTime + i * bucketMin * 60) as UTCTimestamp;
    const drift = conf.center * f;
    const spread = Math.sqrt(f);
    const at = (pct: number) => +(lastClose * (1 + (drift + (pct - conf.center) * spread) / 100)).toFixed(2);
    pts.hi80.push({ time, value: at(conf.hi80) });
    pts.lo80.push({ time, value: at(conf.lo80) });
    pts.hi50.push({ time, value: at(conf.hi50) });
    pts.lo50.push({ time, value: at(conf.lo50) });
    pts.center.push({ time, value: +(lastClose * (1 + drift / 100)).toFixed(2) });
  }
  return pts;
}

interface Hover {
  bar: Bar;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
}

export function LiveChart({ horizon, conformal, tone }: { horizon: Horizon; conformal: ConformalInterval | null; tone: 'bull' | 'bear' | 'flat' | 'neutral' }) {
  const { t, lang } = useI18n();
  const live = useLive();
  const bucketMin = BUCKET_MIN[horizon];
  const { data } = useApi<CandlesPayload>(`/api/candles?n=${FETCH_N[horizon]}`, 60_000);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candles: ISeriesApi<'Candlestick'>;
    volume: ISeriesApi<'Histogram'>;
    ema20: ISeriesApi<'Line'>;
    ema50: ISeriesApi<'Line'>;
    ema200: ISeriesApi<'Line'>;
    band: ISeriesApi<'Area'>[];
    center: ISeriesApi<'Line'>;
  } | null>(null);
  const formingRef = useRef<{ time: UTCTimestamp; open: number; high: number; low: number; close: number } | null>(null);
  const barsRef = useRef<Bar[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);

  const bars = useMemo(() => (data ? aggregate(data.candles, bucketMin) : []), [data, bucketMin]);
  const emas = useMemo(() => {
    const closes = bars.map((b) => b.close);
    return { 20: ema(closes, 20), 50: ema(closes, 50), 200: ema(closes, 200) };
  }, [bars]);
  // Refs so the crosshair handler (registered once) always reads the latest bars/EMAs.
  const emasRef = useRef(emas);
  emasRef.current = emas;
  barsRef.current = bars;

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: '#64748b',
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: 'rgba(148,163,184,0.06)' }, horzLines: { color: 'rgba(148,163,184,0.06)' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(59,130,246,0.5)', labelBackgroundColor: '#3b82f6' },
        horzLine: { color: 'rgba(59,130,246,0.5)', labelBackgroundColor: '#3b82f6' },
      },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.12)', scaleMargins: { top: 0.08, bottom: 0.05 } },
      timeScale: { borderColor: 'rgba(148,163,184,0.12)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: (p: number) => '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
      handleScroll: { vertTouchDrag: false },
    });

    // Drawing order = creation order: band first so candles paint on top of it.
    const area = (line: string, fill: string, dashed = false) =>
      chart.addSeries(AreaSeries, {
        lineColor: line,
        lineWidth: 1,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        topColor: fill,
        bottomColor: fill,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    const toneColor = tone === 'bull' ? BULL : tone === 'bear' ? BEAR : '#94a3b8';
    const tint = (a: number) => (tone === 'bull' ? `rgba(34,197,94,${a})` : tone === 'bear' ? `rgba(239,68,68,${a})` : `rgba(148,163,184,${a})`);
    // hi80(A) → hi50(B) → lo50(mask) → lo50(A) → lo80(mask): leaves A between 80% and 50%, A+B inside 50%.
    const band = [area(toneColor, tint(0.1), true), area('transparent', tint(0.14)), area('transparent', CHART_BG), area('transparent', tint(0.1)), area(toneColor, CHART_BG, true)];
    const center = chart.addSeries(LineSeries, { color: toneColor, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const emaOpts = (color: string) => ({ color, lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema200 = chart.addSeries(LineSeries, emaOpts(EMA_COLORS[200]));
    const ema50 = chart.addSeries(LineSeries, emaOpts(EMA_COLORS[50]));
    const ema20 = chart.addSeries(LineSeries, emaOpts(EMA_COLORS[20]));
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: BULL,
      downColor: BEAR,
      wickUpColor: BULL,
      wickDownColor: BEAR,
      borderVisible: false,
    });
    // Volume is BTC, not USD — its own formatter so the pane never shows the global "$" labels.
    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'custom', minMove: 0.01, formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(v < 10 ? 1 : 0)) },
        priceScaleId: 'right',
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    try {
      chart.panes()[1]?.setHeight(88);
    } catch {
      // older engine without pane sizing — volume simply shares the default split
    }

    chartRef.current = chart;
    seriesRef.current = { candles, volume, ema20, ema50, ema200, band, center };

    const onMove = (param: MouseEventParams) => {
      if (!param.time || !param.seriesData.has(candles)) {
        setHover(null);
        return;
      }
      const idx = barsRef.current.findIndex((b) => b.time === param.time);
      if (idx < 0) {
        setHover(null);
        return;
      }
      setHover({ bar: barsRef.current[idx], ema20: emasRef.current[20][idx] ?? null, ema50: emasRef.current[50][idx] ?? null, ema200: emasRef.current[200][idx] ?? null });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // The band tone is baked into series colors; a tone change re-creates the chart.
  }, [tone]);

  // Push data whenever history, horizon or the conformal interval changes.
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart || bars.length === 0) return;
    s.candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    s.volume.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: volumeColor(b.buyShare) })));
    const line = (period: 20 | 50 | 200) =>
      bars.map((b, i) => (emas[period][i] === null ? { time: b.time } : { time: b.time, value: emas[period][i]! }));
    s.ema20.setData(line(20));
    s.ema50.setData(line(50));
    s.ema200.setData(line(200));

    const last = bars[bars.length - 1];
    if (conformal) {
      const p = projection(last.time, last.close, conformal, HORIZON_MIN[horizon], bucketMin);
      const [hi80, hi50, lo50mask, lo50, lo80mask] = s.band;
      hi80.setData(p.hi80);
      hi50.setData(p.hi50);
      lo50mask.setData(p.lo50);
      lo50.setData(p.lo50);
      lo80mask.setData(p.lo80);
      s.center.setData(p.center);
    } else {
      for (const b of s.band) b.setData([]);
      s.center.setData([]);
    }
    formingRef.current = null;
    // Show the recent past plus the near projection, then let the user scroll.
    const visibleBars = Math.min(bars.length, Math.round((HORIZON_MIN[horizon] * 2.5) / bucketMin) + 30);
    const futureBars = conformal ? Math.min(Math.round(HORIZON_MIN[horizon] / bucketMin), Math.round(visibleBars * 0.4)) : 4;
    chart.timeScale().setVisibleLogicalRange({ from: bars.length - visibleBars, to: bars.length - 1 + futureBars });
  }, [bars, emas, conformal, horizon, bucketMin]);

  // Live forming bar from SSE ticks — the chart moves between candle refreshes.
  useEffect(() => {
    const s = seriesRef.current;
    const price = live.tick?.price ?? null;
    if (!s || price === null || bars.length === 0) return;
    const size = bucketMin * 60;
    const bucket = (Math.floor(Date.now() / 1000 / size) * size) as UTCTimestamp;
    const last = bars[bars.length - 1];
    if (bucket <= last.time) return; // history already covers this bucket
    const prev = formingRef.current;
    const forming =
      !prev || prev.time !== bucket
        ? { time: bucket, open: price, high: price, low: price, close: price }
        : { ...prev, high: Math.max(prev.high, price), low: Math.min(prev.low, price), close: price };
    formingRef.current = forming;
    s.candles.update(forming);
  }, [live.tick?.price, bars, bucketMin]);

  const fmt = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits }));
  const lastBar = bars[bars.length - 1];
  const shown = hover ?? (lastBar ? { bar: lastBar, ema20: emas[20][bars.length - 1] ?? null, ema50: emas[50][bars.length - 1] ?? null, ema200: emas[200][bars.length - 1] ?? null } : null);

  return (
    <div className="chart-ltr relative">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[11px] tabular-nums text-slate-400">
        {shown ? (
          <>
            <span>
              O <span className="text-slate-200">{fmt(shown.bar.open)}</span> H <span className="text-slate-200">{fmt(shown.bar.high)}</span> L{' '}
              <span className="text-slate-200">{fmt(shown.bar.low)}</span> C{' '}
              <span className={shown.bar.close >= shown.bar.open ? 'text-bull' : 'text-bear'}>{fmt(shown.bar.close)}</span>
            </span>
            <span>
              {t('chart.vol')} <span className="text-slate-200">{fmt(shown.bar.volume, 2)}</span>
              {shown.bar.buyShare !== null && (
                <span className={`ms-1 ${shown.bar.buyShare >= 0.55 ? 'text-bull' : shown.bar.buyShare <= 0.45 ? 'text-bear' : ''}`}>
                  · {t('chart.takerBuy')} {(shown.bar.buyShare * 100).toFixed(0)}%
                </span>
              )}
            </span>
            <span className="flex items-center gap-3">
              <span style={{ color: EMA_COLORS[20] }}>EMA20 {fmt(shown.ema20)}</span>
              <span style={{ color: EMA_COLORS[50] }}>EMA50 {fmt(shown.ema50)}</span>
              <span style={{ color: EMA_COLORS[200] }}>EMA200 {fmt(shown.ema200)}</span>
            </span>
          </>
        ) : (
          <span>{t('chart.loading')}</span>
        )}
      </div>
      <div ref={containerRef} className="h-[380px] w-full overflow-hidden rounded-xl sm:h-[440px]" role="img" aria-label={t('chart.aria', { m: bucketMin, h: t(`horizon.${horizon}`) })} />
      {data && bars.length < 5 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-slate-500">{t('chart.empty')}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: tone === 'bull' ? 'rgba(34,197,94,0.35)' : tone === 'bear' ? 'rgba(239,68,68,0.35)' : 'rgba(148,163,184,0.35)' }} />
          {conformal ? t('chart.projection', { h: t(`horizon.${horizon}`) }) : t('chart.noProjection')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-bull/70" />
          <span className="inline-block h-2 w-2 rounded-sm bg-bear/70" />
          {t('chart.volumeLegend')}
        </span>
        <span>{lang === 'he' ? `נרות של ${bucketMin} דק׳` : `${bucketMin}m candles`}</span>
      </div>
    </div>
  );
}
