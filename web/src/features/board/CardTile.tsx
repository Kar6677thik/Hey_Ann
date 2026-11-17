// The card face. Pure and memoised: the board re-renders often (live events), cards rarely change.
import { memo } from 'react';
import { Ban, CheckSquare, Clock3, Repeat2, Star } from 'lucide-react';
import type { Card, Project } from '../../../../src/core/types.ts';
import { checklistProgress } from '../../lib/cards.ts';
import { dueInfo, fmtElapsed, fmtMinutes, useNow } from '../../lib/time.ts';
import { AnnMark, Pill, ProjectDot } from '../../components/ui/bits.tsx';
import { Tooltip } from '../../components/ui/Tooltip.tsx';
import { cn } from '../../components/ui/cn.ts';

export function PriorityGlyph({ priority, className }: { priority: Card['priority']; className?: string }) {
  if (priority === 0)
    return (
      <span role="img" aria-label="Priority P0, urgent" title="P0 · Urgent" className={cn('inline-flex flex-none', className)}>
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="var(--negative)" />
          <path d="M7 3.4v4.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="7" cy="10.3" r="1" fill="#fff" />
        </svg>
      </span>
    );
  if (priority === 1 || priority === 2 || priority === 3) {
    const filled = priority === 1 ? 3 : priority === 2 ? 2 : 1;
    const name = priority === 1 ? 'P1 · High' : priority === 2 ? 'P2 · Normal' : 'P3 · Low';
    return (
      <span role="img" aria-label={`Priority ${name}`} title={name} className={cn('inline-flex flex-none', className)}>
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={4 + i * 3} rx="0.75" fill={i < filled ? (priority === 1 ? 'var(--warning)' : 'var(--muted)') : 'var(--control)'} />
          ))}
        </svg>
      </span>
    );
  }
  return null;
}

export function DueChip({ card, today, className }: { card: Card; today: string; className?: string }) {
  const now = useNow(60_000);
  if (card.due_at === null) return null;
  const d = dueInfo(card.due_at, card.due_has_time, today, now);
  const tone = d.tone === 'overdue' ? 'negative' : d.tone === 'today' ? 'warning' : 'neutral';
  if (d.tone === 'later')
    return (
      <span className={cn('whitespace-nowrap text-xs text-faint', className)} title={`Due ${d.full}`}>
        {d.label}
      </span>
    );
  return (
    <Pill tone={tone} title={`Due ${d.full}`} className={className}>
      {d.label}
    </Pill>
  );
}

/** Live focus timer: elapsed against the focus length, ticking each second. */
export function FocusBadge({ startedAt, focusMin }: { startedAt: number; focusMin: number }) {
  const now = useNow(1000);
  const elapsed = now - startedAt;
  const over = elapsed > focusMin * 60_000;
  return (
    <span
      className={cn('inline-flex h-5 flex-none items-center gap-1.5 rounded px-1.5 text-[11px] font-medium', over ? 'bg-[var(--pill-warning-bg)] text-[var(--pill-warning-ink)]' : 'bg-accent-soft text-accent-ink')}
      title={`Focus running · ${focusMin} min session`}
    >
      <span aria-hidden className="live-pulse size-1.5 rounded-full bg-current" />
      <span className="num" aria-label={`Focus running for ${fmtElapsed(elapsed)}`}>
        {fmtElapsed(elapsed)}
      </span>
    </span>
  );
}

export interface CardTileProps {
  card: Card;
  project?: Project;
  today: string;
  focusMin: number;
  done?: boolean;
  touched?: boolean;
  dragging?: boolean;
  overlay?: boolean;
}

