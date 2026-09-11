import { NavLink } from 'react-router-dom';
import { useApi, formatUsd } from '../lib/api';
import { useI18n, type TranslationKey } from '../lib/i18n';
import type { DerivativesPayload } from '../lib/types';
import { Badge, Skeleton, StatusDot, type Tone } from './ui';
import { IconExternalLink } from './icons';

const TONE: Record<DerivativesPayload['positioning']['state'], Tone> = { 'long-crowded': 'bear', 'short-crowded': 'bull', balanced: 'flat', unknown: 'neutral' };

/** Compact positioning read for the dashboard; the full page has venues, history and liquidations. */
export function DerivativesStrip() {
  const { t } = useI18n();
  const { data } = useApi<DerivativesPayload>('/api/derivatives', 120_000);

  return (
    <section className="glass rounded-2xl p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-semibold text-slate-100">{t('nav.derivatives')}</h3>
        <Badge tone="info">{t('deriv.trackingOnly')}</Badge>
      </div>
      {!data ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : !data.available ? (
        <div className="mt-3 text-sm text-slate-500">{t('deriv.empty')}</div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <StatusDot tone={TONE[data.positioning.state]} className="h-2.5 w-2.5" />
            <span className={`font-display text-lg font-bold ${TONE[data.positioning.state] === 'bull' ? 'text-bull' : TONE[data.positioning.state] === 'bear' ? 'text-bear' : TONE[data.positioning.state] === 'flat' ? 'text-flat' : 'text-slate-300'}`}>
              {t(`deriv.positioning.${data.positioning.state}` as TranslationKey)}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500">{t('deriv.funding')}</dt>
              <dd className="mt-0.5 text-slate-100">{data.fundingRate8hPct === null ? '—' : `‎${data.fundingRate8hPct > 0 ? '+' : ''}${data.fundingRate8hPct.toFixed(4)}%`}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500">OI</dt>
              <dd className="mt-0.5 text-slate-100">{data.openInterestUsd === null ? '—' : formatUsd(data.openInterestUsd, true)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500">{t('deriv.liqShort')}</dt>
              <dd className="mt-0.5">
                {data.liquidations ? (
                  <>
                    <span className="text-bear">{formatUsd(data.liquidations.longUsd, true)}</span>
                    <span className="text-slate-600"> / </span>
                    <span className="text-bull">{formatUsd(data.liquidations.shortUsd, true)}</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          <NavLink to="/derivatives" className="mt-3 inline-flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent-hover">
            {t('deriv.viewAll')}
            <IconExternalLink className="h-3 w-3" />
          </NavLink>
        </>
      )}
    </section>
  );
}
