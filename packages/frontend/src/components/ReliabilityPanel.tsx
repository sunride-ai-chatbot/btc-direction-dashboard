import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { useApi } from '../lib/api';
import type { EdgeStats, HorizonReliability, ReliabilityReport } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';

const STATUS_CLS: Record<string, string> = {
  proven: 'bg-bull/10 text-bull',
  unproven: 'bg-flat/10 text-flat',
  inverse: 'bg-bear/10 text-bear',
  insufficient: 'bg-slate-500/10 text-slate-400',
};

function p(v: number | null, digits = 0): string {
  return v === null ? '—' : `${(v * 100).toFixed(digits)}%`;
}

function EdgeBlock({ title, e }: { title: string; e: EdgeStats }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-300">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_CLS[e.status]}`}>
          {t(`edge.status.${e.status}` as TranslationKey)}
        </span>
      </div>
      <div className="mt-1.5 flex justify-between text-slate-400">
        <span>{t('rel.signAgreement')}</span>
        <span className="font-mono text-slate-200">{p(e.rate, 1)}</span>
      </div>
      <div className="flex justify-between text-slate-400">
        <span>{t('rel.bounds')}</span>
        <span className="font-mono">
          {p(e.lowerBound, 1)} – {p(e.upperBound, 1)}
        </span>
      </div>
      <div className="flex justify-between text-slate-400">
        <span>n</span>
        <span className="font-mono">{e.n}</span>
      </div>
    </div>
  );
}

function HorizonCard({ r }: { r: HorizonReliability }) {
  const { t } = useI18n();
  const tooltipStyle = { background: '#121826', border: '1px solid #1e2636', borderRadius: 8, fontSize: 11 } as const;
  const daily = r.drift.daily.map((d) => ({ day: d.day.slice(5), rate: d.rate === null ? null : +(d.rate * 100).toFixed(1), lower: d.lower === null ? null : +(d.lower * 100).toFixed(1), upper: d.upper === null ? null : +(d.upper * 100).toFixed(1), n: d.n }));

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-bold">{t(`horizon.${r.horizon}` as TranslationKey)}</span>
        <span className={`text-xs font-semibold ${r.drift.alarm ? 'text-bear' : 'text-slate-500'}`}>
          {r.drift.alarm ? t('rel.driftAlarm') : t('rel.driftOk')}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EdgeBlock title={t('rel.edge7d')} e={r.edge7d} />
        <EdgeBlock title={t('rel.edgeAll')} e={r.edgeAll} />
      </div>

      {daily.length > 1 && (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('rel.daily')}</div>
          <div className="chart-ltr">
            <ResponsiveContainer width="100%" height={140}>
              <ComposedChart data={daily}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} width={32} />
                <Tooltip contentStyle={tooltipStyle} />
                <ReferenceLine y={50} stroke="#475569" strokeDasharray="4 4" />
                <ReferenceLine y={55} stroke="#22c55e" strokeDasharray="2 4" strokeOpacity={0.6} />
                <Line type="monotone" dataKey="lower" stroke="#334155" dot={false} strokeWidth={1} connectNulls />
                <Line type="monotone" dataKey="upper" stroke="#334155" dot={false} strokeWidth={1} connectNulls />
                <Line type="monotone" dataKey="rate" stroke="#38bdf8" dot={{ r: 2 }} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('rel.byRegime')}</div>
          <table className="mt-1 w-full">
            <tbody>
              {r.byRegime
                .filter((x) => x.n > 0)
                .map((x) => (
                  <tr key={x.regime} className="border-t border-border">
                    <td className="py-1 text-left">{t(`regime.${x.regime}` as TranslationKey)}</td>
                    <td className="py-1 text-right font-mono">n={x.n}</td>
                    <td className="py-1 text-right font-mono">{p(x.rate, 1)}</td>
                    <td className="py-1 text-right font-mono text-slate-500">
                      {p(x.lower)}–{p(x.upper)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-1 text-slate-400">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('rel.scoreDist')}</div>
          <div className="flex justify-between">
            <span>{t('rel.p50')}</span>
            <span className="font-mono">{r.scoreDistribution.p50Abs?.toFixed(1) ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('rel.p90')}</span>
            <span className="font-mono">{r.scoreDistribution.p90Abs?.toFixed(1) ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('rel.directionalCalls')}</span>
            <span className="font-mono">{r.scoreDistribution.directionalCallPct ?? '—'}%</span>
          </div>
          <div className="flex justify-between">
            <span>{t('rel.flatRate')}</span>
            <span className="font-mono">{r.scoreDistribution.flatRatePct ?? '—'}%</span>
          </div>

          <div className="pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('rel.band')}</div>
          <div className="flex justify-between">
            <span>{t('rel.bandNow', { pct: r.band.currentPct })}</span>
            <span className="font-mono">{t(`band.${r.band.method}` as TranslationKey)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('rel.bandFixed', { pct: r.band.fixedPct })}</span>
            <span className="font-mono">{r.band.sigmaPct !== null ? t('rel.bandSigma', { s: r.band.sigmaPct.toFixed(2) }) : '—'}</span>
          </div>
          <div className="text-slate-500">{t('rel.bandAdaptiveShare', { pct: r.band.adaptiveRowsPct ?? 0 })}</div>

          <div className="pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('rel.conformal')}</div>
          {r.conformal.available ? (
            <>
              <div className="font-mono">{t('rel.coverage', { c: r.conformal.coverage80 === null ? '—' : (r.conformal.coverage80 * 100).toFixed(0), n: r.conformal.coverageN })}</div>
              <div className="font-mono text-slate-500">{t('rel.halfWidth', { w: r.conformal.halfWidth80AtZero?.toFixed(2) ?? '—', b: r.conformal.baselineHalfWidth80?.toFixed(2) ?? '—' })}</div>
            </>
          ) : (
            <div className="text-slate-500">{t('rel.conformalNa')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReliabilityPanel() {
  const { t } = useI18n();
  const { data } = useApi<ReliabilityReport>('/api/reliability', 120_000);
  if (!data) return <div className="mt-8 text-center text-slate-500">{t('rel.loading')}</div>;
  return (
    <div className="mt-8">
      <h3 className="text-lg font-bold">{t('rel.title')}</h3>
      <p className="mt-1 text-sm text-slate-400">{t('rel.explainer')}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.horizons.map((r) => (
          <HorizonCard key={r.horizon} r={r} />
        ))}
      </div>
    </div>
  );
}
