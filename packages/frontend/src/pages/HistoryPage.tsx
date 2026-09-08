import { useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, Area,
} from 'recharts';
import { useApi, israelTime } from '../lib/api';
import { HORIZONS, type Horizon, type HistoryRow } from '../lib/types';
import { useI18n } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';

export function HistoryPage() {
  const [horizon, setHorizon] = useState<Horizon>('24h');
  const { t, lang } = useI18n();
  const { data } = useApi<{ rows: HistoryRow[] }>(`/api/history?horizon=${horizon}&limit=500`, 60_000);

  const rows = [...(data?.rows ?? [])].reverse();
  const chartData = rows.map((r) => ({
    ts: r.ts,
    time: israelTime(r.ts, lang),
    score: r.final_score,
    confidence: r.confidence,
    price: r.btc_price,
  }));

  const tooltipStyle = { background: '#121826', border: '1px solid #1e2636', borderRadius: 8, fontSize: 12 } as const;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{t('hist.title')}</h2>
        <div className="flex gap-1.5">
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`rounded px-3 py-1 font-mono text-xs font-semibold ${
                h === horizon ? 'bg-slate-200 text-surface' : 'bg-card text-slate-400 ring-1 ring-border'
              }`}
            >
              {t(`horizon.${h}`)}
            </button>
          ))}
        </div>
      </div>

      {chartData.length < 2 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center text-slate-400">{t('hist.empty')}</div>
      ) : (
        <>
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-widest text-slate-500">{t('hist.scoreChart')}</div>
            <div className="chart-ltr">
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={60} />
                  <YAxis domain={[-100, 100]} tick={{ fontSize: 10, fill: '#64748b' }} width={36} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                  <ReferenceLine y={25} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <ReferenceLine y={-25} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <ReferenceLine y={0} stroke="#334155" />
                  <Area type="monotone" dataKey="score" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.12} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-widest text-slate-500">{t('hist.priceChart')}</div>
              <div className="chart-ltr">
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={chartData}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={60} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} width={56} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="price" stroke="#f59e0b" dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-widest text-slate-500">{t('hist.confChart')}</div>
              <div className="chart-ltr">
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={chartData}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={60} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} width={36} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="confidence" stroke="#a78bfa" dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-card text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">{t('hist.time')}</th>
                  <th className="px-3 py-2 text-left">{t('hist.label')}</th>
                  <th className="px-3 py-2 text-right">{t('hist.score')}</th>
                  <th className="px-3 py-2 text-right">{t('hist.conf')}</th>
                  <th className="px-3 py-2 text-right">BTC</th>
                  <th className="px-3 py-2 text-left">{t('hist.topReason')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...rows].reverse().slice(0, 40).map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400">{israelTime(r.ts, lang)}</td>
                    <td
                      className={`px-3 py-2 text-left font-semibold ${
                        r.label === 'BULLISH' ? 'text-bull' : r.label === 'BEARISH' ? 'text-bear' : 'text-flat'
                      }`}
                    >
                      {t(`label.${r.label}`)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.final_score.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.confidence}%</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {r.btc_price ? `$${Math.round(r.btc_price).toLocaleString()}` : '—'}
                    </td>
                    <td className="max-w-sm truncate px-3 py-2 text-left text-xs text-slate-400">
                      {r.reasons[0] ? translateDynamic(r.reasons[0], lang) : ''}
                    </td>
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
