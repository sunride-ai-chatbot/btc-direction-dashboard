import { useApi, timeAgo, apiUrl } from '../lib/api';
import type { HealthPayload } from '../lib/types';

const STATUS_STYLE: Record<string, string> = {
  LIVE: 'bg-bull/10 text-bull',
  DAILY: 'bg-sky-400/10 text-sky-400',
  DEGRADED: 'bg-flat/10 text-flat',
  STALE: 'bg-flat/10 text-flat',
  DOWN: 'bg-bear/10 text-bear',
  UNAVAILABLE: 'bg-bear/10 text-bear',
};

const PROVIDER_LABELS: Record<string, string> = {
  polymarket: 'Polymarket',
  'btc-price': 'BTC Price',
  macro: 'Macro (FRED)',
  etf: 'ETF Flows',
};

export function HealthPage() {
  const { data } = useApi<HealthPayload>('/api/health', 30_000);

  if (!data) return <div className="mt-24 text-center text-slate-500">Loading system health…</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-xl font-bold">System health</h2>
      <p className="mt-1 text-sm text-slate-400">
        Missing or stale sources automatically reduce signal confidence. Failure counters reset when the backend
        restarts (up {timeAgo(data.processStartTs)}).
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.providers.map((p) => (
          <div key={p.name} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{PROVIDER_LABELS[p.name] ?? p.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[p.status] ?? 'bg-slate-500/10 text-slate-400'}`}>
                {p.status}
              </span>
            </div>
            <dl className="mt-3 space-y-1 text-xs text-slate-400">
              <div className="flex justify-between">
                <dt>Last successful update</dt>
                <dd className="font-mono">{p.lastSuccessTs ? timeAgo(p.lastSuccessTs) : 'never (this process)'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Latency</dt>
                <dd className="font-mono">{p.lastLatencyMs !== null ? `${p.lastLatencyMs}ms` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Consecutive failures</dt>
                <dd className={`font-mono ${p.consecutiveFailures > 0 ? 'text-flat' : ''}`}>{p.consecutiveFailures}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Total failures</dt>
                <dd className="font-mono">{p.totalFailures}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Freshness</dt>
                <dd className="font-mono">{p.freshness}</dd>
              </div>
            </dl>
            {p.note && <div className="mt-2 truncate text-[11px] text-slate-500" title={p.note}>{p.note}</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-4 text-xs text-slate-400">
        <div className="flex justify-between">
          <span>Evaluations stored</span>
          <span className="font-mono">{data.evaluationsStored}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>Evaluator cadence</span>
          <span className="font-mono">every {Math.round(data.evaluationJobMs / 60_000)}m</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>Neutral bands (1h/4h/24h/72h)</span>
          <span className="font-mono">
            ±{data.neutralThresholdsPct['1h']}% / ±{data.neutralThresholdsPct['4h']}% / ±{data.neutralThresholdsPct['24h']}% / ±{data.neutralThresholdsPct['72h']}%
          </span>
        </div>
        <div className="mt-2 text-slate-500">
          Export raw data:{' '}
          <a className="underline underline-offset-2 hover:text-slate-300" href={apiUrl("/api/export/signals.csv")}>signals.csv</a> ·{' '}
          <a className="underline underline-offset-2 hover:text-slate-300" href={apiUrl("/api/export/evaluations.csv")}>evaluations.csv</a> ·{' '}
          <a className="underline underline-offset-2 hover:text-slate-300" href={apiUrl("/api/export/polymarket_snapshots.csv")}>polymarket_snapshots.csv</a>
        </div>
      </div>
    </div>
  );
}
