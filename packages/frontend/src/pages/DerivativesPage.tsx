import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { useApi, formatUsd, timeAgo, israelTime } from '../lib/api';
import type { DerivativesPayload, DerivativesVenue } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { Badge, EmptyState, Skeleton, StatusDot, type Tone } from '../components/ui';
import { IconInbox } from '../components/icons';

// Proper names, not translated (same rule as "Polymarket"/"Binance" elsewhere).
const VENUE_NAME: Record<DerivativesVenue, string> = {
  'kraken-futures': 'Kraken Futures',
  deribit: 'Deribit',
  bitmex: 'BitMEX',
  bybit: 'Bybit',
  okx: 'OKX',
};

// Crowded longs are a downside-squeeze risk (bearish read) and vice versa — the tone
// follows the RISK the positioning implies, so it lines up with the rest of the app.
const POSITIONING_TONE: Record<DerivativesPayload['positioning']['state'], Tone> = {
  'long-crowded': 'bear',
  'short-crowded': 'bull',
  balanced: 'flat',
  unknown: 'neutral',
};

// LRM-prefixed like every other signed number embedded in RTL prose (see SignalCard.pct()).
function signedPct(v: number | null, digits = 4): string {
  return v === null ? '—' : `‎${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fundingTone(v: number | null): string {
  if (v === null) return 'text-slate-400';
  return v > 0.03 ? 'text-bear text-glow-bear' : v < -0.01 ? 'text-bull text-glow-bull' : 'text-slate-100';
}

export function DerivativesPage() {
  const { t, lang } = useI18n();
  const { data, error } = useApi<DerivativesPayload>('/api/derivatives', 60_000);

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl">
        {error ? (
          <EmptyState icon={<IconInbox />} title={t('deriv.unavailable')} className="mt-16" />
        ) : (
          <>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="mt-4 h-28 w-full rounded-xl" />
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
            </div>
            <span className="sr-only" role="status">
              {t('deriv.loading')}
            </span>
          </>
        )}
      </div>
    );
  }

  const tooltipStyle = { background: '#121826', border: '1px solid #1e2636', borderRadius: 8, fontSize: 11 } as const;
  const series = data.history.map((p) => ({ ...p, time: israelTime(p.ts, lang), oiB: p.openInterestUsd === null ? null : +(p.openInterestUsd / 1e9).toFixed(3) }));
  const liq = data.liquidations;
  const liqTotal = liq ? liq.longUsd + liq.shortUsd : 0;
  const positioningTone = POSITIONING_TONE[data.positioning.state];

  return (
    <div className="mx-auto max-w-5xl animate-fade-in-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('deriv.title')}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {t('deriv.source', { venues: data.venues.map((v) => VENUE_NAME[v.venue]).join(' · ') || '—' })} · {t('signal.updated', { ago: timeAgo(data.timestamp, lang) })}
            {data.freshness === 'stale' && <Badge tone="flat" className="ms-2">{t('fresh.stale')}</Badge>}
          </p>
        </div>
        <Badge tone="info">{t('deriv.trackingOnly')}</Badge>
      </div>

      {!data.available ? (
        <EmptyState icon={<IconInbox />} title={t('deriv.empty')} className="mt-6" />
      ) : (
        <>
          <section className={`mt-4 rounded-xl border border-border bg-card p-5 shadow-card ${positioningTone === 'bull' ? 'signal-ring-bull' : positioningTone === 'bear' ? 'signal-ring-bear' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500">{t('deriv.positioning')}</div>
                <div className={`mt-1 flex items-center gap-2.5 text-2xl font-extrabold ${positioningTone === 'bull' ? 'text-bull text-glow-bull' : positioningTone === 'bear' ? 'text-bear text-glow-bear' : positioningTone === 'flat' ? 'text-flat' : 'text-slate-300'}`}>
                  <StatusDot tone={positioningTone} className="h-3 w-3" />
                  {t(`deriv.positioning.${data.positioning.state}` as TranslationKey)}
                </div>
              </div>
              <div className="text-end">
                <div className="text-xs uppercase tracking-widest text-slate-500">{t('deriv.funding')}</div>
                <div className={`mt-1 font-mono text-3xl font-bold tabular-nums ${fundingTone(data.fundingRate8hPct)}`}>{signedPct(data.fundingRate8hPct)}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-400">{t(`deriv.positioningNote.${data.positioning.state}` as TranslationKey)}</p>
            <p className="mt-2 text-xs text-slate-500">{t('deriv.explainer')}</p>
          </section>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4 shadow-card">
              <div className="text-xs uppercase tracking-widest text-slate-500">{t('deriv.funding')}</div>
              <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${fundingTone(data.fundingRate8hPct)}`}>{signedPct(data.fundingRate8hPct)}</div>
              <dl className="mt-2 space-y-0.5 text-xs text-slate-400">
                <div className="flex justify-between"><dt>{t('deriv.annualized')}</dt><dd className="font-mono tabular-nums">{signedPct(data.fundingAnnualizedPct, 1)}</dd></div>
                <div className="flex justify-between"><dt>{t('deriv.avg24h')}</dt><dd className="font-mono tabular-nums">{signedPct(data.fundingAvg24hPct)}</dd></div>
                <div className="flex justify-between"><dt>{t('deriv.spread')}</dt><dd className="font-mono tabular-nums">{data.fundingSpreadPct === null ? '—' : `${data.fundingSpreadPct.toFixed(4)}%`}</dd></div>
              </dl>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-card">
              <div className="text-xs uppercase tracking-widest text-slate-500">{t('deriv.openInterest')}</div>
              <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-100">{data.openInterestUsd === null ? '—' : formatUsd(data.openInterestUsd, true)}</div>
              <dl className="mt-2 space-y-0.5 text-xs text-slate-400">
                <div className="flex justify-between"><dt>BTC</dt><dd className="font-mono tabular-nums">{data.openInterestBtc === null ? '—' : `₿${Math.round(data.openInterestBtc).toLocaleString('en-US')}`}</dd></div>
                <div className="flex justify-between"><dt>{t('deriv.oiVenues', { n: data.venues.filter((v) => v.openInterestUsd !== null).length })}</dt><dd /></div>
                <div className="flex justify-between">
                  <dt>{t('deriv.oiChange')}</dt>
                  <dd className={`font-mono tabular-nums ${data.oiChange24hPct === null ? 'text-slate-500' : data.oiChange24hPct > 0 ? 'text-bull' : data.oiChange24hPct < 0 ? 'text-bear' : ''}`}>
                    {data.oiChange24hPct === null ? t('deriv.oiChangeNa') : signedPct(data.oiChange24hPct, 2)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-card">
              <div className="text-xs uppercase tracking-widest text-slate-500">{t('deriv.liquidations', { m: liq?.windowMinutes ?? 60 })}</div>
              {liq ? (
                <>
                  <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-100">{formatUsd(liqTotal, true)}</div>
                  <div className="chart-ltr mt-2 flex h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                    <div className="bg-bear shadow-glow-bear" style={{ width: `${liqTotal > 0 ? (liq.longUsd / liqTotal) * 100 : 50}%` }} />
                    <div className="bg-bull shadow-glow-bull" style={{ width: `${liqTotal > 0 ? (liq.shortUsd / liqTotal) * 100 : 50}%` }} />
                  </div>
                  <dl className="mt-2 space-y-0.5 text-xs text-slate-400">
                    <div className="flex justify-between"><dt className="text-bear">{t('deriv.longs')}</dt><dd className="font-mono tabular-nums">{formatUsd(liq.longUsd, true)}</dd></div>
                    <div className="flex justify-between"><dt className="text-bull">{t('deriv.shorts')}</dt><dd className="font-mono tabular-nums">{formatUsd(liq.shortUsd, true)}</dd></div>
                    <div className="text-slate-500">{t('deriv.liqCount', { n: liq.count, venues: liq.venues.map((v) => VENUE_NAME[v as DerivativesVenue] ?? v).join(', ') })}</div>
                  </dl>
                </>
              ) : (
                <div className="mt-2 text-sm text-slate-500">{t('deriv.liqNa')}</div>
              )}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-border shadow-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-card text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">{t('deriv.venue')}</th>
                  <th className="px-3 py-2 text-right">{t('deriv.funding')}</th>
                  <th className="px-3 py-2 text-right">{t('deriv.predicted')}</th>
                  <th className="px-3 py-2 text-right">{t('deriv.openInterest')}</th>
                  <th className="px-3 py-2 text-right">{t('deriv.mark')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.venues.map((v) => (
                  <tr key={v.venue} className="transition-colors duration-150 hover:bg-card-hover">
                    <td className="px-4 py-2 text-left font-medium text-slate-200">{VENUE_NAME[v.venue]}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${fundingTone(v.fundingRate8hPct)}`}>{signedPct(v.fundingRate8hPct)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{signedPct(v.predictedFundingRate8hPct)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{v.openInterestUsd === null ? '—' : formatUsd(v.openInterestUsd, true)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{v.markPrice === null ? '—' : formatUsd(v.markPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {series.length >= 2 && (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs uppercase tracking-widest text-slate-500">{t('deriv.fundingChart')} · {t('deriv.history')}</div>
                <div className="chart-ltr chart-glow-flat">
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={series}>
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={50} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={64} tickFormatter={(v: number) => `${v.toFixed(4)}%`} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <ReferenceLine y={0} stroke="#334155" />
                      <ReferenceLine y={0.01} stroke="#475569" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="fundingRate8hPct" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs uppercase tracking-widest text-slate-500">{t('deriv.oiChart')} · {t('deriv.history')}</div>
                <div className="chart-ltr chart-glow-info">
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={series}>
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={50} />
                      <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} width={56} tickFormatter={(v: number) => `$${v.toFixed(2)}B`} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="oiB" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.12} strokeWidth={2} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
