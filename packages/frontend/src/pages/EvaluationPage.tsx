import { useApi } from '../lib/api';
import type { EvaluationReport } from '../lib/types';

function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

export function EvaluationPage() {
  const { data } = useApi<{ reports: EvaluationReport[] }>('/api/evaluation', 120_000);

  if (!data) return <div className="mt-24 text-center text-slate-500">Loading evaluation…</div>;

  const hasData = data.reports.some((r) => r.totalEvaluated > 0);

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="text-xl font-bold">Model evaluation</h2>
      <p className="mt-1 text-sm text-slate-400">
        Each stored signal is compared against the actual BTC price after its horizon elapsed. The model is
        <span className="font-semibold text-slate-300"> not</span> being optimized against this data yet — this page
        exists to measure whether it works in the real world first.
      </p>

      {!hasData && (
        <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center text-slate-400">
          No signals are old enough to evaluate yet. Come back after the app has been collecting for at least an hour
          (72h signals need three days).
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.reports.map((r) => (
          <div key={r.horizon} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg font-bold">{r.horizon.toUpperCase()}</span>
              <span className="text-xs text-slate-500">{r.totalEvaluated} signals evaluated</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-400">Directional accuracy</dt>
              <dd className="text-right font-mono font-semibold">{pct(r.directionalAccuracy)}</dd>
              <dt className="text-slate-400">Bullish accuracy</dt>
              <dd className="text-right font-mono text-bull">{pct(r.bullishAccuracy)}</dd>
              <dt className="text-slate-400">Bearish accuracy</dt>
              <dd className="text-right font-mono text-bear">{pct(r.bearishAccuracy)}</dd>
              <dt className="text-slate-400">Neutral accuracy</dt>
              <dd className="text-right font-mono text-flat">{pct(r.neutralAccuracy)}</dd>
              <dt className="text-slate-400">Avg return after signal</dt>
              <dd className="text-right font-mono">{r.avgReturnAfterSignal === null ? '—' : `${r.avgReturnAfterSignal.toFixed(2)}%`}</dd>
            </dl>
            <div className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">By confidence bucket</div>
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
          </div>
        ))}
      </div>
    </div>
  );
}
