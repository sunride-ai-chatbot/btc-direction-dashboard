import { useApi, apiUrl } from '../lib/api';
import type { AttributionReport, DivergencePerformance, EvaluationReportPayload, HorizonEvaluationReport } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';
import { ReliabilityPanel } from '../components/ReliabilityPanel';
import { EmptyState, Skeleton } from '../components/ui';
import { IconInbox, IconWarning } from '../components/icons';

function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

function ret(v: number | null): string {
  return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

const COMPONENT_KEY: Record<string, TranslationKey> = {
  polymarket: 'comp.polymarket',
  technical: 'comp.technical',
  etf: 'comp.etf',
  macro: 'comp.macro',
  liquidity: 'comp.liquidity',
  'btc-direct': 'cat.btc-direct',
  fed: 'cat.fed',
  inflation: 'cat.inflation',
  geopolitical: 'cat.geopolitical',
};

function ReportCard({ r }: { r: HorizonEvaluationReport }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-bold">
          {r.horizon === 'overall' ? t('eval.overall') : t(`horizon.${r.horizon}` as TranslationKey)}
        </span>
        <span className={`text-xs font-semibold tabular-nums ${r.reliable ? 'text-slate-500' : 'text-flat'}`}>
          {t('eval.n', { n: r.totalEvaluated })} {!r.reliable && t('eval.unreliable')}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-slate-400">{t('eval.directionalAccuracy')}</dt>
        <dd className="text-right font-mono font-semibold tabular-nums">{pct(r.directionalAccuracy)}</dd>
        <dt className="pt-0.5 text-xs text-slate-500">{t('eval.rawAccuracy')}</dt>
        <dd className="pt-0.5 text-right font-mono text-xs tabular-nums text-slate-500">{pct(r.rawDirectionalAccuracy)}</dd>
        <dt className="text-slate-400">{t('eval.bullishAccuracy')}</dt>
        <dd className="text-right font-mono tabular-nums text-bull">{pct(r.bullishAccuracy)}</dd>
        <dt className="text-slate-400">{t('eval.bearishAccuracy')}</dt>
        <dd className="text-right font-mono tabular-nums text-bear">{pct(r.bearishAccuracy)}</dd>
        <dt className="text-slate-400">{t('eval.neutralAccuracy')}</dt>
        <dd className="text-right font-mono tabular-nums text-flat">{pct(r.neutralAccuracy)}</dd>
        <dt className="text-slate-400">{t('eval.avgReturnBullish')}</dt>
        <dd className="text-right font-mono tabular-nums">{ret(r.avgReturnAfterBullish)}</dd>
        <dt className="text-slate-400">{t('eval.avgReturnBearish')}</dt>
        <dd className="text-right font-mono tabular-nums">{ret(r.avgReturnAfterBearish)}</dd>
      </dl>

      <div className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">{t('eval.winRate')}</div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 text-left">{t('eval.confidence')}</th>
            <th className="py-1 text-right">N</th>
            <th className="py-1 text-right">{t('eval.accuracy')}</th>
            <th className="py-1 text-right">{t('eval.avgReturn')}</th>
          </tr>
        </thead>
        <tbody>
          {r.byConfidenceBucket.map((b) => (
            <tr key={b.bucket} className="border-t border-border">
              <td className="py-1 text-left font-mono">{b.bucket}</td>
              <td className="py-1 text-right font-mono">{b.total}</td>
              <td className="py-1 text-right font-mono">{pct(b.accuracy)}</td>
              <td className="py-1 text-right font-mono">{b.avgReturn === null ? '—' : `${b.avgReturn.toFixed(2)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.bySession.some((s) => s.total > 0) && (
        <>
          <div className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">{t('eval.bySession')}</div>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {r.bySession
                .filter((s) => s.total > 0)
                .map((s) => (
                  <tr key={s.session} className="border-t border-border">
                    <td className="py-1 text-left">{t(`session.${s.session}` as TranslationKey)}</td>
                    <td className="py-1 text-right font-mono">n={s.total}</td>
                    <td className="py-1 text-right font-mono">{pct(s.accuracy)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function AttributionTable({ title, rows }: { title: string; rows: AttributionReport['components'] }) {
  const { t } = useI18n();
  const withData = rows.filter((r) => r.samples > 0);
  if (withData.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="text-sm font-semibold">{title}</div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 text-left">{t('eval.input')}</th>
            <th className="py-1 text-right">N</th>
            <th className="py-1 text-right" title={t('eval.dirAgreementTooltip')}>
              {t('eval.dirAgreement')}
            </th>
            <th className="py-1 text-right">{t('eval.avgScoreCorrect')}</th>
            <th className="py-1 text-right">{t('eval.avgScoreWrong')}</th>
          </tr>
        </thead>
        <tbody>
          {withData.map((c) => (
            <tr key={c.component} className="border-t border-border">
              <td className="py-1 text-left font-medium">
                {COMPONENT_KEY[c.component] ? t(COMPONENT_KEY[c.component]) : c.component}
              </td>
              <td className="py-1 text-right font-mono">{c.samples}</td>
              <td className="py-1 text-right font-mono">{pct(c.directionAgreementPct)}</td>
              <td className="py-1 text-right font-mono">{c.avgScoreWhenCorrect?.toFixed(1) ?? '—'}</td>
              <td className="py-1 text-right font-mono">{c.avgScoreWhenIncorrect?.toFixed(1) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EvaluationPage() {
  const { t, lang } = useI18n();
  const { data } = useApi<EvaluationReportPayload>('/api/evaluation', 120_000);
  const { data: attribution } = useApi<AttributionReport>('/api/attribution', 120_000);
  const { data: divergences } = useApi<DivergencePerformance>('/api/divergences', 120_000);

  if (!data)
    return (
      <div className="mx-auto max-w-5xl">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-3 h-16 w-full rounded-xl" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <span className="sr-only" role="status">
          {t('eval.loading')}
        </span>
      </div>
    );

  const hasData = data.overall.totalEvaluated > 0;

  return (
    <div className="mx-auto max-w-5xl animate-fade-in-up">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">{t('eval.title')}</h2>
        <div className="flex gap-3 text-xs">
          <a className="text-slate-400 underline decoration-slate-600 underline-offset-2 transition-colors duration-150 hover:text-slate-200" href={apiUrl('/api/export/evaluations.csv')}>
            evaluations.csv
          </a>
          <a className="text-slate-400 underline decoration-slate-600 underline-offset-2 transition-colors duration-150 hover:text-slate-200" href={apiUrl('/api/export/signals.csv')}>
            signals.csv
          </a>
        </div>
      </div>

      <div className="mt-3 flex gap-3 rounded-xl border border-flat/40 bg-flat/5 p-4 text-sm text-flat">
        <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t('eval.warning', { min: data.minReliableSamples, n: data.overall.totalEvaluated })}</span>
      </div>

      {hasData && <ReliabilityPanel />}

      {!hasData ? (
        <EmptyState icon={<IconInbox />} title={t('eval.empty')} className="mt-6" />
      ) : (
        <>
          <div className="mt-6">
            <ReportCard r={data.overall} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.horizons.map((r) => (
              <ReportCard key={r.horizon} r={r} />
            ))}
          </div>
        </>
      )}

      {attribution && attribution.totalEvaluated > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold">{t('eval.attribution')}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {t('eval.attributionNote', { small: attribution.reliable ? '' : t('eval.attributionSmall') })}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AttributionTable title={t('eval.components')} rows={attribution.components} />
            <AttributionTable title={t('eval.subcategories')} rows={attribution.polymarketCategories} />
          </div>
        </div>
      )}

      {divergences && divergences.events.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold">{t('eval.divTitle')}</h3>
          <p className="mt-1 text-sm text-slate-400">{t('eval.divNote')}</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {divergences.summary
              .filter((s) => s.total > 0)
              .map((s) => (
                <div key={s.kind} className="rounded-xl border border-border bg-card p-4 text-sm shadow-card">
                  <div className="font-semibold">{s.kind === 'bullish-divergence' ? t('eval.divBullish') : t('eval.divBearish')}</div>
                  <div className="mt-1 tabular-nums text-slate-400">
                    {t('eval.divStats', { total: s.total, resolved: s.resolved, pct: pct(s.agreementPct) })}
                  </div>
                </div>
              ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {divergences.events.slice(0, 8).map((e) => (
              <li key={e.id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-slate-300 transition-colors duration-150 hover:bg-card-hover">
                {translateDynamic(e.message, lang)}
                <span className="mx-2 tabular-nums text-slate-500">
                  → 4h: {ret(e.outcome4h)} · 24h: {ret(e.outcome24h)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
