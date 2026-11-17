// List: every card as a sortable table, with multi-select bulk actions.
import { useMemo, useState } from 'react';
import { useUrlState } from '../../lib/url-state.ts';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Search, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Card } from '../../../../src/core/types.ts';
import { useOpenCard } from '../../app/nav.ts';
import { api } from '../../lib/api.ts';
import { PRIORITY_SHORT, matchesFilters } from '../../lib/cards.ts';
import { errorMessage, undoBatch, useWrite } from '../../lib/mutations.ts';
import { invalidateAll, useBoardIndex, useCards, type BoardIndex } from '../../lib/queries.ts';
import { useStore } from '../../lib/store.ts';
import { EMPTY_FILTERS, activeFilterCount, filtersStore } from '../../lib/ui-state.ts';
import { fmtAgo, fmtMinutes, useNow } from '../../lib/time.ts';
import { AnnMark, ErrorNote, ProjectDot, Skeleton } from '../../components/ui/bits.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Checkbox, Select, Tabs } from '../../components/ui/form.tsx';
import { cn } from '../../components/ui/cn.ts';
import { DueChip, PriorityGlyph } from '../board/CardTile.tsx';
import { FilterControls } from '../board/FilterBar.tsx';

type View = 'open' | 'done' | 'archived';
type SortKey = 'id' | 'title' | 'column' | 'priority' | 'due' | 'estimate' | 'updated';

export default function ListView() {
  const [view, setView] = useUrlState<View>('show', 'open', ['open', 'done', 'archived']);
  const { index, isPending, isError, refetch } = useBoardIndex();
  const archived = useCards({ archived: true, limit: 500 }, view === 'archived');
  const filters = useStore(filtersStore);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'updated', dir: -1 });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const now = useNow(60_000);

  const rows = useMemo(() => {
    if (!index) return [];
    const { board, doneIds, colById, projectById } = index;
    const source = view === 'archived' ? (archived.data?.items ?? []) : board.cards.filter((c) => (view === 'done') === doneIds.has(c.column_id));
    const list = source.filter((c) => matchesFilters(c, filters, board.today, c.project_id !== null ? projectById.get(c.project_id)?.name : undefined));
    const val = (c: Card): string | number => {
      switch (sort.key) {
        case 'id':
          return c.id;
        case 'title':
          return c.title.toLowerCase();
        case 'column':
          return colById.get(c.column_id)?.position ?? 0;
        case 'priority':
          return c.priority;
        case 'due':
          return c.due_at ?? (sort.dir === 1 ? Number.MAX_SAFE_INTEGER : -1);
        case 'estimate':
          return c.estimate_min ?? -1;
        case 'updated':
          return c.updated_at;
      }
    };
    return list.toSorted((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.id - a.id;
    });
  }, [index, view, archived.data, filters, sort]);

  const visibleIds = rows.map((r) => r.id);
  const chosen = visibleIds.filter((id) => selected.has(id));
  const allOn = chosen.length > 0 && chosen.length === visibleIds.length;
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(visibleIds));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (isError) return <div className="p-6"><ErrorNote message="Couldn’t load cards." onRetry={() => void refetch()} /></div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-4 pt-4 md:px-6 md:pt-5">
        <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">List</h1>
        <p className="mt-0.5 text-sm text-muted">
          <span className="num">{rows.length}</span> {view === 'archived' ? 'archived' : view} cards{activeFilterCount(filters) ? ' match the filters' : ''}
        </p>
        <Tabs
          className="mt-3"
          label="Which cards"
          value={view}
          onChange={(v) => {
            setView(v);
            setSelected(new Set());
          }}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5 pb-3">
          <div className="relative w-full sm:w-64">
            <Search size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              aria-label="Search cards"
              value={filters.q}
              onChange={(e) => filtersStore.set((f) => ({ ...f, q: e.target.value }))}
              placeholder="Filter cards…"
              className="h-7 w-full rounded-md border border-border bg-surface pl-8 pr-2 text-xs hover:border-border-strong focus:border-accent focus:outline-none"
            />
          </div>
          {index ? <FilterControls board={index.board} /> : null}
          {activeFilterCount(filters) ? (
            <button type="button" onClick={() => filtersStore.set(EMPTY_FILTERS)} className="inline-flex h-7 items-center gap-1 px-1.5 text-xs text-muted hover:text-text">
              <X size={12} strokeWidth={1.75} aria-hidden /> Clear
            </button>
          ) : null}
        </div>
      </div>

      {chosen.length && index ? <BulkBar ids={chosen} view={view} index={index} onDone={() => setSelected(new Set())} /> : null}

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-8 md:px-6">
        {isPending || (view === 'archived' && archived.isPending) || !index ? (
          <div className="space-y-px">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex h-11 items-center gap-4 border-b border-rule">
                <Skeleton className="size-4" />
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-3.5 w-1/3" />
              </div>
            ))}
          </div>
        ) : rows.length ? (
          <>
            <table className="hidden w-full border-collapse text-sm md:table">
              <thead className="sticky top-0 z-[1] bg-ground">
                <tr className="h-9 border-b border-border text-left text-xs text-faint">
                  <th scope="col" className="w-8 font-normal">
                    <Checkbox checked={allOn} indeterminate={chosen.length > 0 && !allOn} onChange={toggleAll} label="Select all" />
                  </th>
                  <Th k="id" sort={sort} setSort={setSort} className="w-14">ID</Th>
                  <Th k="title" sort={sort} setSort={setSort}>Title</Th>
                  <Th k="column" sort={sort} setSort={setSort} className="w-32">Column</Th>
                  <Th k="priority" sort={sort} setSort={setSort} className="w-20">Priority</Th>
                  <Th k="due" sort={sort} setSort={setSort} className="w-32">Due</Th>
                  <Th k="estimate" sort={sort} setSort={setSort} className="w-24 text-right" right>Estimate</Th>
                  <Th k="updated" sort={sort} setSort={setSort} className="w-28 text-right" right>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Row key={c.id} card={c} index={index} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} now={now} />
                ))}
              </tbody>
            </table>
            <ul className="md:hidden">
              {rows.map((c) => (
                <MobileRow key={c.id} card={c} index={index} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} />
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 rounded-md border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
            {activeFilterCount(filters) ? 'No cards match these filters.' : view === 'archived' ? 'Nothing archived. Archived cards wait here until you restore or delete them.' : view === 'done' ? 'Nothing done yet.' : 'No open cards.'}
          </p>
        )}
      </div>
    </div>
  );
}

