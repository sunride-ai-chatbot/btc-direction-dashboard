import { useState } from 'react';
import { useApi } from '../lib/api';
import { HORIZONS, type Horizon, type SignalBundle, type AlertRow, type DivergencePerformance } from '../lib/types';
import { SignalCard } from '../components/SignalCard';
import { ComponentCard } from '../components/ComponentCard';

const COMPONENT_LABELS: Array<{ key: keyof SignalBundle['signals']['24h']['components']; label: string }> = [
  { key: 'polymarket', label: 'Polymarket' },
  { key: 'technical', label: 'BTC Technicals' },
  { key: 'etf', label: 'ETF Flows' },
  { key: 'macro', label: 'Macro' },
  { key: 'liquidity', label: 'Liquidity / Session' },
];

export function Dashboard() {
  const [horizon, setHorizon] = useState<Horizon>('24h');
  const { data: bundle, error } = useApi<SignalBundle>('/api/signal', 30_000);
  const { data: alertData } = useApi<{ alerts: AlertRow[] }>('/api/alerts', 60_000);
  const { data: divergenceData } = useApi<DivergencePerformance>('/api/divergences', 120_000);

  if (error && !bundle) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <div className="text-lg font-semibold text-slate-200">Backend not reachable</div>
        <div className="mt-2 text-sm text-slate-400">
          Start it with <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">npm run dev</code> — retrying automatically.
        </div>
      </div>
    );
  }
  if (!bundle) {
    return <div className="mt-24 text-center text-slate-500">Loading signals…</div>;
  }

  const signal = bundle.signals[horizon];
  const unackedAlerts = (alertData?.alerts ?? []).filter((a) => !a.acknowledged).slice(0, 5);
  const recentDivergences = (divergenceData?.events ?? []).filter((e) => Date.now() - e.ts < 24 * 3_600_000).slice(0, 2);

  return (
    <div className="mx-auto max-w-3xl">
      {recentDivergences.length > 0 && (
        <div className="mb-4 rounded-xl border border-sky-400/40 bg-sky-400/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-sky-400">
            Polymarket / price divergence detected
          </div>
          <ul className="mt-1.5 space-y-1">
            {recentDivergences.map((d) => (
              <li key={d.id} className="text-sm text-slate-300">
                {d.message}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 text-xs text-slate-500">
            Informational only — divergences are tracked for performance, they do not move the score yet.
          </div>
        </div>
      )}
      <SignalCard signal={signal} />

      <div className="mt-6 flex justify-center gap-2">
        {HORIZONS.map((h) => (
          <button
            key={h}
            onClick={() => setHorizon(h)}
            className={`rounded-lg px-5 py-2 font-mono text-sm font-semibold transition ${
              h === horizon
                ? 'bg-slate-200 text-surface'
                : 'bg-card text-slate-400 ring-1 ring-border hover:text-slate-200'
            }`}
          >
            {h.toUpperCase()}
          </button>
        ))}
      </div>

      {unackedAlerts.length > 0 && (
        <div className="mt-6 rounded-xl border border-flat/30 bg-flat/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-flat">Recent alerts</div>
          <ul className="mt-2 space-y-1">
            {unackedAlerts.map((a) => (
              <li key={a.id} className="text-sm text-slate-300">
                {a.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COMPONENT_LABELS.map(({ key, label }) => (
          <ComponentCard
            key={key}
            name={label}
            comp={signal.components[key]}
            weightPct={Math.round(signal.components[key].weight * 100)}
          />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-slate-600">
        This tool analyzes market signals and does not constitute financial advice.
      </p>
    </div>
  );
}
