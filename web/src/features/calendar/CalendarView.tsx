// Calendar: cards by due day. Drag a card to another day to reschedule; recurring cards show their next dates.
import { useMemo, useState } from 'react';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { useDragSensors } from '../../lib/dnd.ts';
import { ChevronLeft, ChevronRight, Repeat2 } from 'lucide-react';
import type { Card, Recurrence } from '../../../../src/core/types.ts';
import { useOpenCard } from '../../app/nav.ts';
import { isOverdue } from '../../lib/cards.ts';
import { usePatchCard, latestVersion } from '../../lib/mutations.ts';
import { useBoardIndex, type BoardIndex } from '../../lib/queries.ts';
import { addDays, clockHHmm, dayKey, diffDays, fmtClock, fmtDay, monthGrid, monthName, weekday, weekdayShort } from '../../lib/time.ts';
import { ErrorNote, ProjectDot, Skeleton } from '../../components/ui/bits.tsx';
import { Button, IconButton } from '../../components/ui/Button.tsx';
import { Segmented } from '../../components/ui/form.tsx';
import { cn } from '../../components/ui/cn.ts';

interface Item {
  card: Card;
  day: string;
  ghost: boolean;
}

/** Next occurrences of a recurring card after its due day, up to `until`. */
function occurrences(card: Card, rec: Recurrence, until: string): string[] {
  if (card.due_at === null) return [];
  const start = dayKey(card.due_at);
  const out: string[] = [];
  if (rec.unit === 'week' && rec.weekdays?.length) {
    for (let d = addDays(start, 1); d <= until && out.length < 60; d = addDays(d, 1)) {
      const weeks = Math.floor(diffDays(d, start) / 7);
      if (rec.weekdays.includes(weekday(d)) && weeks % rec.every === 0) out.push(d);
    }
    return out;
  }
  const [y, m, dd] = start.split('-').map(Number);
  for (let i = 1; i < 60; i++) {
    let d: string;
    if (rec.unit === 'day') d = addDays(start, i * rec.every);
    else if (rec.unit === 'week') d = addDays(start, i * 7 * rec.every);
    else {
      const months = rec.unit === 'month' ? i * rec.every : i * 12 * rec.every;
      const target = new Date(Date.UTC(y, m - 1 + months, 1));
      const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(dd, last));
      d = target.toISOString().slice(0, 10);
    }
    if (d > until) break;
    out.push(d);
  }
  return out;
}

export default function CalendarView() {
  const { index, isPending, isError, refetch } = useBoardIndex();
  if (isError) return <div className="p-6"><ErrorNote message="Couldn’t load the calendar." onRetry={() => void refetch()} /></div>;
  if (isPending || !index)
    return (
      <div className="p-6" aria-busy="true">
        <h1 className="text-[20px] font-semibold">Calendar</h1>
        <Skeleton className="mt-4 h-[560px] w-full rounded-lg" />
      </div>
    );
  return <Calendar index={index} />;
}