function Th({ k, sort, setSort, children, className, right }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void; children: string; className?: string; right?: boolean }) {
  const active = sort.key === k;
  const Icon = sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('font-normal', className)}>
      <button type="button" onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : k === 'updated' ? -1 : 1 })} className={cn('inline-flex h-9 items-center gap-1 hover:text-text', right && 'flex-row-reverse', active && 'text-muted')}>
        {children}
        {active ? <Icon size={11} strokeWidth={2} aria-hidden /> : null}
      </button>
    </th>
  );
}

function Row({ card, index, selected, onToggle, now }: { card: Card; index: BoardIndex; selected: boolean; onToggle: () => void; now: number }) {
  const openCard = useOpenCard();
  const project = card.project_id !== null ? index.projectById.get(card.project_id) : undefined;
  return (
    <tr className={cn('group h-11 cursor-pointer border-b border-rule', selected ? 'bg-active' : 'hover:bg-raised')} onClick={() => openCard(card.id)}>
      <td onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onChange={onToggle} label={`Select #${card.id}`} />
      </td>
      <td className="num text-xs text-faint">#{card.id}</td>
      <td className="max-w-0 pr-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={(e) => (e.stopPropagation(), openCard(card.id))} className="truncate text-left text-text hover:underline hover:decoration-faint">
            {card.title}
          </button>
          {card.created_by === 'ann' ? <AnnMark size={13} client={card.created_client} /> : null}
          {card.planned_for === index.board.today ? <Star size={12} strokeWidth={0} fill="var(--accent)" aria-label="Planned for today" /> : null}
          {project ? (
            <span className="ml-1 hidden flex-none items-center gap-1.5 text-xs text-faint lg:flex">
              <ProjectDot color={project.color} className="size-1.5" />
              {project.name}
            </span>
          ) : null}
        </div>
      </td>
      <td className="truncate text-xs text-muted">{index.colById.get(card.column_id)?.name}</td>
      <td>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <PriorityGlyph priority={card.priority} />
          <span className="num">{PRIORITY_SHORT[card.priority]}</span>
        </span>
      </td>
      <td>{card.due_at !== null ? <DueChip card={card} today={index.board.today} /> : <span className="text-faint">—</span>}</td>
      <td className="num text-right text-xs text-muted">{card.estimate_min !== null ? fmtMinutes(card.estimate_min) : <span className="text-faint">—</span>}</td>
      <td className="num text-right text-xs text-faint">{fmtAgo(card.updated_at, now)}</td>
    </tr>
  );
}

