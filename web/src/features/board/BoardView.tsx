import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useOpenCard } from '../../app/nav.ts';
import { useDragSensors } from '../../lib/dnd.ts';
import { isOverdue } from '../../lib/cards.ts';
import { optimisticMove, useMoveCard } from '../../lib/mutations.ts';
import { useBoardIndex, type BoardIndex } from '../../lib/queries.ts';
import { useStore } from '../../lib/store.ts';
import { filtersStore, openPalette, prefsStore } from '../../lib/ui-state.ts';
import { fmtDay, nowMs } from '../../lib/time.ts';
import { Button } from '../../components/ui/Button.tsx';
import { ErrorNote, ProjectDot, Skeleton } from '../../components/ui/bits.tsx';
import { CardTile } from './CardTile.tsx';
import { BoardColumn } from './Column.tsx';
import { FilterBar } from './FilterBar.tsx';
import { FirstRun } from './FirstRun.tsx';
import { buildLanes, columnOfContainer, laneOfContainer, type Lane } from './lanes.ts';

export function BoardView() {
  const { index, isPending, isError, error, refetch } = useBoardIndex();
  if (isPending) return <BoardSkeleton />;
  if (isError || !index)
    return (
      <div className="p-6">
        <ErrorNote message={`Couldn’t load the board. ${error instanceof Error ? error.message : ''}`} onRetry={() => void refetch()} />
      </div>
    );
  return <Board index={index} />;
}

function Board({ index }: { index: BoardIndex }) {
  const filters = useStore(filtersStore);
  const groupBy = useStore(prefsStore, (p) => p.groupBy);
  const showAllDone = useStore(prefsStore, (p) => p.showAllDone);
  const openCard = useOpenCard();
  const { lanes, shown, total } = useMemo(() => buildLanes(index, filters, groupBy, showAllDone), [index, filters, groupBy, showAllDone]);
  const { board } = index;
  const empty = board.cards.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BoardHeader index={index} />
      <FilterBar board={board} shown={shown} total={total} />
      {empty ? <FirstRun /> : null}
      <BoardDnd index={index} lanes={lanes} grouped={groupBy !== 'none'} onOpen={openCard} />
    </div>
  );
}

/** The title row and the board's one finding: what needs attention right now. */
function BoardHeader({ index }: { index: BoardIndex }) {
  const { board, colById } = index;
  const now = nowMs();
  const open = board.cards.filter((c) => colById.get(c.column_id)?.kind !== 'done');
  const overdue = open.filter((c) => isOverdue(c, board.today, now)).length;
  const blocked = open.filter((c) => c.blocked_reason).length;
  const review = open.filter((c) => c.needs_review).length;
  const parts: string[] = [fmtDay(board.today)];
  parts.push(`${open.length} open`);
  if (overdue) parts.push(`${overdue} overdue`);
  if (blocked) parts.push(`${blocked} blocked`);
  if (review) parts.push(`${review} for you to check`);
  return (
    <div className="flex flex-none items-end justify-between gap-4 px-4 pt-4 pb-3 md:px-6 md:pt-5">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Board</h1>
        <p className="mt-0.5 truncate text-sm text-muted">
          {parts.map((p, i) => (
            <span key={p} className={i > 0 && /overdue|blocked/.test(p) ? 'text-text' : undefined}>
              {i > 0 ? <span className="px-1.5 text-faint">·</span> : null}
              {p}
            </span>
          ))}
        </p>
      </div>
      <div className="hidden md:block">
        <Button variant="primary" icon={Plus} onClick={() => openPalette('add')}>
          New card
        </Button>
      </div>
    </div>
  );
}

type Items = Record<string, number[]>;
const toItems = (lanes: Lane[]): Items => Object.fromEntries(lanes.flatMap((l) => l.containers.map((c) => [c.id, c.cards.map((x) => x.id)])));

