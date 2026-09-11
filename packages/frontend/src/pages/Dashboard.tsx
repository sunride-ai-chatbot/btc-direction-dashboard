import { lazy, Suspense, useState } from 'react';
import { useApi } from '../lib/api';
import { HORIZONS, type Horizon, type SignalBundle, type AlertRow, type DivergencePerformance } from '../lib/types';
import { SignalCard } from '../components/SignalCard';
import { ComponentCard } from '../components/ComponentCard';
import { OrderFlowPanel } from '../components/OrderFlowPanel';
import { DerivativesStrip } from '../components/DerivativesStrip';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';
import { Skeleton } from '../components/ui';
import { IconPlug } from '../components/icons';

// The chart engine is the heaviest thing on this page — load it after the first paint.
const LiveChart = lazy(() => import('../components/LiveChart').then((m) => ({ default: m.LiveChart })));

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

  if (error && !bundle) {
    return (
      <div className="glass mx-auto mt-20 max-w-md animate-fade-in-up rounded-2xl border-bear/30 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bear/10 text-bear">
          <IconPlug className="h-6 w-6" />
        </div>
        <div className="font-display text-lg font-semibold text-slate-200">{t('dash.backendDown')}</div>
        <div className="mt-2 text-sm text-slate-400">
          {t('dash.backendDownHint', { cmd: '' })}
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">npm run dev</code>
        </div>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-[520px] w-full rounded-2xl lg:col-span-2" />
          <Skeleton className="h-[520px] w-full rounded-2xl" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
  const chartTone = signal.gated ? 'neutral' : signal.label === 'BULLISH' ? 'bull' : signal.label === 'BEARISH' ? 'bear' : 'flat';

  return (
    <div className="mx-auto max-w-[1400px]">
      {recentDivergences.length > 0 && (
        <div className="glass mb-4 rounded-2xl border-sky-400/40 p-4">
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

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="glass animate-fade-in-up rounded-2xl p-3 sm:p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">{t('chart.title')}</h2>
              <div className="text-[11px] text-slate-500">{t('chart.subtitle')}</div>
            </div>
            <div className="flex gap-1.5" role="group" aria-label={t('dash.horizonPicker')}>
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  aria-pressed={h === horizon}
                  onClick={() => setHorizon(h)}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 font-mono text-xs font-semibold tabular-nums transition-all duration-150 ${
                    h === horizon ? 'bg-accent text-white shadow-glow-accent' : 'bg-card/70 text-slate-400 ring-1 ring-border hover:bg-card-hover hover:text-slate-200'
                  }`}
                >
                  {t(`horizon.${h}`)}
                </button>
              ))}
            </div>
          </div>
          <Suspense fallback={<Skeleton className="h-[440px] w-full rounded-xl" />}>
            <LiveChart horizon={horizon} conformal={signal.conformal} tone={chartTone} />
          </Suspense>
        </section>
        <SignalCard signal={signal} />
      </div>

      {unackedAlerts.length > 0 && (
        <div className="glass mt-4 animate-fade-in-up rounded-2xl border-flat/30 p-4">
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

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <OrderFlowPanel fallback={null} />
        <DerivativesStrip />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