function Calendar({ index }: { index: BoardIndex }) {
  const { board, doneIds } = index;
  const today = board.today;
  const [cursor, setCursor] = useState(today);
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const patch = usePatchCard();
  const sensors = useDragSensors(5);

  const [y, m] = cursor.split('-').map(Number);
  const days = useMemo(() => {
    if (mode === 'month') return monthGrid(y, m - 1, board.settings.week_starts_on);
    const lead = (weekday(cursor) - board.settings.week_starts_on + 7) % 7;
    const start = addDays(cursor, -lead);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [mode, y, m, cursor, board.settings.week_starts_on]);
  const first = days[0];
  const last = days[days.length - 1];

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const push = (it: Item) => {
      if (it.day < first || it.day > last) return;
      const list = map.get(it.day) ?? [];
      list.push(it);
      map.set(it.day, list);
    };
    for (const c of board.cards) {
      if (c.due_at === null) continue;
      push({ card: c, day: dayKey(c.due_at), ghost: false });
      if (c.recurrence && !doneIds.has(c.column_id)) for (const d of occurrences(c, c.recurrence, last)) push({ card: c, day: d, ghost: true });
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.ghost) - Number(b.ghost) || (a.card.due_has_time ? a.card.due_at! % 86_400_000 : 9e9) - (b.card.due_has_time ? b.card.due_at! % 86_400_000 : 9e9));
    return map;
  }, [board.cards, doneIds, first, last]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const card = index.cardById.get(Number(active.id));
    const day = String(over.id);
    if (!card || card.due_at === null || dayKey(card.due_at) === day) return;
    const due = card.due_has_time ? `${day} ${clockHHmm(card.due_at)}` : day;
    const shift = diffDays(day, dayKey(card.due_at)) * 86_400_000;
    patch.mutate({ id: card.id, patch: { due, version: latestVersion(card.id) }, optimistic: (c) => ({ ...c, due_at: (c.due_at ?? 0) + shift }), toastId: `due-${card.id}` });
  };

  const step = (n: number) => {
    if (mode === 'week') setCursor(addDays(cursor, n * 7));
    else {
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      setCursor(d.toISOString().slice(0, 10));
    }
  };
  const title = mode === 'month' ? `${monthName(m - 1)} ${y}` : `${fmtDay(first)} – ${fmtDay(last)}`;
  const undated = board.cards.filter((c) => c.due_at === null && !doneIds.has(c.column_id)).length;
  const inRange = [...byDay.values()].flat().filter((i) => !i.ghost).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-none flex-wrap items-end justify-between gap-3 px-4 pt-4 pb-3 md:px-6 md:pt-5">
        <div>
          <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Calendar</h1>
          <p className="mt-0.5 text-sm text-muted">
            <span className="num">{inRange}</span> due in view · <span className="num">{undated}</span> open cards have no date · drag a card to reschedule it
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Range" value={mode} onChange={setMode} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />
          <div className="flex items-center gap-1">
            <IconButton label={mode === 'month' ? 'Previous month' : 'Previous week'} icon={ChevronLeft} onClick={() => step(-1)} />
            <Button size="sm" variant="ghost" onClick={() => setCursor(today)}>
              Today
            </Button>
            <IconButton label={mode === 'month' ? 'Next month' : 'Next week'} icon={ChevronRight} onClick={() => step(1)} />
          </div>
          <h2 className="num text-sm font-medium text-text sm:min-w-36 sm:text-right" aria-live="polite">
            {title}
          </h2>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: 'Press Space to pick up the card, arrow keys to move it to another day, Space to drop.' } }}>
        <div className="flex-none px-4 pb-8 md:px-6">
          <Agenda days={days} byDay={byDay} index={index} />
          <div className="hidden overflow-hidden rounded-lg border border-border sm:block">
            <div className="grid grid-cols-7 border-b border-border bg-surface">
              {days.slice(0, 7).map((d) => (
                <div key={d} className="px-2 py-1.5 text-xs text-faint">
                  {weekdayShort(weekday(d))}
                  {mode === 'week' ? <span className="num ml-1.5 text-muted">{Number(d.slice(8))}</span> : null}
                </div>
              ))}
            </div>
            <div className={cn('grid grid-cols-7', mode === 'week' ? 'min-h-[520px]' : '')}>
              {days.map((d) => (
                <DayCell key={d} day={d} items={byDay.get(d) ?? []} index={index} outside={mode === 'month' && Number(d.slice(5, 7)) !== m} mode={mode} />
              ))}
            </div>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
            <Repeat2 size={12} strokeWidth={1.75} aria-hidden /> Dashed cards are the next dates of repeating cards; they appear when the current one is done.
          </p>
        </div>
      </DndContext>
    </div>
  );
}

