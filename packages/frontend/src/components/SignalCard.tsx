import { useEffect, useState } from 'react';
import type { HorizonSignal } from '../lib/types';
import { timeAgo, type LiveStreamState } from '../lib/api';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';

const LABEL_STYLE: Record<string, { emoji: string; text: string; ring: string }> = {
  BULLISH: { emoji: '🟢', text: 'text-bull', ring: 'ring-bull/30' },
  NEUTRAL: { emoji: '🟡', text: 'text-flat', ring: 'ring-flat/30' },
  BEARISH: { emoji: '🔴', text: 'text-bear', ring: 'ring-bear/30' },
};

const GATED_STYLE = { emoji: '⚪', text: 'text-slate-300', ring: 'ring-slate-500/30' };

const LIVE_FRESH_MS = 20_000;

function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function pct(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

export function SignalCard({ signal, live }: { signal: HorizonSignal; live?: LiveStreamState }) {
  const { t, lang } = useI18n();
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  const tick = live?.tick ?? null;
  const streamFresh = !!live?.connected && tick !== null && tick.price !== null && Date.now() - tick.ts < LIVE_FRESH_MS;
  const price = streamFresh ? tick!.price! : signal.btcPrice;

  useEffect(() => {
    if (!live?.lastMove || !streamFresh) return;
    setFlash(live.lastMove);
    const id = window.setTimeout(() => setFlash(null), 450);
    return () => window.clearTimeout(id);
  }, [tick?.price, live?.lastMove, streamFresh]);

  const style = signal.gated ? GATED_STYLE : LABEL_STYLE[signal.label];
  const edge = signal.edge;
  const edgeStatusKey = `edge.status.${edge?.status ?? 'insufficient'}` as TranslationKey;
  // "7d" inside a Hebrew sentence would render mirrored; spell the window out per language.
  const windowLabel = (w: string) => (lang === 'he' ? w.replace(/^(\d+)d$/, '$1 ימים') : w);
  const conf = signal.conformal;
  const sim = signal.similarStates;

  return (
    <div className={`rounded-2xl bg-card ring-1 ${style.ring} p-8 text-center shadow-xl`}>
      <div className="flex items-center justify-center gap-2 text-sm uppercase tracking-widest text-slate-400">
        <span>BTC</span>
        {live && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              streamFresh ? 'bg-bull/10 text-bull' : 'bg-slate-500/10 text-slate-500'
            }`}
            title={
              streamFresh && tick
                ? t('live.tooltip', { n: tick.freshExchanges, spread: (tick.spreadPct ?? 0).toFixed(2) })
                : undefined
            }
          >
            <span className={`h-1.5 w-1.5 rounded-full ${streamFresh ? 'animate-pulse bg-bull' : 'bg-slate-500'}`} />
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
        className={`mt-1 font-mono text-4xl font-bold transition-colors duration-300 sm:text-5xl ${
          flash === 'up' ? 'text-bull' : flash === 'down' ? 'text-bear' : ''
        }`}
      >
        {price !== null ? fmtUsd(price) : '—'}
      </div>
      {streamFresh && tick && (
        <div className="mt-1 font-mono text-[11px] text-slate-500">
          {t('live.exchanges', {
            b: tick.exchanges.binance ? fmtUsd(tick.exchanges.binance.price) : '—',
            c: tick.exchanges.coinbase ? fmtUsd(tick.exchanges.coinbase.price) : '—',
            k: tick.exchanges.kraken ? fmtUsd(tick.exchanges.kraken.price) : '—',
          })}
        </div>
      )}

      {signal.gated ? (
        <>
          <div className={`mt-4 text-3xl font-extrabold tracking-wide sm:text-4xl ${style.text}`}>
            {style.emoji} {t('edge.noProvenEdge')}
          </div>
          <div className="mt-2 text-sm text-slate-400">
            {t('edge.modelLean', { label: t(`label.${signal.label}`) })}{' '}
            <span className="font-mono">
              ({signal.finalScore > 0 ? '+' : ''}
              {signal.finalScore})
            </span>
          </div>
        </>
      ) : (
        <div className={`mt-4 text-4xl font-extrabold tracking-wide sm:text-5xl ${style.text}`}>
          {style.emoji} {t(`label.${signal.label}`)}
        </div>
      )}

      <div
        className="mx-auto mt-2 max-w-md text-xs text-slate-500"
        title={t('edge.explainer', { window: edge?.window ?? '7d', min: 55, minN: 100 })}
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
        <span className="font-mono font-semibold">{signal.confidence}%</span>
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
            <div className="mt-1 font-mono">{t('conformal.line80', { lo: pct(conf.lo80), hi: pct(conf.hi80) })}</div>
            <div className="font-mono text-slate-400">{t('conformal.line50', { lo: pct(conf.lo50), hi: pct(conf.hi50) })}</div>
          </>
        ) : (
          <div className="mt-1 text-slate-500">{t('conformal.na')}</div>
        )}
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('similar.title')}</div>
        {sim && sim.n > 0 && sim.upRate !== null ? (
          <div className="mt-1">
            {t('similar.line', {
              bucket: sim.bucket,
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
