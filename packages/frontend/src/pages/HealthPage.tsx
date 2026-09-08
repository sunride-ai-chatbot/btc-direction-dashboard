import { useApi, timeAgo, apiUrl } from '../lib/api';
import type { HealthPayload } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';

const STATUS_STYLE: Record<string, string> = {
  LIVE: 'bg-bull/10 text-bull',
  DAILY: 'bg-sky-400/10 text-sky-400',
  DEGRADED: 'bg-flat/10 text-flat',
  STALE: 'bg-flat/10 text-flat',
  DOWN: 'bg-bear/10 text-bear',
  UNAVAILABLE: 'bg-bear/10 text-bear',
};

export function HealthPage() {
  const { t, lang } = useI18n();
  const { data } = useApi<HealthPayload>('/api/health', 30_000);

  if (!data) return <div className="mt-24 text-center text-slate-500">{t('health.loading')}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-xl font-bold">{t('health.title')}</h2>
      <p className="mt-1 text-sm text-slate-400">{t('health.explainer', { ago: timeAgo(data.processStartTs, lang) })}</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.providers.map((p) => (
          <div key={p.name} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t(`health.provider.${p.name}` as TranslationKey)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[p.status] ?? 'bg-slate-500/10 text-slate-400'}`}>
                {t(`status.${p.status}` as TranslationKey)}
              </span>
            </div>
            <dl className="mt-3 space-y-1 text-xs text-slate-400">
              <div className="flex justify-between">
                <dt>{t('health.lastSuccess')}</dt>
                <dd className="font-mono">{p.lastSuccessTs ? timeAgo(p.lastSuccessTs, lang) : t('health.never')}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('health.latency')}</dt>
                <dd className="font-mono">{p.lastLatencyMs !== null ? `${p.lastLatencyMs}ms` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('health.consecutiveFailures')}</dt>
                <dd className={`font-mono ${p.consecutiveFailures > 0 ? 'text-flat' : ''}`}>{p.consecutiveFailures}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('health.totalFailures')}</dt>
                <dd className="font-mono">{p.totalFailures}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('health.freshness')}</dt>
                <dd className="font-mono">{t(`fresh.${p.freshness}` as TranslationKey)}</dd>
              </div>
            </dl>
            {p.note && <div className="chart-ltr mt-2 truncate text-[11px] text-slate-500" title={p.note}>{p.note}</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-4 text-xs text-slate-400">
        <div className="flex justify-between">
          <span>{t('health.evaluationsStored')}</span>
          <span className="font-mono">{data.evaluationsStored}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>{t('health.cadence')}</span>
          <span className="font-mono">{t('health.everyMin', { m: Math.round(data.evaluationJobMs / 60_000) })}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>{t('health.neutralBands')}</span>
          <span className="font-mono">
            ±{data.neutralThresholdsPct['1h']}% / ±{data.neutralThresholdsPct['4h']}% / ±{data.neutralThresholdsPct['24h']}% / ±{data.neutralThresholdsPct['72h']}%
          </span>
        </div>
        <div className="mt-2 text-slate-500">
          {t('health.export')}{' '}
          <a className="underline underline-offset-2 hover:text-slate-300" href={apiUrl('/api/export/signals.csv')}>signals.csv</a> ·{' '}
          <a className="underline underline-offset-2 hover:text-slate-300" href={apiUrl('/api/export/evaluations.csv')}>evaluations.csv</a> ·{' '}
          <a className="underline underline-offset-2 hover:text-slate-300" href={apiUrl('/api/export/polymarket_snapshots.csv')}>polymarket_snapshots.csv</a>
        </div>
      </div>
    </div>
  );
}
