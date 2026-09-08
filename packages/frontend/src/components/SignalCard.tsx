import type { HorizonSignal } from '../lib/types';
import { timeAgo } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';

const LABEL_STYLE: Record<string, { emoji: string; text: string; ring: string }> = {
  BULLISH: { emoji: '🟢', text: 'text-bull', ring: 'ring-bull/30' },
  NEUTRAL: { emoji: '🟡', text: 'text-flat', ring: 'ring-flat/30' },
  BEARISH: { emoji: '🔴', text: 'text-bear', ring: 'ring-bear/30' },
};

export function SignalCard({ signal }: { signal: HorizonSignal }) {
  const { t, lang } = useI18n();
  const style = LABEL_STYLE[signal.label];
  return (
    <div className={`rounded-2xl bg-card ring-1 ${style.ring} p-8 text-center shadow-xl`}>
      <div className="text-sm uppercase tracking-widest text-slate-400">BTC</div>
      <div className="mt-1 font-mono text-4xl font-bold sm:text-5xl">
        {signal.btcPrice !== null
          ? signal.btcPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
          : '—'}
      </div>
      <div className={`mt-4 text-4xl font-extrabold tracking-wide sm:text-5xl ${style.text}`}>
        {style.emoji} {t(`label.${signal.label}`)}
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
      {signal.limitedHistory && (
        <div
          className="mx-auto mt-3 inline-block rounded-full border border-flat/40 bg-flat/10 px-3 py-1 text-xs font-semibold text-flat"
          title={signal.historyNote ? translateDynamic(signal.historyNote, lang) : undefined}
        >
          {t('signal.limitedHistory')}
        </div>
      )}
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
