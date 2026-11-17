import { useRef, useState, type ReactNode } from 'react';
import { Ban, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import type { BoardSnapshot, Priority } from '../../../../src/core/types.ts';
import { PRIORITY_NAME, PRIORITY_SHORT } from '../../lib/cards.ts';
import { useStore } from '../../lib/store.ts';
import { EMPTY_FILTERS, activeFilterCount, filtersStore, overlayStore, prefsStore, type BoardFilters, type DueFilter } from '../../lib/ui-state.ts';
import { AnnMark, Kbd, ProjectDot } from '../../components/ui/bits.tsx';
import { MenuItem, Popover } from '../../components/ui/overlay.tsx';
import { cn } from '../../components/ui/cn.ts';

const set = (patch: Partial<BoardFilters>) => filtersStore.set((f) => ({ ...f, ...patch }));

function FilterMenu({ label, value, active, children, wide }: { label: string; value?: ReactNode; active: boolean; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-7 flex-none items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
          active ? 'border-[color-mix(in_oklab,var(--accent)_55%,var(--border))] text-text' : 'border-border text-muted hover:border-border-strong hover:text-text',
        )}
      >
        {label}
        {value ? <span className="max-w-32 truncate text-text">{value}</span> : null}
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden className="text-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={`${label} filter`} className={wide ? 'max-h-80 w-60 overflow-y-auto' : undefined}>
        {children(() => setOpen(false))}
      </Popover>
    </>
  );
}

