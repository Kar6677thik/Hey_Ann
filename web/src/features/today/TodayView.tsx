// Today ("My Day"): what to do now, the running focus, the plan against capacity, what's late.
import { useMemo } from 'react';
import { Play } from 'lucide-react';
import type { Card, RankedCard } from '../../../../src/core/types.ts';
import { useOpenCard } from '../../app/nav.ts';
import { isOverdue } from '../../lib/cards.ts';
import { useFocus } from '../../lib/mutations.ts';
import { useBoardIndex, useNext, usePlan } from '../../lib/queries.ts';
import { dayKey, fmtDay, fmtMinutes } from '../../lib/time.ts';
import { ErrorNote, Pill, ProjectDot, Skeleton } from '../../components/ui/bits.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { CardRow } from '../card/CardRow.tsx';
import { FocusPanel } from './FocusPanel.tsx';
import { PlanPanel, minutesNeeded } from './PlanPanel.tsx';
import { SummaryPanel } from './SummaryPanel.tsx';

export default function TodayView() {
  const { index, isPending, isError, refetch } = useBoardIndex();
  const plan = usePlan();
  const next = useNext();
  const focus = useFocus();

  const data = useMemo(() => {
    if (!index) return null;
    const { board, doneIds } = index;
    const open = board.cards.filter((c) => !doneIds.has(c.column_id));
    const planned = open.filter((c) => c.planned_for === board.today);
    const overdue = open.filter((c) => isOverdue(c, board.today)).sort((a, b) => (a.due_at ?? 0) - (b.due_at ?? 0));
    const dueToday = open.filter((c) => c.due_at !== null && dayKey(c.due_at) === board.today && !isOverdue(c, board.today)).sort((a, b) => (a.due_at ?? 0) - (b.due_at ?? 0));
    const doneToday = board.cards.filter((c) => doneIds.has(c.column_id) && c.completed_at !== null && dayKey(c.completed_at) === board.today).length;
    return { planned, overdue, dueToday, doneToday, running: board.cards.find((c) => c.focus_started_at !== null), plannedMin: planned.reduce((n, c) => n + minutesNeeded(c), 0) };
  }, [index]);

  if (isError) return <div className="p-6"><ErrorNote message="Couldn’t load today." onRetry={() => void refetch()} /></div>;

  const board = index?.board;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-4 pt-4 pb-10 md:px-6 md:pt-5">
        <header>
          <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Today</h1>
          {board && data ? (
            <p className="mt-0.5 text-sm text-muted">
              {fmtDay(board.today)}
              <span className="px-1.5 text-faint">·</span>
              <span className="num">{data.planned.length}</span> planned, <span className="num">{fmtMinutes(data.plannedMin)}</span> of {fmtMinutes(board.settings.day_capacity_min)}
              <span className="px-1.5 text-faint">·</span>
              <span className="num">{data.doneToday}</span> done
              {data.overdue.length ? (
                <>
                  <span className="px-1.5 text-faint">·</span>
                  <span className="text-text">
                    <span className="num">{data.overdue.length}</span> overdue
                  </span>
                </>
              ) : null}
            </p>
          ) : (
            <Skeleton className="mt-1.5 h-4 w-80" />
          )}
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            {board && data ? <FocusPanel running={data.running} focusMin={board.settings.focus_min} suggestion={next.data?.items.find((r) => !r.card.focus_started_at)} /> : <Skeleton className="h-[148px] w-full rounded-lg" />}
            <PlanPanel plan={plan.data} planned={data?.planned ?? []} cardsById={index?.cardById ?? new Map()} pending={isPending || plan.isPending} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <section aria-labelledby="next-h" className="rounded-lg border border-border bg-surface">
              <header className="flex min-h-12 items-center justify-between border-b border-rule px-5">
                <h2 id="next-h" className="text-sm font-semibold">
                  What now?
                </h2>
                <span className="text-xs text-faint">Ann’s ranking</span>
              </header>
              {next.isPending ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : next.isError ? (
                <div className="p-5">
                  <ErrorNote message="Couldn’t rank cards." onRetry={() => void next.refetch()} />
                </div>
              ) : next.data.items.length ? (
                <ol className="px-5 py-1.5">
                  {next.data.items.map((r, i) => (
                    <NextItem key={r.card.id} rank={i + 1} item={r} onFocus={() => focus.mutate({ id: r.card.id, action: 'start' })} />
                  ))}
                </ol>
              ) : (
                <p className="p-5 text-sm text-faint">Nothing open. Enjoy it, or add the next thing.</p>
              )}
            </section>

            <DueList title="Overdue" id="overdue-h" cards={data?.overdue} empty="Nothing overdue." pending={isPending} />
            <DueList title="Due today" id="due-h" cards={data?.dueToday} empty="Nothing else due today." pending={isPending} />
            <SummaryPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function NextItem({ rank, item, onFocus }: { rank: number; item: RankedCard; onFocus: () => void }) {
  const openCard = useOpenCard();
  const { index } = useBoardIndex();
  const c = item.card;
  const project = c.project_id !== null ? index?.projectById.get(c.project_id) : undefined;
  return (
    <li className="grid grid-cols-[18px_1fr] gap-x-2 border-b border-rule py-3 last:border-0">
      <span className="num pt-0.5 text-xs text-faint">{rank}.</span>
      <div className="min-w-0">
        <button type="button" onClick={() => openCard(c.id)} className="block w-full text-left">
          <span className="line-clamp-2 text-sm leading-5 text-text hover:underline hover:decoration-faint">{c.title}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-faint">
            <span className="num">#{c.id}</span>
            {project ? (
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <ProjectDot color={project.color} className="size-1.5" />
                {project.name}
              </span>
            ) : null}
            {c.estimate_min !== null ? <span className="num">{fmtMinutes(c.estimate_min)}</span> : null}
          </span>
        </button>
        <div className="mt-2 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {item.reasons.map((reason) => (
              <Pill key={reason} tone={/overdue/.test(reason) ? 'negative' : /due today|P0/.test(reason) ? 'warning' : 'neutral'}>
                {reason}
              </Pill>
            ))}
          </div>
          {c.focus_started_at ? (
            <Pill tone="accent" className="flex-none">Focusing</Pill>
          ) : (
            <Button size="sm" variant="ghost" icon={Play} aria-label={`Start focus on #${c.id}`} onClick={onFocus} className="-mt-1 flex-none">
              Focus
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function DueList({ title, id, cards, empty, pending }: { title: string; id: string; cards: Card[] | undefined; empty: string; pending: boolean }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface">
      <header className="flex min-h-11 items-center justify-between border-b border-rule px-5">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        <span className="num text-xs text-faint">{cards?.length ?? ''}</span>
      </header>
      {pending || !cards ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : cards.length ? (
        <ul className="px-5 py-1">
          {cards.slice(0, 6).map((c) => (
            <CardRow key={c.id} card={c} />
          ))}
          {cards.length > 6 ? <li className="py-2 text-xs text-faint">and {cards.length - 6} more on the board</li> : null}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-faint">{empty}</p>
      )}
    </section>
  );
}
