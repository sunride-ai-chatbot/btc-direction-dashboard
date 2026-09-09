import { useEffect, useRef, useState } from 'react';
import type { HorizonSignal } from '../lib/types';
import { timeAgo, type LiveStreamState } from '../lib/api';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';
import { StatusDot, type Tone } from './ui';

const LABEL_STYLE: Record<string, { tone: Tone; text: string; ring: string }> = {
  BULLISH: { tone: 'bull', text: 'text-bull text-glow-bull', ring: 'ring-bull/30 signal-ring-bull' },
  NEUTRAL: { tone: 'flat', text: 'text-flat text-glow-flat', ring: 'ring-flat/30 signal-ring-flat' },
  BEARISH: { tone: 'bear', text: 'text-bear text-glow-bear', ring: 'ring-bear/30 signal-ring-bear' },
};

const GATED_STYLE = { tone: 'neutral' as Tone, text: 'text-slate-300', ring: 'ring-slate-500/30' };

const LIVE_FRESH_MS = 20_000;
const SPARKLINE_POINTS = 36;

function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// LRM (U+200E) keeps the signed number resolving left-to-right when embedded in an
// RTL sentence — without it a leading '-' (or '≤') visually detaches from its digits
// (see dynamicHe.ts, which uses the same prefix for the same reason).
function pct(v: number): string {
  return `‎${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Tiny live trend line of the last ~36 ticks — purely decorative reinforcement of the
 * price already shown as text above it, so it's hidden from screen readers. */
function LiveSparkline({ points, tone }: { points: number[]; tone: 'bull' | 'bear' }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 56;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 8) - 4;
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const [lastX, lastY] = coords[coords.length - 1];
  const stroke = tone === 'bull' ? '#39ff14' : '#ff1744';
  const gradId = `spark-fill-${tone}`;

  return (
    <div className="chart-ltr mx-auto mt-3 max-w-xs" aria-hidden="true">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 4px ${stroke})` }}
        />
        <circle cx={lastX} cy={lastY} r="3" fill={stroke} style={{ filter: `drop-shadow(0 0 5px ${stroke})` }} />
      </svg>
    </div>
  );
}

