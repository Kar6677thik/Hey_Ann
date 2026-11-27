import { memo, useState, type KeyboardEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import type { Card, Column as ColumnT, Project } from '../../../../src/core/types.ts';
import { useStore } from '../../lib/store.ts';
import { touchedStore } from '../../lib/ui-state.ts';
import { cn } from '../../components/ui/cn.ts';
import { CardTile } from './CardTile.tsx';
import { QuickAdd } from './QuickAdd.tsx';

/** A number that slides when it changes (column counts). */
export function Ticker({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('num relative inline-flex overflow-hidden', className)} aria-label={String(value)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={value} aria-hidden initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

interface SortableCardProps {
  card: Card;
  project?: Project;
  today: string;
  focusMin: number;
  done: boolean;
  onOpen: (id: number) => void;
}
const SortableCard = memo(function SortableCard({ card, project, today, focusMin, done, onOpen }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card' } });
  const touched = useStore(touchedStore, (s) => s[card.id] !== undefined);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(card.id);
      return;
    }
    listeners?.onKeyDown?.(e);
  };
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(card.id)}
      aria-roledescription="Draggable card"
      aria-label={`#${card.id} ${card.title}. Enter to open, Space to move.`}
      className="cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:cursor-grabbing"
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <CardTile card={card} project={project} today={today} focusMin={focusMin} done={done} touched={touched} dragging={isDragging} />
      </motion.div>
    </div>
  );
});

export interface ColumnProps {
  containerId: string;
  column: ColumnT;
  cards: Card[];
  /** Total in the column (all lanes, unfiltered) for the WIP indicator. */
  total: number;
  hiddenDone?: number;
  onShowAllDone?: () => void;
  projects: Map<number, Project>;
  today: string;
  focusMin: number;
  onOpen: (id: number) => void;
  compact?: boolean;
  showQuickAdd?: boolean;
}

export function BoardColumn({ containerId, column, cards, total, hiddenDone, onShowAllDone, projects, today, focusMin, onOpen, compact, showQuickAdd = true }: ColumnProps) {
  const [adding, setAdding] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: containerId, data: { type: 'column', columnId: column.id } });
  const over = column.wip_limit !== null && total > column.wip_limit;
  const done = column.kind === 'done';
  const headingId = `col-${containerId}`;

  return (
    <section aria-labelledby={headingId} className={cn('flex min-h-0 w-[284px] flex-none snap-start flex-col sm:w-[296px]', compact ? '' : 'max-h-full')}>
      {compact ? null : (
        <header className="flex h-9 flex-none items-center gap-2 px-1">
          {column.color ? <span aria-hidden className="size-2 rounded-sm" style={{ background: column.color }} /> : null}
          <h2 id={headingId} className="truncate text-[13px] font-semibold text-text">
            {column.name}
          </h2>
          <Ticker value={cards.length} className="text-xs text-faint" />
          {column.wip_limit !== null ? (
            <span
              className={cn('num ml-1 inline-flex h-5 items-center rounded px-1.5 text-[11px]', over ? 'bg-[var(--pill-warning-bg)] text-[var(--pill-warning-ink)]' : 'text-faint')}
              title={over ? `Over the WIP limit of ${column.wip_limit}` : `WIP limit ${column.wip_limit}`}
              aria-label={`${total} of ${column.wip_limit} work-in-progress limit${over ? ', over the limit' : ''}`}
            >
              {total}/{column.wip_limit}
            </span>
          ) : null}
          {showQuickAdd ? (
            <button type="button" onClick={() => setAdding(true)} aria-label={`Add a card to ${column.name}`} title="Add card" className="ml-auto rounded-md p-1 text-faint hover:bg-raised hover:text-text">
              <Plus size={15} strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </header>
      )}
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-16 flex-col gap-2 rounded-lg p-1 transition-colors duration-150',
          compact ? '' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
          isOver && 'bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]',
        )}
      >
        <SortableContext id={containerId} items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <AnimatePresence initial={false}>
            {cards.map((card) => (
              <SortableCard key={card.id} card={card} project={card.project_id !== null ? projects.get(card.project_id) : undefined} today={today} focusMin={focusMin} done={done} onOpen={onOpen} />
            ))}
          </AnimatePresence>
        </SortableContext>
        {cards.length === 0 && !adding ? (
          <div className="flex h-14 flex-none items-center justify-center rounded-lg border border-dashed border-border text-xs text-faint">{done ? 'Finished cards land here' : 'Drop cards here'}</div>
        ) : null}
        {hiddenDone ? (
          <button type="button" onClick={onShowAllDone} className="h-8 flex-none rounded-md text-xs text-faint hover:bg-raised hover:text-text">
            Show all · <span className="num">{hiddenDone}</span> older
          </button>
        ) : null}
        {showQuickAdd && !done ? <QuickAdd columnId={column.id} columnName={column.name} open={adding} setOpen={setAdding} /> : null}
      </div>
    </section>
  );
}
