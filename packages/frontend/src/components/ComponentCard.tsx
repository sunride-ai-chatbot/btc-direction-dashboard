import { useState } from 'react';
import type { ComponentScore } from '../lib/types';

function direction(score: number): { label: string; cls: string } {
  if (score >= 10) return { label: '↑ bullish', cls: 'text-bull' };
  if (score <= -10) return { label: '↓ bearish', cls: 'text-bear' };
  return { label: '→ neutral', cls: 'text-flat' };
}

const FRESHNESS_BADGE: Record<string, { label: string; cls: string }> = {
  fresh: { label: 'fresh', cls: 'bg-bull/10 text-bull' },
  stale: { label: 'stale', cls: 'bg-flat/10 text-flat' },
  unavailable: { label: 'unavailable', cls: 'bg-bear/10 text-bear' },
};

export function ComponentCard({ name, comp, weightPct }: { name: string; comp: ComponentScore; weightPct: number }) {
  const [expanded, setExpanded] = useState(false);
  const dir = direction(comp.score);
  const badge = FRESHNESS_BADGE[comp.available ? comp.freshness : 'unavailable'];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-200">{name}</div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${badge.cls}`}>{badge.label}</span>
      </div>
      {comp.available ? (
        <>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono text-2xl font-bold">
              {comp.score > 0 ? '+' : ''}
              {comp.score.toFixed(0)}
            </span>
            <span className={`text-sm font-medium ${dir.cls}`}>{dir.label}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">weight {weightPct}%</div>
          {comp.reasons[0] && <div className="mt-2 text-xs text-slate-400">{comp.reasons[0]}</div>}
        </>
      ) : (
        <div className="mt-2 text-sm text-slate-500">{comp.risks[0] ?? 'Source unavailable'}</div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
      >
        {expanded ? 'hide raw data' : 'raw data'}
      </button>
      {expanded && (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface p-2 text-[10px] leading-relaxed text-slate-400">
          {JSON.stringify(comp.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
