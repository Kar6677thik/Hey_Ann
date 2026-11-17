// The running focus session, large: elapsed against the session length, with stop.
import { Play, Square } from 'lucide-react';
import type { Card, RankedCard } from '../../../../src/core/types.ts';
import { useOpenCard } from '../../app/nav.ts';
import { useFocus } from '../../lib/mutations.ts';
import { fmtElapsed, fmtMinutes, useNow } from '../../lib/time.ts';
import { Button } from '../../components/ui/Button.tsx';
import { cn } from '../../components/ui/cn.ts';

export function FocusPanel({ running, focusMin, suggestion }: { running: Card | undefined; focusMin: number; suggestion?: RankedCard }) {
  const focus = useFocus();
  const openCard = useOpenCard();
  const now = useNow(1000);

  if (!running) {
    return (
      <section aria-labelledby="focus-h" className="flex min-h-[148px] flex-col justify-between rounded-lg border border-border bg-surface p-5">
        <div>
          <h2 id="focus-h" className="text-sm font-semibold">
            Focus
          </h2>
          <p className="mt-1 text-sm text-muted">Nothing running. Sessions are {focusMin} minutes; time is logged to the card when you stop.</p>
        </div>
        {suggestion ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={Play} onClick={() => focus.mutate({ id: suggestion.card.id, action: 'start' })} disabled={focus.isPending}>
              Start on #{suggestion.card.id}
            </Button>
            <span className="min-w-0 truncate text-sm text-muted">{suggestion.card.title}</span>
          </div>
        ) : null}
      </section>
    );
  }

  const elapsed = now - running.focus_started_at!;
  const target = focusMin * 60_000;
  const over = elapsed > target;
  const ratio = Math.min(1, elapsed / target);
  const remaining = target - elapsed;

  return (
    <section aria-labelledby="focus-h" className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="focus-h" className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className="live-pulse size-1.5 rounded-full bg-accent" />
            In focus
          </h2>
          <button type="button" onClick={() => openCard(running.id)} className="mt-1 block max-w-full truncate text-left text-sm text-muted hover:text-text">
            <span className="num text-faint">#{running.id}</span> {running.title}
          </button>
        </div>
        <Button icon={Square} onClick={() => focus.mutate({ id: running.id, action: 'stop' })} disabled={focus.isPending}>
          Stop and log
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-1">
        <p className="num text-[44px] font-medium leading-none tracking-[-0.03em] text-text" role="timer" aria-label={`Elapsed ${fmtElapsed(elapsed)}`}>
          {fmtElapsed(elapsed)}
        </p>
        <p className={cn('num pb-1 text-sm', over ? 'text-[var(--pill-warning-ink)]' : 'text-muted')}>
          {over ? `+${fmtElapsed(-remaining)} past ${focusMin}:00` : `${fmtElapsed(remaining)} left of ${focusMin}:00`}
        </p>
        <p className="num ml-auto pb-1 text-xs text-faint">
          {fmtMinutes(running.spent_min)} logged{running.estimate_min !== null ? ` of ${fmtMinutes(running.estimate_min)}` : ''}
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={focusMin} aria-valuenow={Math.round(elapsed / 60_000)} aria-label="Session progress">
        <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', over ? 'bg-warning' : 'bg-accent')} style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-faint">
        <span>0:00</span>
        <span>{focusMin}:00</span>
      </div>
    </section>
  );
}
