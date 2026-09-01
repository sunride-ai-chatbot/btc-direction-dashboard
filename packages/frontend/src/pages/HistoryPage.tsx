import { useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, Area,
} from 'recharts';
import { useApi, israelTime } from '../lib/api';
import { HORIZONS, type Horizon, type HistoryRow } from '../lib/types';

export function HistoryPage() {
  const [horizon, setHorizon] = useState<Horizon>('24h');
  const { data } = useApi<{ rows: HistoryRow[] }>(`/api/history?horizon=${horizon}&limit=500`, 60_000);

  const rows = [...(data?.rows ?? [])].reverse();
  const chartData = rows.map((r) => ({
    ts: r.ts,
    time: israelTime(r.ts),
    score: r.final_score,
    confidence: r.confidence,
    price: r.btc_price,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Signal history</h2>
        <div className="flex gap-1.5">
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`rounded px-3 py-1 font-mono text-xs font-semibold ${
                h === horizon ? 'bg-slate-200 text-surface' : 'bg-card text-slate-400 ring-1 ring-border'
              }`}
            >
              {h.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {chartData.length < 2 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center text-slate-400">
          Not enough history yet. Signals are persisted every 5 minutes — leave the backend running.
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-widest text-slate-500">Final score (−100 … +100)</div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData}>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={60} />
                <YAxis domain={[-100, 100]} tick={{ fontSize: 10, fill: '#64748b' }} width={36} />
                <Tooltip
                  contentStyle={{ background: '#121826', border: '1px solid #1e2636', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <ReferenceLine y={25} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
                <ReferenceLine y={-25} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} />
                <ReferenceLine y={0} stroke="#334155" />
                <Area type="monotone" dataKey="score" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.12} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-widest text-slate-500">BTC price</div>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={chartData}>
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={60} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} width={56} />
                  <Tooltip contentStyle={{ background: '#121826', border: '1px solid #1e2636', borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="price" stroke="#f59e0b" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-widest text-slate-500">Confidence</div>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={chartData}>
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} width={36} />
                  <Tooltip contentStyle={{ background: '#121826', border: '1px solid #1e2636', borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="confidence" stroke="#a78bfa" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-card text-left text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2">Time (IL)</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Conf</th>
                  <th className="px-3 py-2 text-right">BTC</th>
                  <th className="px-3 py-2">Top reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...rows].reverse().slice(0, 40).map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400">{israelTime(r.ts)}</td>
                    <td
                      className={`px-3 py-2 font-semibold ${
                        r.label === 'BULLISH' ? 'text-bull' : r.label === 'BEARISH' ? 'text-bear' : 'text-flat'
                      }`}
                    >
                      {r.label}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.final_score.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.confidence}%</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {r.btc_price ? `$${Math.round(r.btc_price).toLocaleString()}` : '—'}
                    </td>
                    <td className="max-w-sm truncate px-3 py-2 text-xs text-slate-400">{r.reasons[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
