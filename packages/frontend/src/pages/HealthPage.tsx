import { useApi, timeAgo, apiUrl } from '../lib/api';
import type { HealthPayload } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { Badge, Skeleton, type Tone } from '../components/ui';

const STATUS_TONE: Record<string, Tone> = {
  LIVE: 'bull',
  DAILY: 'info',
  DEGRADED: 'flat',
  STALE: 'flat',
  DOWN: 'bear',
  UNAVAILABLE: 'bear',
};

export function HealthPage() {
  const { t, lang } = useI18n();
  const { data } = useApi<HealthPayload>('/api/health', 30_000);

  if (!data)
    return (
      <div className="mx-auto max-w-3xl">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-3 h-4 w-full max-w-lg" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only" role="status">
          {t('health.loading')}
        </span>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl animate-fade-in-up">
      <h2 className="text-xl font-bold">{t('health.title')}</h2>
      <p className="mt-1 text-sm text-slate-400">{t('health.explainer', { ago: timeAgo(data.processStartTs, lang) })}</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.providers.map((p) => (
          <div key={p.name} className="rounded-xl border border-border bg-card p-4 shadow-card transition-colors duration-150 hover:border-border-strong">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t(`health.provider.${p.name}` as TranslationKey)}</span>
              <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{t(`status.${p.status}` as TranslationKey)}</Badge>
            </div>
            <dl className="mt-3 space-y-1 text-xs text-slate-400">
              <div className="flex justify-between">
                <dt>{t('health.lastSuccess')}</dt>
                <dd className="font-mono tabular-nums">{p.lastSuccessTs ? timeAgo(p.lastSuccessTs, lang) : t('health.never')}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('health.latency')}</dt>
                <dd className="font-mono tabular-nums">{p.lastLatencyMs !== null ? `${p.lastLatencyMs}ms` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('health.consecutiveFailures')}</dt>
                <dd className={`font-mono tabular-nums ${p.consecutiveFailures > 0 ? 'text-flat' : ''}`}>{p.consecutiveFailures}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('health.totalFailures')}</dt>
                <dd className="font-mono tabular-nums">{p.totalFailures}</dd>
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

      <div className="mt-4 rounded-xl border border-border bg-card p-4 text-xs text-slate-400 shadow-card">
        <div className="flex justify-between">
          <span>{t('health.evaluationsStored')}</span>
          <span className="font-mono tabular-nums">{data.evaluationsStored}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>{t('health.cadence')}</span>
          <span className="font-mono tabular-nums">{t('health.everyMin', { m: Math.round(data.evaluationJobMs / 60_000) })}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>{t('health.neutralBands')}</span>
          <span className="font-mono tabular-nums">
            ±{data.neutralThresholdsPct['1h']}% / ±{data.neutralThresholdsPct['4h']}% / ±{data.neutralThresholdsPct['24h']}% / ±{data.neutralThresholdsPct['72h']}%
          </span>
        </div>
        <div className="mt-2 text-slate-500">
          {t('health.export')}{' '}
          <a className="underline decoration-slate-600 underline-offset-2 transition-colors duration-150 hover:text-slate-300" href={apiUrl('/api/export/signals.csv')}>signals.csv</a> ·{' '}
          <a className="underline decoration-slate-600 underline-offset-2 transition-colors duration-150 hover:text-slate-300" href={apiUrl('/api/export/evaluations.csv')}>evaluations.csv</a> ·{' '}
          <a className="underline decoration-slate-600 underline-offset-2 transition-colors duration-150 hover:text-slate-300" href={apiUrl('/api/export/polymarket_snapshots.csv')}>polymarket_snapshots.csv</a>
        </div>
      </div>
    </div>
  );
}
