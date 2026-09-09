import { useState } from 'react';
import { useApi, useLiveStream } from '../lib/api';
import { HORIZONS, type Horizon, type SignalBundle, type AlertRow, type DivergencePerformance } from '../lib/types';
import { SignalCard } from '../components/SignalCard';
import { ComponentCard } from '../components/ComponentCard';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';
import { Skeleton } from '../components/ui';
import { IconPlug } from '../components/icons';

const COMPONENT_LABELS: Array<{ key: keyof SignalBundle['signals']['24h']['components']; labelKey: TranslationKey }> = [
  { key: 'polymarket', labelKey: 'comp.polymarket' },
  { key: 'technical', labelKey: 'comp.technical' },
  { key: 'etf', labelKey: 'comp.etf' },
  { key: 'macro', labelKey: 'comp.macro' },
  { key: 'liquidity', labelKey: 'comp.liquidity' },
];

export function Dashboard() {
  const [horizon, setHorizon] = useState<Horizon>('24h');
  const { t, lang } = useI18n();
  const { data: bundle, error } = useApi<SignalBundle>('/api/signal', 30_000);
  const { data: alertData } = useApi<{ alerts: AlertRow[] }>('/api/alerts', 60_000);
  const { data: divergenceData } = useApi<DivergencePerformance>('/api/divergences', 120_000);
  const live = useLiveStream();

  if (error && !bundle) {
    return (
      <div className="mx-auto mt-20 max-w-md animate-fade-in-up rounded-xl border border-bear/30 bg-card p-6 text-center shadow-card">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bear/10 text-bear">
          <IconPlug className="h-6 w-6" />
        </div>
        <div className="text-lg font-semibold text-slate-200">{t('dash.backendDown')}</div>
        <div className="mt-2 text-sm text-slate-400">
          {t('dash.backendDownHint', { cmd: '' })}
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">npm run dev</code>
        </div>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div className="mx-auto max-w-3xl">
        <Skeleton className="h-80 w-full rounded-2xl" />
        <div className="mt-6 flex justify-center gap-2">
          <Skeleton className="h-9 w-16 rounded-lg" />
          <Skeleton className="h-9 w-16 rounded-lg" />
          <Skeleton className="h-9 w-16 rounded-lg" />
          <Skeleton className="h-9 w-16 rounded-lg" />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only" role="status">
          {t('dash.loading')}
        </span>
      </div>
    );
  }

  const signal = bundle.signals[horizon];
  const unackedAlerts = (alertData?.alerts ?? []).filter((a) => !a.acknowledged).slice(0, 5);
  const recentDivergences = (divergenceData?.events ?? []).filter((e) => Date.now() - e.ts < 24 * 3_600_000).slice(0, 2);

  return (
    <div className="mx-auto max-w-3xl">
      {recentDivergences.length > 0 && (
        <div className="mb-4 rounded-xl border border-sky-400/40 bg-sky-400/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-sky-400">{t('dash.divergenceTitle')}</div>
          <ul className="mt-1.5 space-y-1">
            {recentDivergences.map((d) => (
              <li key={d.id} className="text-sm text-slate-300">
                {translateDynamic(d.message, lang)}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 text-xs text-slate-500">{t('dash.divergenceNote')}</div>
        </div>
      )}
      <SignalCard signal={signal} live={live} />

      <div className="mt-6 flex flex-wrap justify-center gap-2" role="group" aria-label={t('dash.horizonPicker')}>
        {HORIZONS.map((h) => (
          <button
            key={h}
            aria-pressed={h === horizon}
            onClick={() => setHorizon(h)}
            className={`cursor-pointer rounded-lg px-5 py-2 font-mono text-sm font-semibold tabular-nums transition-colors duration-150 ${
              h === horizon
                ? 'bg-accent text-white'
                : 'bg-card text-slate-400 ring-1 ring-border hover:bg-card-hover hover:text-slate-200'
            }`}
          >
            {t(`horizon.${h}`)}
          </button>
        ))}
      </div>

      {unackedAlerts.length > 0 && (
        <div className="mt-6 animate-fade-in-up rounded-xl border border-flat/30 bg-flat/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-flat">{t('dash.recentAlerts')}</div>
          <ul className="mt-2 space-y-1">
            {unackedAlerts.map((a) => (
              <li key={a.id} className="text-sm text-slate-300">
                {translateDynamic(a.message, lang)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COMPONENT_LABELS.map(({ key, labelKey }, i) => (
          <div key={key} className="animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
            <ComponentCard
              name={t(labelKey)}
              comp={signal.components[key]}
              weightPct={Math.round(signal.components[key].weight * 100)}
              isEtf={key === 'etf'}
            />
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-slate-600">{t('dash.disclaimer')}</p>
    </div>
  );
}
