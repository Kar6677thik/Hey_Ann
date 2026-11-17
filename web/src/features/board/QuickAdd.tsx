import { useRef, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useWrite } from '../../lib/mutations.ts';
import { markTouched } from '../../lib/ui-state.ts';
import { ParseChips, splitLines, useParsePreview } from '../quickadd/parse.tsx';
import { Kbd } from '../../components/ui/bits.tsx';

/** Inline quick add at the foot of a column. Enter adds; Shift+Enter starts another card. */
export function QuickAdd({ columnId, columnName, open, setOpen }: { columnId: number; columnName: string; open: boolean; setOpen: (v: boolean) => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const { parsed, count } = useParsePreview(text);
  const add = useWrite((t: string) => api.quickAdd(t, columnId), { toastId: () => `qa-${columnId}` });

  const submit = () => {
    const t = text.trim();
    if (!t || add.isPending) return;
    add.mutate(t, {
      onSuccess: (r) => {
        setText('');
        markTouched(r.cards.map((c) => c.id));
        ref.current?.focus();
      },
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setText('');
      setOpen(false);
    }
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full flex-none items-center gap-2 rounded-md px-2 text-sm text-faint transition-colors hover:bg-raised hover:text-muted"
        aria-label={`Add a card to ${columnName}`}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden />
        Add card
      </button>
    );

  return (
    <div className="flex-none rounded-lg border border-accent bg-surface p-2">
      <label htmlFor={`qa-${columnId}`} className="sr-only">
        New card in {columnName}
      </label>
      <textarea
        id={`qa-${columnId}`}
        ref={ref}
        autoFocus
        rows={Math.min(5, Math.max(2, text.split('\n').length))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => {
          if (!text.trim()) setOpen(false);
        }}
        placeholder="Call the bank tomorrow 10am !p1 @Life ~15m…"
        className="block w-full resize-none bg-transparent text-[13px] leading-[18px] text-text outline-none placeholder:text-faint"
      />
      <ParseChips parsed={parsed} className="mt-1.5" />
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-faint">
        <span className="truncate">{count > 1 ? <span className="num text-muted">{count} cards</span> : 'Shift+Enter for another line'}</span>
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => (setText(''), setOpen(false))} className="rounded px-1.5 py-0.5 text-faint hover:text-text">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || add.isPending}
            className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-ink disabled:opacity-40"
          >
            Add <Kbd className="h-4 min-w-0 border-0 bg-transparent px-0 text-primary-ink">↵</Kbd>
          </button>
        </span>
      </div>
    </div>
  );
}