function BoardDnd({ index, lanes, grouped, onOpen }: { index: BoardIndex; lanes: Lane[]; grouped: boolean; onOpen: (id: number) => void }) {
  const move = useMoveCard();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Items | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const items = useMemo(() => draft ?? toItems(lanes), [draft, lanes]);
  const { board, cardById, projectById, cardsByColumn } = index;

  const sensors = useDragSensors(5, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } });

  const findContainer = useCallback(
    (id: UniqueIdentifier, from: Items): string | undefined => {
      if (typeof id === 'string' && id in from) return id;
      return Object.keys(from).find((k) => from[k].includes(Number(id)));
    },
    [],
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    const start = toItems(lanes);
    setActiveId(Number(active.id));
    setDraft(start);
    setOrigin(findContainer(active.id, start) ?? null);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !draft) return;
    const from = findContainer(active.id, draft);
    const to = findContainer(over.id, draft);
    if (!from || !to || from === to) return;
    if (laneOfContainer(from) !== laneOfContainer(to)) return; // swimlanes: move between columns only
    setDraft((d) => {
      if (!d) return d;
      const src = d[from].filter((x) => x !== Number(active.id));
      const dst = [...d[to]];
      const overIdx = dst.indexOf(Number(over.id));
      const at = overIdx >= 0 ? overIdx + (active.rect.current.translated && over.rect && active.rect.current.translated.top > over.rect.top + over.rect.height / 2 ? 1 : 0) : dst.length;
      dst.splice(at, 0, Number(active.id));
      return { ...d, [from]: src, [to]: dst };
    });
  };

  const reset = () => {
    setActiveId(null);
    setDraft(null);
    setOrigin(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!draft || !over) return reset();
    const id = Number(active.id);
    const cont = findContainer(active.id, draft);
    const overCont = findContainer(over.id, draft);
    if (!cont) return reset();
    let list = draft[cont];
    if (overCont === cont) {
      const oldIdx = list.indexOf(id);
      const newIdx = list.indexOf(Number(over.id));
      if (newIdx >= 0 && oldIdx !== newIdx) list = arrayMove(list, oldIdx, newIdx);
    }
    const idx = list.indexOf(id);
    const columnId = columnOfContainer(cont);
    const card = cardById.get(id);
    const before_id = idx > 0 ? list[idx - 1] : null;
    const after_id = idx < list.length - 1 ? list[idx + 1] : null;
    const original = origin ? toItems(lanes)[origin] : [];
    const unchanged = card && card.column_id === columnId && cont === origin && original.indexOf(id) === idx;
    if (!unchanged) {
      const v = { id, column_id: columnId, before_id, after_id };
      const prev = optimisticMove(v);
      move.mutate({ ...v, prev });
    }
    reset();
  };

  const colName = (container: string | undefined) => (container ? index.colById.get(columnOfContainer(container))?.name : undefined) ?? 'a column';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up card ${cardById.get(Number(active.id))?.title ?? active.id}.`,
    onDragOver: ({ active, over }) => (over ? `Card ${cardById.get(Number(active.id))?.title ?? ''} is over ${colName(findContainer(over.id, items))}.` : 'Not over a column.'),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${cardById.get(Number(active.id))?.title ?? 'card'} in ${colName(findContainer(over.id, items))}.` : 'Drop cancelled.'),
    onDragCancel: () => 'Move cancelled. The card is back where it was.',
  };

  const activeCard = activeId !== null ? cardById.get(activeId) : undefined;
  const containerCards = (id: string) => (items[id] ?? []).map((cid) => cardById.get(cid)).filter((c): c is NonNullable<typeof c> => !!c);
  const columnTotal = (columnId: number) => cardsByColumn.get(columnId)?.length ?? 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{ announcements, screenReaderInstructions: { draggable: 'Press Space to pick up the card. Use the arrow keys to move it between columns and positions, Space to drop, Escape to cancel. Enter opens the card.' } }}
    >
      {grouped ? (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-6">
          <div className="sticky top-0 z-10 flex w-max gap-4 bg-ground pb-2">
            {index.columns.map((col) => (
              <div key={col.id} className="flex h-9 w-[284px] items-center gap-2 px-1 sm:w-[296px]">
                <h2 className="text-[13px] font-semibold">{col.name}</h2>
                <span className="num text-xs text-faint">{lanes.reduce((n, l) => n + (items[`${l.key}::${col.id}`]?.length ?? 0), 0)}</span>
                {col.wip_limit !== null ? <span className="num text-[11px] text-faint">{columnTotal(col.id)}/{col.wip_limit}</span> : null}
              </div>
            ))}
          </div>
          {lanes.map((lane) => (
            <section key={lane.key} aria-label={`${lane.label} lane`} className="mb-4 w-max">
              <h3 className="sticky left-0 flex h-8 items-center gap-2 text-xs font-medium text-muted">
                {lane.color ? <ProjectDot color={lane.color} /> : null}
                {lane.label}
                <span className="num text-faint">{lane.count}</span>
              </h3>
              <div className="flex gap-4 border-t border-rule pt-2">
                {lane.containers.map((c) => (
                  <BoardColumn
                    key={c.id}
                    containerId={c.id}
                    column={c.column}
                    cards={containerCards(c.id)}
                    total={columnTotal(c.column.id)}
                    projects={projectById}
                    today={board.today}
                    focusMin={board.settings.focus_min}
                    onOpen={onOpen}
                    compact
                    showQuickAdd={false}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="scroll-x-snap flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 md:gap-4 md:px-6">
          {lanes[0]?.containers.map((c) => (
            <BoardColumn
              key={c.id}
              containerId={c.id}
              column={c.column}
              cards={containerCards(c.id)}
              total={columnTotal(c.column.id)}
              hiddenDone={c.hiddenDone}
              onShowAllDone={() => prefsStore.set((p) => ({ ...p, showAllDone: true }))}
              projects={projectById}
              today={board.today}
              focusMin={board.settings.focus_min}
              onOpen={onOpen}
              showQuickAdd={c.column.kind !== 'done'}
            />
          ))}
          <div aria-hidden className="w-px flex-none" />
        </div>
      )}
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
        {activeCard ? (
          <CardTile
            card={activeCard}
            project={activeCard.project_id !== null ? projectById.get(activeCard.project_id) : undefined}
            today={board.today}
            focusMin={board.settings.focus_min}
            done={index.doneIds.has(activeCard.column_id)}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardSkeleton() {
  const heights = [[88, 64, 104, 72], [72, 96, 64], [104, 80], [72], [64, 64, 64]];
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading the board">
      <div className="px-4 pt-4 pb-3 md:px-6 md:pt-5">
        <h1 className="text-[20px] font-semibold leading-7">Board</h1>
        <Skeleton className="mt-1.5 h-4 w-72" />
      </div>
      <div className="px-4 pb-3 md:px-6">
        <Skeleton className="h-7 w-72" />
      </div>
      <div className="flex gap-4 overflow-hidden px-4 md:px-6">
        {heights.map((col, i) => (
          <div key={i} className="w-[296px] flex-none">
            <Skeleton className="mx-1 my-2.5 h-4 w-24" />
            <div className="flex flex-col gap-2 p-1">
              {col.map((h, j) => (
                <div key={j} className="rounded-lg border border-border bg-surface p-3" style={{ height: h }}>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-2 h-3.5 w-4/5" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
