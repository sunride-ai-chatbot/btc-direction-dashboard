import { useState } from 'react';
import type { ComponentScore } from '../lib/types';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { translateDynamic } from '../lib/dynamicHe';
import { Badge, type Tone } from './ui';
import { IconChevronDown } from './icons';

function directionKey(score: number): TranslationKey {
  if (score >= 10) return 'dir.bullish';
  if (score <= -10) return 'dir.bearish';
  return 'dir.neutral';
}

function directionCls(score: number): string {
  if (score >= 10) return 'text-bull';
  if (score <= -10) return 'text-bear';
  return 'text-flat';
}

function scoreGlowCls(score: number): string {
  if (score >= 10) return 'text-neon-bull text-glow-bull';
  if (score <= -10) return 'text-neon-bear text-glow-bear';
  return '';
}

function edgeGlowCls(score: number): string {
  if (score >= 10) return 'hover:shadow-glow-bull hover:border-neon-bull/40';
  if (score <= -10) return 'hover:shadow-glow-bear hover:border-neon-bear/40';
  return '';
}

const FRESHNESS_TONE: Record<string, Tone> = {
  fresh: 'bull',
  daily: 'info',
  stale: 'flat',
  unavailable: 'bear',
};

function fmtM(v: unknown): string {
  if (typeof v !== 'number') return '—';
  const m = v / 1_000_000;
  return `${m > 0 ? '+' : ''}$${m.toFixed(0)}M`;
}

export function ComponentCard({ name, comp, weightPct, isEtf = false }: { name: string; comp: ComponentScore; weightPct: number; isEtf?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { t, lang } = useI18n();

  // Daily-cadence data (ETF) must not present itself as live-fresh.
  const badgeKind = !comp.available ? 'unavailable' : isEtf && comp.freshness === 'fresh' ? 'daily' : comp.freshness;
  const badgeTone = FRESHNESS_TONE[badgeKind];
  const badgeLabel = t(`fresh.${badgeKind}` as TranslationKey);

  const etfDetails = comp.details as { netFlowToday?: number | null; rolling3Day?: number | null; rolling5Day?: number | null; dataDate?: string | null };
  const techDetails = comp.details as { cvd15m?: number | null; cvd1h?: number | null; cvd4h?: number | null };
  // LRM-prefixed (see SignalCard.tsx pct()) so the sign/percent stays LTR-isolated
  // once this value is embedded in a non-font-mono Hebrew sentence below.
  const cvdFmt = (v: number | null | undefined): string => (typeof v === 'number' ? `‎${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%` : '—');
  const hasCvd = typeof techDetails.cvd1h === 'number' || typeof techDetails.cvd4h === 'number';

  return (
    <div
      className={`group rounded-xl border border-border bg-card p-4 shadow-card transition-all duration-200 hover:border-border-strong hover:bg-card-hover ${
        comp.available ? edgeGlowCls(comp.score) : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-200">{name}</div>
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
      </div>
      {comp.available ? (
        <>
          <div className="mt-2 flex items-baseline gap-3">
            <span className={`font-mono text-2xl font-bold tabular-nums transition-colors duration-300 ${scoreGlowCls(comp.score)}`}>
              {comp.score > 0 ? '+' : ''}
              {comp.score.toFixed(0)}
            </span>
            <span className={`text-sm font-medium ${directionCls(comp.score)}`}>{t(directionKey(comp.score))}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{t('comp.weight', { pct: weightPct })}</div>
          {isEtf && typeof etfDetails.netFlowToday === 'number' ? (
            <div className="mt-2 space-y-0.5 text-xs text-slate-300">
              <div>
                {t('etf.latest')}: <span className="font-mono">{fmtM(etfDetails.netFlowToday)}</span>
              </div>
              <div>
                {t('etf.threeDay')}: <span className="font-mono">{fmtM(etfDetails.rolling3Day)}</span> · {t('etf.fiveDay')}:{' '}
                <span className="font-mono">{fmtM(etfDetails.rolling5Day)}</span>
              </div>
              {etfDetails.dataDate && (
                <div className="text-slate-500">
                  {t('etf.updated')}: <span className="font-mono">{etfDetails.dataDate}</span>
                </div>
              )}
            </div>
          ) : (
            comp.reasons[0] && <div className="mt-2 text-xs text-slate-400">{translateDynamic(comp.reasons[0], lang)}</div>
          )}
          {hasCvd && (
            <div className="mt-2 text-xs text-slate-400">
              {t('tech.orderFlow')}:{' '}
              {/* No font-mono wrapper — the Hebrew sentence needs its natural RTL direction;
                  cvdFmt() already LRM-isolates each numeric value. */}
              <span className="text-slate-300">
                {t('tech.cvdLine', { m15: cvdFmt(techDetails.cvd15m), h1: cvdFmt(techDetails.cvd1h), h4: cvdFmt(techDetails.cvd4h) })}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 text-sm text-slate-500">
          {comp.risks[0] ? translateDynamic(comp.risks[0], lang) : t('comp.sourceUnavailable')}
        </div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300"
      >
        {expanded ? t('comp.hideRawData') : t('comp.rawData')}
        <IconChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <pre className="chart-ltr animate-fade-in-up mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-surface p-2 text-start text-[10px] leading-relaxed text-slate-400">
          {JSON.stringify(comp.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
