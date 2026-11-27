// Columns, projects and tags.
import { useRef, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useDragSensors } from '../../lib/dnd.ts';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Column, ColumnKind, Tag } from '../../../../src/core/types.ts';
import { ApiError, api, type ProjectWithCounts } from '../../lib/api.ts';
import { batchToast, errorMessage, useWrite } from '../../lib/mutations.ts';
import { invalidateAll, useBoardIndex, useProjects } from '../../lib/queries.ts';
import { Button, IconButton } from '../../components/ui/Button.tsx';
import { ErrorNote, Pill, Skeleton } from '../../components/ui/bits.tsx';
import { Input, Select } from '../../components/ui/form.tsx';
import { Popover } from '../../components/ui/overlay.tsx';
import { cn } from '../../components/ui/cn.ts';
import { ColorPicker, Section } from './shared.tsx';

const KINDS: { value: ColumnKind; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'Doing' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
];

/** Text input that saves on blur/Enter when changed. */
function SaveOnBlur({ value, onSave, label, className, type = 'text', placeholder }: { value: string; onSave: (v: string) => void; label: string; className?: string; type?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  return (
    <Input
      aria-label={label}
      type={type}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={className}
    />
  );
}

function SwatchButton({ color, onChange, label, allowNone }: { color: string | null; onChange: (c: string | null) => void; label: string; allowNone?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" aria-label={label} title={label} onClick={() => setOpen((o) => !o)} className="flex size-8 flex-none items-center justify-center rounded-md border border-border-strong hover:border-control">
        {color ? <span className="size-3.5 rounded-full" style={{ background: color }} /> : <span className="size-3.5 rounded-full border border-dashed border-control" />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={label} className="p-3">
        <ColorPicker
          label={label}
          value={color}
          allowNone={allowNone}
          onChange={(c) => {
            onChange(c);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

function ColumnRow({ column, count }: { column: Column; count: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id });
  const patch = useWrite((b: Parameters<typeof api.patchColumn>[1]) => api.patchColumn(column.id, b), { toastId: () => `col-${column.id}` });
  const del = async () => {
    try {
      const r = await api.deleteColumn(column.id);
      batchToast(r.batch);
      void invalidateAll();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast.warning(`“${column.name}” still has cards`, { description: `Move or archive its ${count} card${count === 1 ? '' : 's'} first; a column must be empty to delete.` });
      else toast.error(errorMessage(err));
    }
  };
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('flex flex-wrap items-center gap-2 border-b border-rule py-2.5 last:border-0 sm:flex-nowrap', isDragging && 'relative z-10 rounded-md bg-raised shadow-[var(--shadow-float)]')}>
      <button type="button" {...attributes} {...listeners} aria-label={`Reorder ${column.name}`} className="flex h-8 w-6 flex-none cursor-grab items-center justify-center text-faint hover:text-text">
        <GripVertical size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <SwatchButton label={`${column.name} colour`} color={column.color} allowNone onChange={(c) => patch.mutate({ color: c })} />
      <SaveOnBlur label="Column name" value={column.name} onSave={(name) => name && patch.mutate({ name })} className="min-w-32 flex-1" />
      <Select aria-label="Kind" value={column.kind} onChange={(e) => patch.mutate({ kind: e.target.value as ColumnKind })} className="w-28">
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </Select>
      <SaveOnBlur label="WIP limit" type="number" placeholder="No limit…" value={column.wip_limit === null ? '' : String(column.wip_limit)} onSave={(v) => patch.mutate({ wip_limit: v ? Number(v) : null })} className="num w-24" />
      <span className="num w-16 text-right text-xs text-faint">{count} cards</span>
      <IconButton label={`Delete column ${column.name}`} icon={Trash2} size="sm" onClick={() => void del()} />
    </li>
  );
}

export function ColumnsSettings() {
  const { index, isPending, isError, refetch } = useBoardIndex();
  const [order, setOrder] = useState<number[] | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ColumnKind>('todo');
  const create = useWrite((b: { name: string; kind: ColumnKind }) => api.createColumn(b));
  const reorder = useWrite((ids: number[]) => api.reorderColumns(ids));
  const sensors = useDragSensors(4, { coordinateGetter: sortableKeyboardCoordinates });
  const columns = index ? (order ? order.map((id) => index.colById.get(id)).filter((c): c is Column => !!c) : index.columns) : [];

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = columns.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
    setOrder(next);
    reorder.mutate(next, { onSettled: () => setOrder(null) });
  };

  return (
    <Section
      id="s-columns"
      title="Columns"
      description={
        <>
          The flow cards move through, left to right. The <em>kind</em> tells Ann what a column means (doing, done…). WIP limits warn, never block. A column must be empty before you delete it.
        </>
      }
    >
      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <ErrorNote message="Couldn’t load columns." onRetry={() => void refetch()} />
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={columns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <ul>
                {columns.map((c) => (
                  <ColumnRow key={c.id} column={c} count={index!.cardsByColumn.get(c.id)?.length ?? 0} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <form
            className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate({ name: name.trim(), kind }, { onSuccess: () => setName('') });
            }}
          >
            <Input aria-label="New column name" placeholder="New column name…" value={name} onChange={(e) => setName(e.target.value)} className="min-w-40 flex-1" />
            <Select aria-label="New column kind" value={kind} onChange={(e) => setKind(e.target.value as ColumnKind)} className="w-28">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
            <Button type="submit" icon={Plus} disabled={!name.trim() || create.isPending}>
              Add column
            </Button>
          </form>
        </>
      )}
    </Section>
  );
}

function ProjectRow({ p }: { p: ProjectWithCounts }) {
  const patch = useWrite((b: Parameters<typeof api.patchProject>[1]) => api.patchProject(p.id, b), { toastId: () => `proj-${p.id}` });
  const archived = !!p.archived_at;
  return (
    <li className={cn('flex flex-wrap items-center gap-2 border-b border-rule py-2.5 last:border-0 sm:flex-nowrap', archived && 'opacity-70')}>
      <SwatchButton label={`${p.name} colour`} color={p.color} onChange={(c) => c && patch.mutate({ color: c })} />
      <SaveOnBlur label="Project name" value={p.name} onSave={(name) => name && patch.mutate({ name })} className="w-44" />
      <SaveOnBlur label="Description" placeholder="Description…" value={p.description ?? ''} onSave={(d) => patch.mutate({ description: d || null })} className="min-w-40 flex-1" />
      <span className="num w-24 text-right text-xs text-faint">
        {p.open} open · {p.done} done
      </span>
      <Button size="sm" variant="ghost" onClick={() => patch.mutate({ archived: !archived })} className="w-20">
        {archived ? 'Restore' : 'Archive'}
      </Button>
    </li>
  );
}

export function ProjectsSettings() {
  const q = useProjects();
  const [name, setName] = useState('');
  const create = useWrite((n: string) => api.createProject({ name: n }));
  const items = q.data?.items ?? [];
  return (
    <Section id="s-projects" title="Projects" description="Projects show as a coloured dot on cards and filter the board from the sidebar. Archiving hides a project but keeps its cards.">
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <ErrorNote message="Couldn’t load projects." onRetry={() => void q.refetch()} />
      ) : (
        <>
          <ul>
            {items
              .toSorted((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || a.name.localeCompare(b.name))
              .map((p) => (
                <ProjectRow key={p.id} p={p} />
              ))}
          </ul>
          {!items.length ? <p className="text-sm text-faint">No projects yet. Type “@name” in quick add, or create one here.</p> : null}
          <form
            className="mt-3 flex items-center gap-2 border-t border-rule pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate(name.trim(), { onSuccess: () => setName('') });
            }}
          >
            <Input aria-label="New project name" placeholder="New project…" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
            <Button type="submit" icon={Plus} disabled={!name.trim()}>
              Add project
            </Button>
          </form>
        </>
      )}
    </Section>
  );
}

