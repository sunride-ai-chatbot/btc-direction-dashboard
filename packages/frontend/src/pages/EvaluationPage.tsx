import { useApi, apiUrl } from '../lib/api';
import type { AttributionReport, DivergencePerformance, EvaluationReportPayload, HorizonEvaluationReport } from '../lib/types';

function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

function ret(v: number | null): string {
  return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function ReportCard({ r }: { r: HorizonEvaluationReport }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-bold">{r.horizon === 'overall' ? 'OVERALL' : r.horizon.toUpperCase()}</span>
        <span className={`text-xs font-semibold ${r.reliable ? 'text-slate-500' : 'text-flat'}`}>
          n = {r.totalEvaluated}
          {!r.reliable && ' · unreliable'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-slate-400">Directional accuracy</dt>
        <dd className="text-right font-mono font-semibold">{pct(r.directionalAccuracy)}</dd>
        <dt className="text-slate-500 text-xs pt-0.5">…without hysteresis (raw)</dt>
        <dd className="text-right font-mono text-xs text-slate-500 pt-0.5">{pct(r.rawDirectionalAccuracy)}</dd>
        <dt className="text-slate-400">Bullish accuracy</dt>
        <dd className="text-right font-mono text-bull">{pct(r.bullishAccuracy)}</dd>
        <dt className="text-slate-400">Bearish accuracy</dt>
        <dd className="text-right font-mono text-bear">{pct(r.bearishAccuracy)}</dd>
        <dt className="text-slate-400">Neutral accuracy</dt>
        <dd className="text-right font-mono text-flat">{pct(r.neutralAccuracy)}</dd>
        <dt className="text-slate-400">Avg return after bullish</dt>
        <dd className="text-right font-mono">{ret(r.avgReturnAfterBullish)}</dd>
        <dt className="text-slate-400">Avg return after bearish</dt>
        <dd className="text-right font-mono">{ret(r.avgReturnAfterBearish)}</dd>
      </dl>

      <div className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
        Win rate by model confidence
      </div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1">Confidence</th>
            <th className="py-1 text-right">N</th>
            <th className="py-1 text-right">Accuracy</th>
            <th className="py-1 text-right">Avg return</th>
          </tr>
        </thead>
        <tbody>
          {r.byConfidenceBucket.map((b) => (
            <tr key={b.bucket} className="border-t border-border">
              <td className="py-1 font-mono">{b.bucket}</td>
              <td className="py-1 text-right font-mono">{b.total}</td>
              <td className="py-1 text-right font-mono">{pct(b.accuracy)}</td>
              <td className="py-1 text-right font-mono">{b.avgReturn === null ? '—' : `${b.avgReturn.toFixed(2)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.bySession.some((s) => s.total > 0) && (
        <>
          <div className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">By market session</div>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {r.bySession
                .filter((s) => s.total > 0)
                .map((s) => (
                  <tr key={s.session} className="border-t border-border">
                    <td className="py-1">{s.session}</td>
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
  const withData = rows.filter((r) => r.samples > 0);
  if (withData.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-sm font-semibold">{title}</div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1">Input</th>
            <th className="py-1 text-right">N</th>
            <th className="py-1 text-right" title="How often this input's direction matched what BTC actually did">
              Direction agreement
            </th>
            <th className="py-1 text-right">Avg score (correct)</th>
            <th className="py-1 text-right">Avg score (wrong)</th>
          </tr>
        </thead>
        <tbody>
          {withData.map((c) => (
            <tr key={c.component} className="border-t border-border">
              <td className="py-1 font-medium">{c.component}</td>
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
  const { data } = useApi<EvaluationReportPayload>('/api/evaluation', 120_000);
  const { data: attribution } = useApi<AttributionReport>('/api/attribution', 120_000);
  const { data: divergences } = useApi<DivergencePerformance>('/api/divergences', 120_000);

  if (!data) return <div className="mt-24 text-center text-slate-500">Loading evaluation…</div>;

  const hasData = data.overall.totalEvaluated > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">Model evaluation</h2>
        <div className="flex gap-3 text-xs">
          <a className="text-slate-400 underline underline-offset-2 hover:text-slate-200" href={apiUrl("/api/export/evaluations.csv")}>
            evaluations.csv
          </a>
          <a className="text-slate-400 underline underline-offset-2 hover:text-slate-200" href={apiUrl("/api/export/signals.csv")}>
            signals.csv
          </a>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-flat/40 bg-flat/5 p-4 text-sm text-flat">
        ⚠ Model performance is statistically unreliable until sufficient historical signals have been collected
        (≥{data.minReliableSamples} per horizon). Current sample:{' '}
        <span className="font-mono font-bold">{data.overall.totalEvaluated} evaluated signals</span>. Confidence shown
        everywhere is <span className="font-semibold">model confidence</span>, not the probability of BTC rising — this
        page exists to test whether higher confidence actually corresponds to higher accuracy before any calibration.
      </div>

      {!hasData ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center text-slate-400">
          No signals are old enough to evaluate yet. The evaluator runs automatically every few minutes; 1h signals
          become evaluable an hour after they are stored (72h signals after three days).
        </div>
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
          <h3 className="text-lg font-bold">Component attribution</h3>
          <p className="mt-1 text-sm text-slate-400">
            When predictions were correct, which inputs were most useful? Measurement only — weights are not being
            adjusted from this data{attribution.reliable ? '' : ' (sample still too small to act on)'}.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AttributionTable title="Signal components" rows={attribution.components} />
            <AttributionTable title="Polymarket subcategories" rows={attribution.polymarketCategories} />
          </div>
        </div>
      )}

      {divergences && divergences.events.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold">Polymarket / price divergences</h3>
          <p className="mt-1 text-sm text-slate-400">
            Detected divergence events and what BTC actually did afterwards. These do not move the score yet.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {divergences.summary
              .filter((s) => s.total > 0)
              .map((s) => (
                <div key={s.kind} className="rounded-xl border border-border bg-card p-4 text-sm">
                  <div className="font-semibold">{s.kind === 'bullish-divergence' ? '↑ Bullish divergences' : '↓ Bearish divergences'}</div>
                  <div className="mt-1 text-slate-400">
                    {s.total} detected · {s.resolved} resolved · agreement {pct(s.agreementPct)}
                  </div>
                </div>
              ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {divergences.events.slice(0, 8).map((e) => (
              <li key={e.id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-slate-300">
                {e.message}
                <span className="ml-2 text-slate-500">
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