function Toggle({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 flex-none items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
        on ? 'border-[color-mix(in_oklab,var(--accent)_55%,var(--border))] text-text' : 'border-border text-muted hover:border-border-strong hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

export function FilterControls({ board }: { board: BoardSnapshot }) {
  const f = useStore(filtersStore);
  const project = f.project !== null ? board.projects.find((p) => p.id === f.project) : undefined;
  const dueLabel: Record<Exclude<DueFilter, null>, string> = { overdue: 'Overdue', today: 'Due today', week: 'Next 7 days' };
  const tags = board.tags.toSorted((a, b) => b.count - a.count);
  return (
    <>
      <FilterMenu label="Project" value={project?.name} active={!!project} wide>
        {(close) => (
          <div role="menu">
            <MenuItem selected={f.project === null} onSelect={() => (set({ project: null }), close())}>
              Any project
            </MenuItem>
            {board.projects
              .filter((p) => !p.archived_at)
              .map((p) => (
                <MenuItem key={p.id} selected={f.project === p.id} onSelect={() => (set({ project: p.id }), close())}>
                  <ProjectDot color={p.color} />
                  <span className="truncate">{p.name}</span>
                </MenuItem>
              ))}
          </div>
        )}
      </FilterMenu>
      <FilterMenu label="Tag" value={f.tag ? `#${f.tag}` : undefined} active={!!f.tag} wide>
        {(close) => (
          <div role="menu">
            <MenuItem selected={!f.tag} onSelect={() => (set({ tag: null }), close())}>
              Any tag
            </MenuItem>
            {tags.map((t) => (
              <MenuItem key={t.id} selected={f.tag === t.name} onSelect={() => (set({ tag: t.name }), close())}>
                <span className="flex-1 truncate">#{t.name}</span>
                <span className="num text-xs text-faint">{t.count}</span>
              </MenuItem>
            ))}
            {!tags.length ? <p className="px-2 py-1.5 text-xs text-faint">No tags yet. Add “#tag” when you create a card.</p> : null}
          </div>
        )}
      </FilterMenu>
      <FilterMenu label="Priority" value={f.priority !== null ? PRIORITY_SHORT[f.priority] : undefined} active={f.priority !== null}>
        {(close) => (
          <div role="menu">
            <MenuItem selected={f.priority === null} onSelect={() => (set({ priority: null }), close())}>
              Any priority
            </MenuItem>
            {([0, 1, 2, 3] as Priority[]).map((p) => (
              <MenuItem key={p} selected={f.priority === p} onSelect={() => (set({ priority: p }), close())}>
                <span className="num w-6 text-xs text-muted">{PRIORITY_SHORT[p]}</span>
                {PRIORITY_NAME[p]}
              </MenuItem>
            ))}
          </div>
        )}
      </FilterMenu>
      <FilterMenu label="Due" value={f.due ? dueLabel[f.due] : undefined} active={!!f.due}>
        {(close) => (
          <div role="menu">
            <MenuItem selected={!f.due} onSelect={() => (set({ due: null }), close())}>
              Any time
            </MenuItem>
            {(['overdue', 'today', 'week'] as const).map((d) => (
              <MenuItem key={d} selected={f.due === d} onSelect={() => (set({ due: d }), close())}>
                {dueLabel[d]}
              </MenuItem>
            ))}
          </div>
        )}
      </FilterMenu>
      <Toggle on={f.blocked} onClick={() => set({ blocked: !f.blocked })} label="Only blocked cards">
        <Ban size={12} strokeWidth={1.75} aria-hidden />
        Blocked
      </Toggle>
      <Toggle on={f.ann} onClick={() => set({ ann: !f.ann })} label="Only cards Ann created">
        <AnnMark size={12} />
        Ann-created
      </Toggle>
    </>
  );
}

export function GroupByMenu() {
  const groupBy = useStore(prefsStore, (p) => p.groupBy);
  const label = { none: 'None', project: 'Project', priority: 'Priority' } as const;
  return (
    <FilterMenu label="Group" value={groupBy === 'none' ? undefined : label[groupBy]} active={groupBy !== 'none'}>
      {(close) => (
        <div role="menu">
          {(['none', 'project', 'priority'] as const).map((g) => (
            <MenuItem key={g} selected={groupBy === g} onSelect={() => (prefsStore.set((p) => ({ ...p, groupBy: g })), close())}>
              {g === 'none' ? 'No swimlanes' : `Swimlanes by ${label[g].toLowerCase()}`}
            </MenuItem>
          ))}
        </div>
      )}
    </FilterMenu>
  );
}

/** Search + filters. On phones the filters fold behind one button. */
export function FilterBar({ board, shown, total }: { board: BoardSnapshot; shown: number; total: number }) {
  const f = useStore(filtersStore);
  const filtersOpen = useStore(overlayStore, (s) => s.filtersOpen);
  const count = activeFilterCount(f);
  return (
    <div className="flex flex-none flex-col gap-2 px-4 pb-3 md:px-6">
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-72">
          <Search size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <label htmlFor="board-search" className="sr-only">
            Search cards
          </label>
          <input
            id="board-search"
            type="search"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                set({ q: '' });
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Filter cards…"
            autoComplete="off"
            className="h-7 w-full rounded-md border border-border bg-surface pl-8 pr-8 text-xs text-text hover:border-border-strong focus:border-accent focus:outline-none"
          />
          <Kbd className="pointer-events-none absolute right-1.5 top-1/2 h-4 -translate-y-1/2 text-[10px]">/</Kbd>
        </div>
        <div className="hidden flex-wrap items-center gap-1.5 lg:flex">
          <FilterControls board={board} />
        </div>
        <button
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => overlayStore.set((s) => ({ ...s, filtersOpen: !s.filtersOpen }))}
          className={cn('inline-flex h-7 flex-none items-center gap-1.5 rounded-md border px-2 text-xs lg:hidden', count ? 'border-[color-mix(in_oklab,var(--accent)_55%,var(--border))] text-text' : 'border-border text-muted')}
        >
          <SlidersHorizontal size={12} strokeWidth={1.75} aria-hidden />
          Filters{count ? <span className="num">{count}</span> : null}
        </button>
        {count ? (
          <>
            <span className="num hidden flex-none text-xs text-faint sm:inline" aria-live="polite">
              {shown} of {total}
            </span>
            <button type="button" onClick={() => filtersStore.set(EMPTY_FILTERS)} className="inline-flex h-7 flex-none items-center gap-1 rounded-md px-1.5 text-xs text-muted hover:text-text">
              <X size={12} strokeWidth={1.75} aria-hidden />
              Clear
            </button>
          </>
        ) : null}
        <div className="ml-auto hidden lg:block">
          <GroupByMenu />
        </div>
      </div>
      {filtersOpen ? (
        <div className="flex flex-wrap items-center gap-1.5 lg:hidden">
          <FilterControls board={board} />
          <GroupByMenu />
        </div>
      ) : null}
    </div>
  );
}