/** Phones: the same days as a list, only the ones with cards. */
function Agenda({ days, byDay, index }: { days: string[]; byDay: Map<string, Item[]>; index: BoardIndex }) {
  const withItems = days.filter((d) => byDay.get(d)?.length);
  return (
    <div className="sm:hidden">
      {withItems.length ? (
        withItems.map((d) => (
          <section key={d} aria-label={fmtDay(d)} className="mb-3">
            <h3 className={cn('py-1.5 text-xs font-medium', d === index.board.today ? 'text-accent-ink' : 'text-faint')}>{d === index.board.today ? `Today · ${fmtDay(d)}` : fmtDay(d)}</h3>
            <ul className="flex flex-col gap-1">
              {byDay.get(d)!.map((it) => (
                <Chip key={`${it.card.id}-${it.day}-${it.ghost}`} item={it} index={index} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="rounded-md border border-dashed border-border-strong px-4 py-3 text-sm text-muted">Nothing due in this range.</p>
      )}
    </div>
  );
}

function DayCell({ day, items, index, outside, mode }: { day: string; items: Item[]; index: BoardIndex; outside: boolean; mode: 'month' | 'week' }) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  const today = index.board.today;
  const isToday = day === today;
  const wd = weekday(day);
  const weekend = wd === 0 || wd === 6;
  const max = mode === 'month' ? 3 : 50;
  const shown = items.slice(0, max);
  return (
    <div
      ref={setNodeRef}
      aria-label={`${fmtDay(day)}, ${items.length} cards`}
      className={cn(
        'relative min-h-[112px] border-b border-r border-rule p-1.5 transition-colors [&:nth-child(7n)]:border-r-0',
        weekend ? 'bg-[color-mix(in_oklab,var(--surface)_70%,var(--ground))]' : 'bg-ground',
        isOver && 'bg-[color-mix(in_oklab,var(--accent)_10%,var(--ground))]',
      )}
    >
      {isToday ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-accent" /> : null}
      <div className={cn('num mb-1 px-1 text-xs', isToday ? 'font-semibold text-text' : outside ? 'text-faint/60' : 'text-faint')}>
        {Number(day.slice(8))}
        {isToday ? <span className="ml-1.5 font-sans font-normal text-accent-ink">Today</span> : null}
      </div>
      <ul className="flex flex-col gap-1">
        {shown.map((it) => (
          <Chip key={`${it.card.id}-${it.day}-${it.ghost}`} item={it} index={index} />
        ))}
      </ul>
      {items.length > max ? <p className="num mt-1 px-1 text-[11px] text-faint">+{items.length - max} more</p> : null}
    </div>
  );
}

function Chip({ item, index }: { item: Item; index: BoardIndex }) {
  const { card, ghost } = item;
  const openCard = useOpenCard();
  const done = index.doneIds.has(card.column_id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, disabled: ghost || done });
  const project = card.project_id !== null ? index.projectById.get(card.project_id) : undefined;
  const overdue = !done && !ghost && isOverdue(card, index.board.today);
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        {...(ghost || done ? {} : attributes)}
        {...(ghost || done ? {} : listeners)}
        onClick={() => openCard(card.id)}
        title={`#${card.id} ${card.title}${card.due_has_time && card.due_at ? ` · ${fmtClock(card.due_at)}` : ''}${ghost ? ' (repeats)' : ''}`}
        style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
        className={cn(
          'flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left text-xs max-sm:h-10 max-sm:text-sm',
          ghost ? 'border border-dashed border-border-strong text-faint' : 'border border-border bg-surface text-text hover:border-border-strong',
          done && 'text-faint line-through decoration-faint',
          overdue && 'border-[color-mix(in_oklab,var(--negative)_50%,var(--border))]',
          isDragging && 'relative z-20 cursor-grabbing shadow-[var(--shadow-lift)]',
          !ghost && !done && 'cursor-grab',
        )}
      >
        {project ? <ProjectDot color={project.color} className="size-1.5" /> : null}
        {card.due_has_time && card.due_at && !ghost ? <span className="num flex-none text-[11px] text-faint">{fmtClock(card.due_at)}</span> : null}
        <span className="min-w-0 flex-1 truncate">{card.title}</span>
        {card.recurrence ? <Repeat2 size={11} strokeWidth={1.75} aria-hidden className="flex-none text-faint" /> : null}
      </button>
    </li>
  );
}
