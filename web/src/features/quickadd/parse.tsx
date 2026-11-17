// Live quick-add parse preview, shared by the column quick add and the command palette.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CalendarClock, Clock3, FolderClosed, Hash, Repeat2, Star } from 'lucide-react';
import type { ParsedInput } from '../../../../src/core/types.ts';
import { api } from '../../lib/api.ts';
import { PRIORITY_SHORT } from '../../lib/cards.ts';
import { fmtMinutes } from '../../lib/time.ts';
import { cn } from '../../components/ui/cn.ts';

export function splitLines(text: string): string[] {
  return text
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Parses the line being typed (the last non-empty line). */
export function useParsePreview(text: string) {
  const lines = splitLines(text);
  const current = lines[lines.length - 1] ?? '';
  const debounced = useDebounced(current, 140);
  const q = useQuery({
    queryKey: ['parse', debounced],
    queryFn: () => api.parse(debounced),
    enabled: debounced.length > 1,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  return { parsed: current.length > 1 ? q.data : undefined, count: lines.length };
}

function Chip({ icon: Icon, children, tone = 'neutral' }: { icon?: typeof Hash; children: React.ReactNode; tone?: 'neutral' | 'warning' | 'negative' | 'accent' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 flex-none items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-[var(--pill-neutral-bg)] text-[var(--pill-neutral-ink)]',
        tone === 'warning' && 'bg-[var(--pill-warning-bg)] text-[var(--pill-warning-ink)]',
        tone === 'negative' && 'bg-[var(--pill-negative-bg)] text-[var(--pill-negative-ink)]',
        tone === 'accent' && 'bg-accent-soft text-accent-ink',
      )}
    >
      {Icon ? <Icon size={11} strokeWidth={2} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** What the server understood: due, priority, project, tags, estimate, recurrence. */
export function ParseChips({ parsed, className }: { parsed: ParsedInput | undefined; className?: string }) {
  if (!parsed) return null;
  const chips: React.ReactNode[] = [];
  if (parsed.due_label) chips.push(<Chip key="due" icon={CalendarClock}>{parsed.due_label}</Chip>);
  if (parsed.priority !== null && parsed.priority !== 2)
    chips.push(
      <Chip key="p" tone={parsed.priority === 0 ? 'negative' : parsed.priority === 1 ? 'warning' : 'neutral'}>
        {PRIORITY_SHORT[parsed.priority]}
      </Chip>,
    );
  if (parsed.project) chips.push(<Chip key="proj" icon={FolderClosed}>{parsed.project}</Chip>);
  for (const t of parsed.tags) chips.push(<Chip key={`t-${t}`} icon={Hash}>{t}</Chip>);
  if (parsed.estimate_min) chips.push(<Chip key="est" icon={Clock3}>{fmtMinutes(parsed.estimate_min)}</Chip>);
  if (parsed.recurrence) chips.push(<Chip key="rec" icon={Repeat2}>{parsed.recurrence.label}</Chip>);
  if (parsed.planned_today) chips.push(<Chip key="today" icon={Star} tone="accent">Today</Chip>);
  if (!chips.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} aria-live="polite" aria-label="Understood">
      {chips}
    </div>
  );
}

export const QUICK_ADD_SYNTAX: [string, string][] = [
  ['next fri 5pm', 'due date, any phrase'],
  ['!p1  !urgent', 'priority'],
  ['#tag', 'tag'],
  ['@project', 'project'],
  ['~45m  ~2h', 'estimate'],
  ['*today', 'plan for today'],
  ['every weekday', 'repeat'],
];
