import { useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import type { Card, ChecklistItem } from '../../../../src/core/types.ts';
import { Checkbox } from '../../components/ui/form.tsx';
import { cn } from '../../components/ui/cn.ts';
import { useCardSave } from './useCardSave.ts';

function Item({ item, onToggle, onEdit, onRemove }: { item: ChecklistItem; onToggle: () => void; onEdit: (t: string) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [text, setText] = useState(item.text);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group flex min-h-8 items-center gap-2 rounded-md pr-1 hover:bg-raised', isDragging && 'relative z-10 bg-raised shadow-[var(--shadow-float)]')}
    >
      <button type="button" {...attributes} {...listeners} aria-label={`Reorder “${item.text}”`} className="flex h-8 w-5 flex-none cursor-grab items-center justify-center text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
        <GripVertical size={13} strokeWidth={1.75} aria-hidden />
      </button>
      <Checkbox checked={item.done} onChange={onToggle} label={item.text} />
      <input
        value={text}
        aria-label="Checklist item"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() && text.trim() !== item.text) onEdit(text.trim());
          else setText(item.text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setText(item.text);
          }
        }}
        className={cn('h-8 min-w-0 flex-1 bg-transparent text-sm outline-none', item.done ? 'text-faint line-through decoration-faint' : 'text-text')}
      />
      <button type="button" onClick={onRemove} aria-label={`Remove “${item.text}”`} className="rounded p-1 text-faint opacity-0 hover:text-text group-hover:opacity-100 focus-visible:opacity-100">
        <X size={13} strokeWidth={1.75} aria-hidden />
      </button>
    </li>
  );
}

export function Checklist({ card }: { card: Card }) {
  const { save } = useCardSave(card.id);
  const [draft, setDraft] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const items = card.checklist;
  const done = items.filter((i) => i.done).length;

  const toggle = (id: string) =>
    save({ checklist_ops: [{ op: 'toggle', id }] }, { optimistic: (c) => ({ ...c, checklist: c.checklist.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) }), toastId: `cl-${card.id}` });
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    const next = arrayMove(items, from, to);
    save({ checklist: next }, { optimistic: (c) => ({ ...c, checklist: next }), toastId: `cl-${card.id}` });
  };
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    const temp: ChecklistItem = { id: `tmp-${Date.now()}`, text: t, done: false };
    save({ checklist_ops: [{ op: 'add', text: t }] }, { optimistic: (c) => ({ ...c, checklist: [...c.checklist, temp] }), toastId: `cl-${card.id}` });
    setDraft('');
  };

  return (
    <section aria-labelledby="cl-h">
      <div className="flex items-center justify-between">
        <h3 id="cl-h" className="text-xs font-medium text-faint">
          Checklist
        </h3>
        {items.length ? (
          <span className="num text-xs text-faint">
            {done}/{items.length}
          </span>
        ) : null}
      </div>
      {items.length ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="mt-1.5 -ml-1">
            {items.map((i) => (
              <Item
                key={i.id}
                item={i}
                onToggle={() => toggle(i.id)}
                onEdit={(text) => save({ checklist_ops: [{ op: 'edit', id: i.id, text }] }, { toastId: `cl-${card.id}` })}
                onRemove={() => save({ checklist_ops: [{ op: 'remove', id: i.id }] }, { optimistic: (c) => ({ ...c, checklist: c.checklist.filter((x) => x.id !== i.id) }), toastId: `cl-${card.id}` })}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="mt-1 flex items-center gap-2 pl-6">
        <span aria-hidden className="size-4 flex-none rounded-[4px] border border-dashed border-control" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          aria-label="Add a checklist item"
          placeholder="Add an item…"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint"
        />
      </div>
    </section>
  );
}
