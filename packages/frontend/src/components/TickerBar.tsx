import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useLive } from '../lib/live';
import { useI18n } from '../lib/i18n';
import type { DerivativesPayload, SignalBundle } from '../lib/types';
import { LiveSparkline, StatusDot } from './ui';

const LIVE_FRESH_MS = 20_000;
const SPARK_POINTS = 48;
const EXCHANGE_NAME: Record<string, string> = { binance: 'Binance', coinbase: 'Coinbase', kraken: 'Kraken' };

function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function CvdChip({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? null : Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums">
      <span className="text-slate-500">{label}</span>
      <span className="relative inline-block h-1.5 w-10 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        {pct !== null && (
          <span
            className={`absolute top-0 h-full ${pct >= 0 ? 'bg-bull shadow-glow-bull' : 'bg-bear shadow-glow-bear'}`}
            style={pct >= 0 ? { left: '50%', width: `${Math.min(50, pct / 2)}%` } : { right: '50%', width: `${Math.min(50, -pct / 2)}%` }}
          />
        )}
        <span className="absolute left-1/2 top-0 h-full w-px bg-slate-600" />
      </span>
      <span className={pct === null ? 'text-slate-600' : pct > 0 ? 'text-bull' : pct < 0 ? 'text-bear' : 'text-slate-300'}>{pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}</span>
    </span>
  );
}

/** Always-visible live strip: consensus price, direction flash, sparkline, the venues actually feeding it, order flow and funding. */
export function TickerBar() {
  const { t, lang } = useI18n();
  const live = useLive();
  const { data: bundle } = useApi<SignalBundle>('/api/signal', 60_000);
  const { data: deriv } = useApi<DerivativesPayload>('/api/derivatives', 120_000);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [spark, setSpark] = useState<number[]>([]);
  const lastRef = useRef<number | null>(null);

  const tick = live.tick;
  const fresh = live.connected && tick !== null && tick.price !== null && Date.now() - tick.ts < LIVE_FRESH_MS;
  const price = fresh ? tick!.price! : (bundle?.signals['24h'].btcPrice ?? null);

  useEffect(() => {
    if (!live.lastMove || !fresh) return;
    setFlash(live.lastMove);
    const id = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(id);
  }, [tick?.price, live.lastMove, fresh]);

  useEffect(() => {
    if (!fresh || tick?.price == null || tick.price === lastRef.current) return;
    lastRef.current = tick.price;
    setSpark((prev) => [...prev, tick.price!].slice(-SPARK_POINTS));
  }, [tick?.price, fresh]);

  const tech = bundle?.signals['24h'].components.technical.details as { change24h?: number | null } | undefined;
  const change24h = typeof tech?.change24h === 'number' ? tech.change24h : null;
  const venues = fresh && tick ? Object.entries(tick.exchanges).filter(([, v]) => v !== null && Date.now() - v.ts < LIVE_FRESH_MS) : [];
  const sparkTone: 'bull' | 'bear' = spark.length >= 2 && spark[spark.length - 1] < spark[0] ? 'bear' : 'bull';
  const funding = deriv?.available ? deriv.fundingRate8hPct : null;
  const positioning = deriv?.positioning.state ?? 'unknown';

  return (
    <div className="glass sticky top-0 z-30 border-x-0 border-t-0 lg:top-0">
      <div className="flex items-center gap-4 overflow-x-auto px-4 py-2 sm:px-6 [scrollbar-width:none]">
        <div className="flex shrink-0 items-center gap-2">
          <StatusDot tone={fresh ? 'bull' : 'neutral'} pulse={fresh} className="h-2 w-2" />
          <span className="font-display text-sm font-semibold tracking-wide text-slate-200">BTC / USD</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${fresh ? 'bg-bull/10 text-bull' : 'bg-slate-500/10 text-slate-500'}`}>{fresh ? t('live.live') : t('live.polling')}</span>
        </div>

        <div className="flex shrink-0 items-baseline gap-2">
          <span className={`font-display text-2xl font-bold tabular-nums transition-colors duration-300 ${flash === 'up' ? 'price-flash-up text-neon-bull' : flash === 'down' ? 'price-flash-down text-neon-bear' : 'text-slate-50'}`}>
            {price !== null ? fmtUsd(price) : '—'}
          </span>
          {change24h !== null && (
            <span className={`font-mono text-xs tabular-nums ${change24h > 0 ? 'text-bull' : change24h < 0 ? 'text-bear' : 'text-slate-400'}`}>
              {'‎'}{change24h > 0 ? '+' : ''}{change24h.toFixed(2)}% <span className="text-slate-500">24h</span>
            </span>
          )}
        </div>

        {spark.length >= 2 && <LiveSparkline points={spark} tone={sparkTone} className="hidden h-8 w-28 shrink-0 md:block" />}

        {venues.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums text-slate-400">
            {venues.map(([name, v]) => (
              <span key={name} className="rounded-md bg-surface/70 px-1.5 py-0.5">
                <span className="text-slate-500">{EXCHANGE_NAME[name] ?? name}</span> {fmtUsd(v!.price)}
              </span>
            ))}
            {fresh && tick?.spreadPct !== null && tick && tick.spreadPct > 0.05 && (
              <span className={tick.anomaly ? 'text-bear' : 'text-slate-500'}>{t('ticker.spread', { pct: tick.spreadPct.toFixed(2) })}</span>
            )}
          </div>
        )}

        {fresh && tick && (
          <div className="flex shrink-0 items-center gap-3" title={t('orderflow.title')}>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">CVD</span>
            <CvdChip label="15m" value={tick.cvd.ratio15m} />
            <CvdChip label="1h" value={tick.cvd.ratio1h} />
            <CvdChip label="4h" value={tick.cvd.ratio4h} />
          </div>
        )}

        {funding !== null && (
          <NavLink to="/derivatives" className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors hover:bg-card-hover">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('ticker.funding')}</span>
            <span className={positioning === 'long-crowded' ? 'text-bear' : positioning === 'short-crowded' ? 'text-bull' : 'text-slate-200'}>
              {'‎'}{funding > 0 ? '+' : ''}{funding.toFixed(4)}%
            </span>
            <StatusDot tone={positioning === 'long-crowded' ? 'bear' : positioning === 'short-crowded' ? 'bull' : positioning === 'balanced' ? 'flat' : 'neutral'} className="h-1.5 w-1.5" />
          </NavLink>
        )}

        <span className="ms-auto hidden shrink-0 text-[11px] text-slate-500 xl:block">{lang === 'he' ? 'חציון בורסות · SSE' : 'exchange median · SSE'}</span>
      </div>
    </div>
  );
}