export function SignalCard({ signal, live }: { signal: HorizonSignal; live?: LiveStreamState }) {
  const { t, lang } = useI18n();
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [sparkline, setSparkline] = useState<number[]>([]);
  const sparklineLastRef = useRef<number | null>(null);

  const tick = live?.tick ?? null;
  const streamFresh = !!live?.connected && tick !== null && tick.price !== null && Date.now() - tick.ts < LIVE_FRESH_MS;
  const price = streamFresh ? tick!.price! : signal.btcPrice;

  useEffect(() => {
    if (!live?.lastMove || !streamFresh) return;
    setFlash(live.lastMove);
    const id = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(id);
  }, [tick?.price, live?.lastMove, streamFresh]);

  // Rolling buffer of recent live ticks, purely client-side, to draw the sparkline —
  // resets naturally if the live stream drops (sparkline just disappears until it refills).
  useEffect(() => {
    if (!streamFresh || tick?.price == null || tick.price === sparklineLastRef.current) return;
    sparklineLastRef.current = tick.price;
    setSparkline((prev) => [...prev, tick.price!].slice(-SPARKLINE_POINTS));
  }, [tick?.price, streamFresh]);

  const style = signal.gated ? GATED_STYLE : LABEL_STYLE[signal.label];
  const edge = signal.edge;
  const edgeStatusKey = `edge.status.${edge?.status ?? 'insufficient'}` as TranslationKey;
  // "7d" inside a Hebrew sentence would render mirrored; spell the window out per language.
  const windowLabel = (w: string) => (lang === 'he' ? w.replace(/^(\d+)d$/, '$1 ימים') : w);
  const conf = signal.conformal;
  const sim = signal.similarStates;

  return (
    <div className={`rounded-2xl bg-card ring-1 ${style.ring} animate-fade-in-up p-6 text-center shadow-elevated sm:p-8`}>
      <div className="flex items-center justify-center gap-2 text-sm uppercase tracking-widest text-slate-400">
        <span>BTC</span>
        {live && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              streamFresh ? 'bg-bull/10 text-bull' : 'bg-slate-500/10 text-slate-500'
            }`}
            title={
              streamFresh && tick
                ? t('live.tooltip', { n: tick.freshExchanges, spread: (tick.spreadPct ?? 0).toFixed(2) })
                : undefined
            }
          >
            <StatusDot tone={streamFresh ? 'bull' : 'neutral'} pulse={streamFresh} className="h-1.5 w-1.5" />
            {streamFresh ? t('live.live') : t('live.polling')}
          </span>
        )}
        {streamFresh && tick?.anomaly && (
          <span className="rounded-full bg-bear/10 px-2 py-0.5 text-[10px] font-bold text-bear" title={t('live.anomalyTooltip', { note: tick.anomalyNote ?? '' })}>
            {t('live.anomaly')}
          </span>
        )}
      </div>
      <div
        className={`mt-1 font-mono text-4xl font-bold tabular-nums transition-colors duration-300 sm:text-5xl ${
          flash === 'up'
            ? 'price-flash-up text-neon-bull'
            : flash === 'down'
              ? 'price-flash-down text-neon-bear'
              : 'text-slate-50'
        }`}
      >
        {price !== null ? fmtUsd(price) : '—'}
      </div>
      {streamFresh && tick && (
        <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
          {t('live.exchanges', {
            b: tick.exchanges.binance ? fmtUsd(tick.exchanges.binance.price) : '—',
            c: tick.exchanges.coinbase ? fmtUsd(tick.exchanges.coinbase.price) : '—',
            k: tick.exchanges.kraken ? fmtUsd(tick.exchanges.kraken.price) : '—',
          })}
        </div>
      )}
      {sparkline.length >= 2 && (
        <LiveSparkline points={sparkline} tone={sparkline[sparkline.length - 1] >= sparkline[0] ? 'bull' : 'bear'} />
      )}

      {signal.gated ? (
        <>
          <div className={`mt-4 flex items-center justify-center gap-2.5 text-2xl font-extrabold tracking-wide sm:text-4xl ${style.text}`}>
            <StatusDot tone={style.tone} className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            {t('edge.noProvenEdge')}
          </div>
          <div className="mt-2 text-sm text-slate-400">
            {t('edge.modelLean', { label: t(`label.${signal.label}`) })}{' '}
            <span className="font-mono tabular-nums">
              ({signal.finalScore > 0 ? '+' : ''}
              {signal.finalScore})
            </span>
          </div>
        </>
      ) : (
        <div className={`mt-4 flex items-center justify-center gap-2.5 text-3xl font-extrabold tracking-wide sm:text-5xl ${style.text}`}>
          <StatusDot tone={style.tone} className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          {t(`label.${signal.label}`)}
        </div>
      )}

      <div
        className="mx-auto mt-2 max-w-md text-xs text-slate-500"
        title={t('edge.explainer', { window: windowLabel(edge?.window ?? '7d'), min: 55, minN: 100 })}
      >
        <span className={edge?.status === 'proven' ? 'text-bull' : edge?.status === 'inverse' ? 'text-bear' : 'text-slate-400'}>
          {t(edgeStatusKey)}
        </span>
        {edge && edge.rate !== null && edge.lowerBound !== null ? (
          <span>
            {' · '}
            {t('edge.detail', {
              rate: (edge.rate * 100).toFixed(0),
              lb: (edge.lowerBound * 100).toFixed(0),
              n: edge.n,
              window: windowLabel(edge.window),
            })}
          </span>
        ) : edge ? (
          <span>
            {' · '}
            {t('edge.detailShort', { n: edge.n, window: windowLabel(edge.window) })}
          </span>
        ) : null}
      </div>

      <div className="mt-3 text-lg text-slate-300">
        <span className="text-sm uppercase tracking-wide text-slate-500">{t('signal.modelConfidence')}</span>{' '}
        <span className="font-mono font-semibold tabular-nums">{signal.confidence}%</span>
      </div>
      <div className="mt-1 text-sm uppercase tracking-widest text-slate-500">
        {t('signal.horizonSignal', {
          h: t(`horizon.${signal.horizon}`),
          score: `${signal.finalScore > 0 ? '+' : ''}${signal.finalScore}`,
        })}
        {signal.rawLabel !== signal.label && (
          <span className="mx-2 normal-case tracking-normal text-slate-600" title={t('signal.rawTooltip')}>
            {t('signal.raw', { label: t(`label.${signal.rawLabel}`) })}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {signal.limitedHistory && (
          <span
            className="inline-block rounded-full border border-flat/40 bg-flat/10 px-3 py-1 text-xs font-semibold text-flat"
            title={signal.historyNote ? translateDynamic(signal.historyNote, lang) : undefined}
          >
            {t('signal.limitedHistory')}
          </span>
        )}
        <span className="inline-block rounded-full border border-border bg-surface px-3 py-1 text-xs text-slate-400">
          {t('signal.regime', { r: t(`regime.${signal.regime}` as TranslationKey) })}
        </span>
      </div>

      <div className="mx-auto mt-4 max-w-md rounded-xl border border-border bg-surface/60 p-3 text-start text-xs text-slate-300">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {t('conformal.title')} · {t(`horizon.${signal.horizon}`)}
        </div>
        {conf ? (
          <>
            {/* No font-mono here: it forces the whole element (and thus the sentence) LTR,
                scrambling Hebrew bidi order — only the numeric substitutions are LTR-isolated (pct()). */}
            <div className="mt-1">{t('conformal.line80', { lo: pct(conf.lo80), hi: pct(conf.hi80) })}</div>
            <div className="text-slate-400">{t('conformal.line50', { lo: pct(conf.lo50), hi: pct(conf.hi50) })}</div>
          </>
        ) : (
          <div className="mt-1 text-slate-500">{t('conformal.na')}</div>
        )}
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('similar.title')}</div>
        {sim && sim.n > 0 && sim.upRate !== null ? (
          <div className="mt-1">
            {t('similar.line', {
              // LRM-prefixed: bucket keys like "-25..-10" / "≤-25" have a leading sign that
              // would otherwise render mirrored (e.g. "10-..25-") inside RTL text.
              bucket: `‎${sim.bucket}`,
              rate: (sim.upRate * 100).toFixed(0),
              lo: ((sim.lowerBound ?? 0) * 100).toFixed(0),
              hi: ((sim.upperBound ?? 1) * 100).toFixed(0),
              n: sim.n,
            })}
          </div>
        ) : (
          <div className="mt-1 text-slate-500">{t('similar.na')}</div>
        )}
      </div>

      <div className="mt-4 text-xs text-slate-500">{t('signal.updated', { ago: timeAgo(signal.timestamp, lang) })}</div>

      <div className="mt-6 border-t border-border pt-5 text-start">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">{t('signal.why')}</div>
        <ul className="mt-2 space-y-1.5">
          {signal.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-sm text-slate-200">
              <span className="text-slate-500">·</span>
              {translateDynamic(r, lang)}
            </li>
          ))}
        </ul>
        <div className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-400">{t('signal.risks')}</div>
        <ul className="mt-2 space-y-1.5">
          {signal.risks.map((r) => (
            <li key={r} className="flex gap-2 text-sm text-slate-400">
              <span className="text-bear/70">!</span>
              {translateDynamic(r, lang)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
