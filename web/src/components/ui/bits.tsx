// Small display primitives.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';
import { clientLabel } from '../../lib/clients.ts';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-raised px-1 font-mono text-[11px] leading-none text-muted', className)}>
      {children}
    </kbd>
  );
}

export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'accent';
const tones: Record<Tone, string> = {
  neutral: 'bg-[var(--pill-neutral-bg)] text-[var(--pill-neutral-ink)]',
  positive: 'bg-[var(--pill-positive-bg)] text-[var(--pill-positive-ink)]',
  negative: 'bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)]',
  warning: 'bg-[var(--pill-warning-bg)] text-[var(--pill-warning-ink)]',
  accent: 'bg-accent-soft text-accent-ink',
};
export function Pill({ tone = 'neutral', className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn('inline-flex h-5 flex-none items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-none', tones[tone], className)} {...rest}>
      {children}
    </span>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn('skeleton block', className)} style={style} />;
}

export function ProjectDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 flex-none rounded-full', className)} style={{ background: color ?? 'var(--faint)' }} />;
}

/** Ann's mark: a small "A" monogram ring in the accent, with the client on hover. */
export function AnnMark({ client, size = 16, className }: { client?: string | null; size?: number; className?: string }) {
  const label = `Created by Ann via ${clientLabel(client)}`;
  return (
    <span role="img" aria-label={label} title={label} className={cn('inline-flex flex-none items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
        <circle cx="8" cy="8" r="7.25" fill="none" stroke="var(--accent)" strokeWidth="1.25" />
        <path d="M5.1 11.2 8 4.6l2.9 6.6M6.2 8.9h3.6" fill="none" stroke="var(--accent-ink)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** The product mark: three columns of falling height (a board, read left to right). */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--raised)" />
      <rect x="7" y="8" width="4.5" height="16" rx="1.5" fill="var(--accent)" />
      <rect x="13.75" y="8" width="4.5" height="11" rx="1.5" fill="var(--text)" />
      <rect x="20.5" y="8" width="4.5" height="7" rx="1.5" fill="var(--text)" fillOpacity=".5" />
    </svg>
  );
}

export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-md border border-dashed border-border-strong px-3 py-2.5 text-sm text-muted', className)}>{children}</div>;
}

export function ErrorNote({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm text-muted', className)}>
      <span aria-hidden className="size-1.5 flex-none rounded-full bg-negative" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <button type="button" className="font-medium text-text hover:underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Panel({ title, aside, children, className, bodyClass, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={cn('rounded-lg border border-border bg-surface', className)}>
      {title ? (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-rule px-4 py-2">
          <h2 id={id} className="text-sm font-semibold text-text">
            {title}
          </h2>
          {aside}
        </header>
      ) : null}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-text">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
