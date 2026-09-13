import type { HorizonSignal } from '../lib/types';
import { timeAgo } from '../lib/api';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';
import { StatusDot, type Tone } from './ui';
import { InfoIcon } from '@phosphor-icons/react';

const LABEL_STYLE: Record<string, { tone: Tone; text: string; ring: string }> = {
  BULLISH: { tone: 'bull', text: 'text-bull text-glow-bull', ring: 'ring-bull/30 signal-ring-bull' },
  NEUTRAL: { tone: 'flat', text: 'text-flat text-glow-flat', ring: 'ring-flat/30 signal-ring-flat' },
  BEARISH: { tone: 'bear', text: 'text-bear text-glow-bear', ring: 'ring-bear/30 signal-ring-bear' },
};

const GATED_STYLE = { tone: 'neutral' as Tone, text: 'text-slate-200', ring: 'ring-slate-500/30' };

// LRM (U+200E) keeps the signed number resolving left-to-right when embedded in an
// RTL sentence — without it a leading '-' (or '≤') visually detaches from its digits
// (see dynamicHe.ts, which uses the same prefix for the same reason).
function pct(v: number): string {
  return `‎${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** The signal HUD: label, edge gate, confidence, ranges, reasons. Price and stream live in the ticker bar. */
export function SignalCard({ signal }: { signal: HorizonSignal }) {
  const { t, lang } = useI18n();
  const style = signal.gated ? GATED_STYLE : LABEL_STYLE[signal.label];
  const edge = signal.edge;
  const edgeStatusKey = `edge.status.${edge?.status ?? 'insufficient'}` as TranslationKey;
  // "7d" inside a Hebrew sentence would render mirrored; spell the window out per language.
  const windowLabel = (w: string) => (lang === 'he' ? w.replace(/^(\d+)d$/, '$1 ימים') : w);
  const conf = signal.conformal;
  const sim = signal.similarStates;
  const shadow = signal.horizon === '1h' ? signal.context?.hourlyShadow : null;

  return (
    <section className={`glass animate-fade-in-up rounded-2xl ring-1 ${style.ring} flex flex-col p-5 text-center`}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {t('signal.horizonSignal', { h: t(`horizon.${signal.horizon}`), score: `${signal.finalScore > 0 ? '+' : ''}${signal.finalScore}` })}
      </div>

      {signal.gated ? (
        <>
          <div className={`mt-3 flex items-center justify-center gap-2.5 font-display text-2xl font-bold tracking-wide ${style.text}`}>
            <StatusDot tone={style.tone} className="h-3 w-3" />
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
        <div className={`mt-3 flex items-center justify-center gap-2.5 font-display text-3xl font-bold tracking-wide ${style.text}`}>
          <StatusDot tone={style.tone} className="h-3.5 w-3.5" />
          {t(`label.${signal.label}`)}
        </div>
      )}

      <div className="mx-auto mt-2 max-w-xs text-xs text-slate-500" title={t('edge.explainer', { window: windowLabel(edge?.window ?? '7d'), min: 55, minN: 100 })}>
        <span className={edge?.status === 'proven' ? 'text-bull' : edge?.status === 'inverse' ? 'text-bear' : 'text-slate-400'}>{t(edgeStatusKey)}</span>
        {edge && edge.rate !== null && edge.lowerBound !== null ? (
          <span>
            {' · '}
            {t('edge.detail', { rate: (edge.rate * 100).toFixed(0), lb: (edge.lowerBound * 100).toFixed(0), n: edge.n, window: windowLabel(edge.window) })}
          </span>
        ) : edge ? (
          <span>
            {' · '}
            {t('edge.detailShort', { n: edge.n, window: windowLabel(edge.window) })}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface/60 p-3">
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-widest text-slate-500">
            {t('signal.modelConfidence')}
            <span className="cursor-help text-slate-500 hover:text-slate-300" title={t('signal.confidenceExplainer')} aria-label={t('signal.confidenceExplainer')}>
              <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-100">{signal.confidence}%</div>
          <div className="mx-auto mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <div className="h-full rounded-full bg-accent shadow-glow-accent-sm transition-all duration-500" style={{ width: `${signal.confidence}%` }} />
          </div>
        </div>
        <div className="rounded-xl bg-surface/60 p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">{t('signal.regimeLabel')}</div>
          <div className="mt-1 font-display text-base font-semibold text-slate-100">{t(`regime.${signal.regime}` as TranslationKey)}</div>
          {signal.rawLabel !== signal.label && (
            <div className="mt-1 text-[10px] text-slate-500" title={t('signal.rawTooltip')}>
              {t('signal.raw', { label: t(`label.${signal.rawLabel}`) })}
            </div>
          )}
        </div>
      </div>

      {signal.limitedHistory && (
        <span className="mx-auto mt-3 inline-block rounded-full border border-flat/40 bg-flat/10 px-3 py-1 text-xs font-semibold text-flat" title={signal.historyNote ? translateDynamic(signal.historyNote, lang) : undefined}>
          {t('signal.limitedHistory')}
        </span>
      )}

      {shadow && (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-3 text-start text-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">{t('shadow.title')}</div>
              <div className="mt-1 text-slate-400">{t('shadow.explainer')}</div>
            </div>
            <div className={`font-mono text-xl font-bold tabular-nums ${shadow.score > 5 ? 'text-bull' : shadow.score < -5 ? 'text-bear' : 'text-flat'}`}>
              {shadow.score > 0 ? '+' : ''}{shadow.score}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-border/60 bg-surface/50 p-3 text-start text-xs text-slate-300">
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

      <div className="mt-4 border-t border-border/60 pt-4 text-start">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t('signal.why')}</div>
        <ul className="mt-2 space-y-1.5">
          {signal.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-sm text-slate-200">
              <span className="text-slate-500">·</span>
              {translateDynamic(r, lang)}
            </li>
          ))}
        </ul>
        <div className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t('signal.risks')}</div>
        <ul className="mt-2 space-y-1.5">
          {signal.risks.map((r) => (
            <li key={r} className="flex gap-2 text-sm text-slate-400">
              <span className="text-bear/70">!</span>
              {translateDynamic(r, lang)}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-4 text-xs text-slate-500">{t('signal.updated', { ago: timeAgo(signal.timestamp, lang) })}</div>
    </section>
  );
}