function TagRow({ tag, all }: { tag: Tag; all: Tag[] }) {
  const patch = useWrite((b: { name?: string; color?: string | null }) => api.patchTag(tag.id, b), { toastId: () => `tag-${tag.id}` });
  const merge = useWrite((target: number) => api.mergeTags(tag.id, target));
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-rule py-2.5 last:border-0 sm:flex-nowrap">
      <SwatchButton label={`#${tag.name} colour`} color={tag.color} allowNone onChange={(c) => patch.mutate({ color: c })} />
      <div className="relative min-w-32 flex-1">
        <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-faint">
          #
        </span>
        <SaveOnBlur label="Tag name" value={tag.name} onSave={(name) => name && patch.mutate({ name: name.replace(/^#/, '') })} className="pl-6" />
      </div>
      <Pill className="num">{tag.count} cards</Pill>
      <Select
        aria-label={`Merge #${tag.name} into`}
        value=""
        onChange={(e) => {
          const target = all.find((t) => t.id === Number(e.target.value));
          if (target && window.confirm(`Merge #${tag.name} into #${target.name}? Cards tagged #${tag.name} get #${target.name}, and #${tag.name} goes away.`)) merge.mutate(target.id);
        }}
        className="w-40"
      >
        <option value="" disabled>
          Merge into…
        </option>
        {all
          .filter((t) => t.id !== tag.id)
          .map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
      </Select>
    </li>
  );
}

export function TagsSettings() {
  const { index, isPending } = useBoardIndex();
  const tags = (index?.board.tags ?? []).toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return (
    <Section id="s-tags" title="Tags" description="Rename a tag everywhere at once, or merge duplicates (“#bugs” into “#bug”). New tags come from cards.">
      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : tags.length ? (
        <ul>
          {tags.map((t) => (
            <TagRow key={t.id} tag={t} all={tags} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">No tags yet. Type “#tag” in quick add.</p>
      )}
    </Section>
  );
}
