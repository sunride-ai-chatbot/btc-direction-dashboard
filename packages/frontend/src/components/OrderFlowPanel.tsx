import { useApi } from '../lib/api';
import { useLive } from '../lib/live';
import { useI18n } from '../lib/i18n';
import type { CandlesPayload, CvdSnapshot } from '../lib/types';

function Bar({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? null : value * 100;
  return (
    <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
      <span className="w-8 text-slate-500">{label}</span>
      <div className="chart-ltr relative h-2.5 flex-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        <span className="absolute left-1/2 top-0 h-full w-px bg-slate-600" />
        {pct !== null && (
          <span
            className={`absolute top-0 h-full rounded-full transition-all duration-500 ${pct >= 0 ? 'bg-bull shadow-glow-bull' : 'bg-bear shadow-glow-bear'}`}
            style={pct >= 0 ? { left: '50%', width: `${Math.min(50, pct / 2)}%` } : { right: '50%', width: `${Math.min(50, -pct / 2)}%` }}
          />
        )}
      </div>
      <span className={`w-14 text-end ${pct === null ? 'text-slate-600' : pct > 0 ? 'text-bull' : pct < 0 ? 'text-bear' : 'text-slate-300'}`}>
        {pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}

/** Taker buy vs sell imbalance per window, plus the last hour minute-by-minute. */
export function OrderFlowPanel({ fallback }: { fallback: CvdSnapshot | null }) {
  const { t } = useI18n();
  const live = useLive();
  const { data } = useApi<CandlesPayload>('/api/candles?n=60', 30_000);
  const cvd = live.tick?.cvd ?? fallback;
  const minutes = (data?.candles ?? []).slice(-60);
  const known = minutes.filter((c) => c.takerBuyVolume !== null);

  return (
    <section className="glass rounded-2xl p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-semibold text-slate-100">{t('orderflow.title')}</h3>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{t('orderflow.window')}</span>
      </div>
      <div className="mt-3 space-y-2">
        <Bar label="15m" value={cvd?.ratio15m ?? null} />
        <Bar label="1h" value={cvd?.ratio1h ?? null} />
        <Bar label="4h" value={cvd?.ratio4h ?? null} />
      </div>
      <div className="mt-3 flex justify-between text-[10px] text-slate-500">
        <span className="text-bear">{t('orderflow.sellers')}</span>
        <span className="text-bull">{t('orderflow.buyers')}</span>
      </div>
      {minutes.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">{t('orderflow.lastHour')}</div>
          <div className="chart-ltr mt-1.5 flex h-6 items-end gap-px" aria-hidden="true">
            {minutes.map((c) => {
              const share = c.takerBuyVolume === null ? null : c.volume > 0 ? c.takerBuyVolume / c.volume : 0.5;
              const height = share === null ? 30 : 30 + Math.abs(share - 0.5) * 140;
              return (
                <span
                  key={c.ts}
                  className={`flex-1 rounded-sm ${share === null ? 'bg-slate-700/60' : share >= 0.55 ? 'bg-bull/80' : share <= 0.45 ? 'bg-bear/80' : 'bg-slate-500/70'}`}
                  style={{ height: `${Math.min(100, height)}%` }}
                />
              );
            })}
          </div>
          <div className="mt-1 text-[10px] text-slate-600">
            {known.length < minutes.length ? t('orderflow.partial', { n: known.length, total: minutes.length }) : t('orderflow.explainer')}
          </div>
        </div>
      )}
      {(cvd?.ratio15m ?? null) === null && <div className="mt-2 text-[11px] text-slate-500">{t('orderflow.na')}</div>}
    </section>
  );
}
