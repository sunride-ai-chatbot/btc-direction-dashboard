import type { ReactNode } from 'react';

// Shared visual primitives — small enough that pulling in a component library isn't
// worth it, but centralized so tone colors and badge/skeleton shape stay consistent
// across every page instead of being re-invented per file.

export type Tone = 'bull' | 'bear' | 'flat' | 'info' | 'accent' | 'neutral';

const TONE_DOT: Record<Tone, string> = {
  bull: 'bg-neon-bull shadow-glow-bull',
  bear: 'bg-neon-bear shadow-glow-bear',
  flat: 'bg-flat shadow-glow-flat',
  info: 'bg-info',
  accent: 'bg-accent shadow-glow-accent-sm',
  neutral: 'bg-slate-500',
};

const TONE_BADGE: Record<Tone, string> = {
  bull: 'bg-bull/10 text-bull ring-1 ring-inset ring-bull/25',
  bear: 'bg-bear/10 text-bear ring-1 ring-inset ring-bear/25',
  flat: 'bg-flat/10 text-flat ring-1 ring-inset ring-flat/20',
  info: 'bg-info/10 text-info ring-1 ring-inset ring-info/20',
  accent: 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/25',
  neutral: 'bg-slate-500/10 text-slate-400 ring-1 ring-inset ring-slate-500/15',
};

/** Small colored status dot — replaces emoji (🟢🟡🔴⚪) as a semantic, themeable indicator.
 * bull/bear glow with the "neon" variant since this is the one place a literal light
 * (rather than body text) can carry full-voltage color without hurting contrast. */
export function StatusDot({ tone, pulse = false, className = 'h-2 w-2' }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${TONE_DOT[tone]} opacity-60`} />}
      <span className={`relative inline-flex h-full w-full rounded-full ${TONE_DOT[tone]}`} />
    </span>
  );
}

export function Badge({ tone, children, className = '' }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE_BADGE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Tiny live trend line of the last few dozen ticks — decorative reinforcement of a price
 * shown as text elsewhere, so it's hidden from screen readers. */
export function LiveSparkline({ points, tone, className = 'h-10 w-32' }: { points: number[]; tone: 'bull' | 'bear'; className?: string }) {
  if (points.length < 2) return null;
  const w = 160;
  const h = 40;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((v, i) => [(i / (points.length - 1)) * w, h - ((v - min) / span) * (h - 6) - 3] as const);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];
  const stroke = tone === 'bull' ? '#39ff14' : '#ff1744';
  const gradId = `spark-${tone}`;
  return (
    <div className={`chart-ltr ${className}`} aria-hidden="true">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gradId})`} />
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 3px ${stroke})` }} />
        <circle cx={lastX} cy={lastY} r="2.5" fill={stroke} style={{ filter: `drop-shadow(0 0 4px ${stroke})` }} />
      </svg>
    </div>
  );
}

/** Shimmering placeholder block for loading states — respects prefers-reduced-motion globally. */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  description,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-8 text-center animate-fade-in-up ${className}`}>
      {icon && (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-slate-500">{icon}</div>
      )}
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {description && <div className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{description}</div>}
    </div>
  );
}
