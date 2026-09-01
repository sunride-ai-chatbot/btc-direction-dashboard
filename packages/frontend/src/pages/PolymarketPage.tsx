import { useApi, formatUsd, timeAgo } from '../lib/api';
import type { PolymarketSnapshot } from '../lib/types';

function pp(change: number | null): string {
  if (change === null) return '—';
  const v = change * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}pp`;
}

function changeCls(change: number | null, direction: 1 | -1): string {
  if (change === null || Math.abs(change) < 0.001) return 'text-slate-500';
  return change * direction > 0 ? 'text-bull' : 'text-bear';
}

export function PolymarketPage() {
  const { data: snapshot } = useApi<PolymarketSnapshot>('/api/polymarket', 60_000);

  if (!snapshot) return <div className="mt-24 text-center text-slate-500">Loading Polymarket data…</div>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold">Polymarket — BTC-relevant markets</h2>
        <span className="text-xs text-slate-500">
          {snapshot.freshness} · {timeAgo(snapshot.timestamp)}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Sorted by relevance × liquidity. Probability moves marked when unusually large (≥3pp/24h).
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3">Market</th>
              <th className="px-3 py-3 text-right">Prob</th>
              <th className="px-3 py-3 text-right">Δ1h</th>
              <th className="px-3 py-3 text-right">Δ24h</th>
              <th className="px-3 py-3 text-right">Volume</th>
              <th className="px-3 py-3 text-right">Liquidity</th>
              <th className="px-3 py-3 text-right">Relevance</th>
              <th className="px-3 py-3">Signal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {snapshot.markets.map((m) => {
              const unusual = m.probChange24h !== null && Math.abs(m.probChange24h) >= 0.03;
              const impliedSignal =
                m.probChange24h === null
                  ? '—'
                  : m.probChange24h * m.bullishDirection > 0.005
                    ? 'bullish'
                    : m.probChange24h * m.bullishDirection < -0.005
                      ? 'bearish'
                      : 'flat';
              return (
                <tr key={m.id} className={unusual ? 'bg-flat/5' : undefined}>
                  <td className="max-w-xs px-4 py-3">
                    <div className="truncate font-medium text-slate-200" title={m.title}>
                      {m.title}
                    </div>
                    <div className="text-[10px] uppercase text-slate-500">{m.category}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{(m.probability * 100).toFixed(0)}%</td>
                  <td className={`px-3 py-3 text-right font-mono ${changeCls(m.probChange1h, m.bullishDirection)}`}>
                    {pp(m.probChange1h)}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono ${changeCls(m.probChange24h, m.bullishDirection)}`}>
                    {pp(m.probChange24h)}
                    {unusual && <span className="ml-1 text-flat">●</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{formatUsd(m.volume, true)}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{formatUsd(m.liquidity, true)}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{m.relevanceScore.toFixed(2)}</td>
                  <td
                    className={`px-3 py-3 font-medium ${
                      impliedSignal === 'bullish' ? 'text-bull' : impliedSignal === 'bearish' ? 'text-bear' : 'text-slate-500'
                    }`}
                  >
                    {impliedSignal}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {snapshot.markets.length === 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center text-slate-400">
          No relevant markets discovered yet — check back after the next refresh.
        </div>
      )}
    </div>
  );
}