export const CardTile = memo(function CardTile({ card, project, today, focusMin, done, touched, dragging, overlay }: CardTileProps) {
  const cl = checklistProgress(card);
  const plannedToday = card.planned_for === today;
  const blocked = !!card.blocked_reason;
  const hasTime = card.estimate_min !== null || card.spent_min > 0;
  const tags = card.tags.slice(0, 2);

  return (
    <article
      className={cn(
        'group/card relative rounded-lg border bg-surface px-3 pt-2.5 pb-2.5 text-left transition-[border-color,box-shadow,transform,opacity] duration-150',
        blocked ? 'border-[color-mix(in_oklab,var(--negative)_38%,var(--border))]' : 'border-border',
        !overlay && 'hover:border-border-strong',
        dragging && 'opacity-35',
        overlay && 'rotate-[1.2deg] scale-[1.02] border-border-strong shadow-[var(--shadow-lift)]',
        touched && 'ann-touched',
      )}
    >
      <div className="flex h-4 items-center gap-1.5 text-xs leading-4">
        <span className="num text-[11px] text-faint">#{card.id}</span>
        {project ? (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <ProjectDot color={project.color} className="size-1.5" />
            <span className="truncate">{project.name}</span>
          </span>
        ) : null}
        <span className="ml-auto flex flex-none items-center gap-1.5">
          {plannedToday && !done ? (
            <span role="img" aria-label="Planned for today" title="Planned for today">
              <Star size={12} strokeWidth={0} fill="var(--accent)" aria-hidden />
            </span>
          ) : null}
          {card.created_by === 'ann' ? <AnnMark client={card.created_client} size={14} /> : null}
        </span>
      </div>

      <h3 className={cn('mt-1.5 line-clamp-3 text-[13px] font-medium leading-[18px] [overflow-wrap:anywhere]', done ? 'text-muted' : 'text-text')}>{card.title}</h3>

      {blocked || card.needs_review ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {blocked ? (
            <Tooltip content={<span><span className="font-medium">Blocked:</span> {card.blocked_reason}</span>}>
              <Pill tone="negative" tabIndex={0} aria-label={`Blocked: ${card.blocked_reason}`}>
                <Ban size={11} strokeWidth={2} aria-hidden />
                Blocked
              </Pill>
            </Tooltip>
          ) : null}
          {card.needs_review ? (
            <Pill tone="warning" title="Ann guessed a detail on this card. Give it a glance.">
              Ann guessed
            </Pill>
          ) : null}
        </div>
      ) : null}

      {(card.priority <= 1 && !done) || (card.due_at !== null && !done) || card.focus_started_at || cl.total || hasTime || card.recurrence || tags.length ? (
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-faint">
        {card.priority <= 1 && !done ? <PriorityGlyph priority={card.priority} /> : null}
        {!done ? <DueChip card={card} today={today} /> : null}
        {card.focus_started_at ? <FocusBadge startedAt={card.focus_started_at} focusMin={focusMin} /> : null}
        {cl.total ? (
          <span className={cn('inline-flex items-center gap-1', cl.done === cl.total && 'text-[var(--pill-positive-ink)]')} title={`Checklist ${cl.done} of ${cl.total}`}>
            <CheckSquare size={12} strokeWidth={1.75} aria-hidden />
            <span className="num">
              {cl.done}/{cl.total}
            </span>
          </span>
        ) : null}
        {hasTime ? (
          <span className="inline-flex items-center gap-1" title={`Spent ${fmtMinutes(card.spent_min)}${card.estimate_min !== null ? ` of ${fmtMinutes(card.estimate_min)} estimated` : ''}`}>
            <Clock3 size={12} strokeWidth={1.75} aria-hidden />
            <span className={cn('num', card.estimate_min !== null && card.spent_min > card.estimate_min && 'text-[var(--pill-warning-ink)]')}>
              {card.spent_min > 0 ? fmtMinutes(card.spent_min) : null}
              {card.spent_min > 0 && card.estimate_min !== null ? ' / ' : null}
              {card.estimate_min !== null ? fmtMinutes(card.estimate_min) : null}
            </span>
          </span>
        ) : null}
        {card.recurrence ? (
          <span role="img" aria-label={`Repeats ${card.recurrence.label}`} title={`Repeats ${card.recurrence.label}`}>
            <Repeat2 size={13} strokeWidth={1.75} aria-hidden />
          </span>
        ) : null}
        {tags.map((t) => (
          <span key={t} className="max-w-28 truncate text-muted">
            #{t}
          </span>
        ))}
        {card.tags.length > tags.length ? <span className="num">+{card.tags.length - tags.length}</span> : null}
      </div>
      ) : null}
    </article>
  );
});
