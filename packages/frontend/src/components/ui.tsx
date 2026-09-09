import type { ReactNode } from 'react';

// Shared visual primitives — small enough that pulling in a component library isn't
// worth it, but centralized so tone colors and badge/skeleton shape stay consistent
// across every page instead of being re-invented per file.

export type Tone = 'bull' | 'bear' | 'flat' | 'info' | 'accent' | 'neutral';

const TONE_DOT: Record<Tone, string> = {
  bull: 'bg-bull',
  bear: 'bg-bear',
  flat: 'bg-flat',
  info: 'bg-info',
  accent: 'bg-accent',
  neutral: 'bg-slate-500',
};

const TONE_BADGE: Record<Tone, string> = {
  bull: 'bg-bull/10 text-bull',
  bear: 'bg-bear/10 text-bear',
  flat: 'bg-flat/10 text-flat',
  info: 'bg-info/10 text-info',
  accent: 'bg-accent/10 text-accent',
  neutral: 'bg-slate-500/10 text-slate-400',
};

/** Small colored status dot — replaces emoji (🟢🟡🔴⚪) as a semantic, themeable indicator. */
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