function MobileRow({ card, index, selected, onToggle }: { card: Card; index: BoardIndex; selected: boolean; onToggle: () => void }) {
  const openCard = useOpenCard();
  const project = card.project_id !== null ? index.projectById.get(card.project_id) : undefined;
  return (
    <li className={cn('flex items-center gap-3 border-b border-rule py-2.5', selected && 'bg-active')}>
      <Checkbox checked={selected} onChange={onToggle} label={`Select #${card.id}`} />
      <button type="button" onClick={() => openCard(card.id)} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-text">{card.title}</span>
          {card.priority <= 1 ? <PriorityGlyph priority={card.priority} /> : null}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[13px] text-faint">
          <span className="num">#{card.id}</span>
          <span>{index.colById.get(card.column_id)?.name}</span>
          {project ? (
            <span className="flex items-center gap-1">
              <ProjectDot color={project.color} className="size-1.5" />
              {project.name}
            </span>
          ) : null}
        </span>
      </button>
      <DueChip card={card} today={index.board.today} />
    </li>
  );
}

function BulkBar({ ids, view, index, onDone }: { ids: number[]; view: View; index: BoardIndex; onDone: () => void }) {
  const archive = useWrite(() => api.archive(ids));
  const restore = useWrite(() => api.restore(ids));
  const plan = useWrite(() => {
    const current = index.board.cards.filter((c) => c.planned_for === index.board.today).map((c) => c.id);
    return api.setPlan([...new Set([...current, ...ids])]);
  });
  const [moving, setMoving] = useState(false);

  const moveAll = async (columnId: number) => {
    setMoving(true);
    const batches: string[] = [];
    try {
      for (const id of ids) {
        const card = index.cardById.get(id);
        if (!card || card.column_id === columnId) continue;
        const r = await api.patchCard(id, { column_id: columnId, version: card.version });
        batches.push(r.batch.id);
      }
      const name = index.colById.get(columnId)?.name;
      toast(`Moved ${batches.length} card${batches.length === 1 ? '' : 's'} to ${name}`, {
        action: { label: 'Undo', onClick: () => void (async () => { for (const b of batches.toReversed()) await undoBatch(b); })() },
      });
      onDone();
    } catch (err) {
      toast.error('Some cards didn’t move', { description: errorMessage(err) });
    } finally {
      setMoving(false);
      void invalidateAll();
    }
  };

  return (
    <div role="toolbar" aria-label="Bulk actions" className="mx-4 mb-2 flex flex-none flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-raised px-3 py-2 md:mx-6">
      <span className="num text-sm text-text">{ids.length} selected</span>
      <span className="mx-1 h-4 w-px bg-border-strong" aria-hidden />
      {view !== 'archived' ? (
        <>
          <Select aria-label="Move selected to column" value="" disabled={moving} onChange={(e) => void moveAll(Number(e.target.value))} className="w-40">
            <option value="" disabled>
              {moving ? 'Moving…' : 'Move to…'}
            </option>
            {index.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button size="sm" icon={Star} onClick={() => plan.mutate(undefined, { onSuccess: onDone })}>
            Plan for today
          </Button>
          <Button size="sm" icon={Archive} onClick={() => archive.mutate(undefined, { onSuccess: onDone })}>
            Archive
          </Button>
        </>
      ) : (
        <Button size="sm" icon={ArchiveRestore} onClick={() => restore.mutate(undefined, { onSuccess: onDone })}>
          Restore
        </Button>
      )}
      <button type="button" onClick={onDone} className="ml-auto text-xs text-muted hover:text-text">
        Clear selection
      </button>
    </div>
  );
}
