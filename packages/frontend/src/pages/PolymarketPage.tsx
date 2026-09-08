import { useApi, formatUsd, timeAgo, apiUrl } from '../lib/api';
import type { PolymarketSnapshot } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';

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
  const { t, lang } = useI18n();
  const { data: snapshot } = useApi<PolymarketSnapshot>('/api/polymarket', 60_000);

  if (!snapshot) return <div className="mt-24 text-center text-slate-500">{t('pm.loading')}</div>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">{t('pm.title')}</h2>
        <span className="text-xs text-slate-500">
          {t(`fresh.${snapshot.freshness}` as TranslationKey)} · {timeAgo(snapshot.timestamp, lang)} ·{' '}
          {t('pm.history', { h: Math.floor(snapshot.historyMinutes / 60), m: snapshot.historyMinutes % 60 })} ·{' '}
          <a className="underline underline-offset-2 hover:text-slate-300" href={apiUrl('/api/export/polymarket_snapshots.csv')}>
            {t('pm.csv')}
          </a>
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-400">{t('pm.explainer')}</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-card text-start text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">{t('pm.market')}</th>
              <th className="px-3 py-3 text-right">{t('pm.prob')}</th>
              <th className="px-3 py-3 text-right">{t('pm.d15m')}</th>
              <th className="px-3 py-3 text-right">{t('pm.d1h')}</th>
              <th className="px-3 py-3 text-right">{t('pm.d24h')}</th>
              <th className="px-3 py-3 text-right">{t('pm.volume')}</th>
              <th className="px-3 py-3 text-right">{t('pm.liquidity')}</th>
              <th className="px-3 py-3 text-right" title={t('pm.infoTooltip')}>
                {t('pm.info')}
              </th>
              <th className="px-3 py-3 text-left">{t('pm.signal')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {snapshot.markets.map((m) => {
              const unusual = m.probChange24h !== null && Math.abs(m.probChange24h) >= 0.03;
              const impliedKey: TranslationKey | null =
                m.probChange24h === null
                  ? null
                  : m.probChange24h * m.bullishDirection > 0.005
                    ? 'pm.bullish'
                    : m.probChange24h * m.bullishDirection < -0.005
                      ? 'pm.bearish'
                      : 'pm.flat';
              return (
                <tr key={m.id} className={unusual ? 'bg-flat/5' : undefined}>
                  <td className="max-w-xs px-4 py-3 text-left">
                    <div className="chart-ltr truncate text-left font-medium text-slate-200" title={m.title}>
                      {m.title}
                    </div>
                    <div className="text-[10px] uppercase text-slate-500">{t(`cat.${m.category}` as TranslationKey)}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{(m.probability * 100).toFixed(0)}%</td>
                  <td className={`px-3 py-3 text-right font-mono ${changeCls(m.probChange15m, m.bullishDirection)}`}>
                    {pp(m.probChange15m)}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono ${changeCls(m.probChange1h, m.bullishDirection)}`}>
                    {pp(m.probChange1h)}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono ${changeCls(m.probChange24h, m.bullishDirection)}`}>
                    {pp(m.probChange24h)}
                    {unusual && <span className="mx-1 text-flat">●</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{formatUsd(m.volume, true)}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{formatUsd(m.liquidity, true)}</td>
                  <td
                    className={`px-3 py-3 text-right font-mono ${m.informationValue >= 0.5 ? 'text-slate-200' : m.informationValue >= 0.25 ? 'text-slate-400' : 'text-slate-600'}`}
                    title={m.persistence !== null ? t('pm.persistence', { pct: (m.persistence * 100).toFixed(0) }) : undefined}
                  >
                    {m.informationValue.toFixed(2)}
                  </td>
                  <td
                    className={`px-3 py-3 text-left font-medium ${
                      impliedKey === 'pm.bullish' ? 'text-bull' : impliedKey === 'pm.bearish' ? 'text-bear' : 'text-slate-500'
                    }`}
                  >
                    {impliedKey ? t(impliedKey) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {snapshot.markets.length === 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center text-slate-400">{t('pm.empty')}</div>
      )}
    </div>
  );
}
