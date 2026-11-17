import { useEffect, useMemo, useState } from 'react';
import type { Card } from '../../../../src/core/types.ts';
import { renderMarkdown } from '../../lib/markdown.ts';
import { cn } from '../../components/ui/cn.ts';
import { useCardSave } from './useCardSave.ts';

/** Markdown notes: preview by default, Edit to change, Save or Cmd/Ctrl+Enter to keep. */
export function Notes({ card }: { card: Card }) {
  const { save } = useCardSave(card.id);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [text, setText] = useState(card.notes);
  useEffect(() => {
    if (mode === 'view') setText(card.notes);
  }, [card.notes, mode]);
  const html = useMemo(() => renderMarkdown(mode === 'edit' ? text : card.notes), [mode, text, card.notes]);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const commit = () => {
    if (text !== card.notes) save({ notes: text });
    setMode('view');
  };

  return (
    <section aria-labelledby="notes-h">
      <div className="flex h-7 items-center justify-between">
        <h3 id="notes-h" className="text-xs font-medium text-faint">
          Notes
        </h3>
        {mode === 'edit' ? (
          <div role="tablist" aria-label="Notes view" className="flex items-center gap-3">
            {(['write', 'preview'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('sel-line h-7 text-xs capitalize', tab === t ? 'text-text' : 'text-faint hover:text-text')}>
                {t}
              </button>
            ))}
          </div>
        ) : card.notes ? (
          <button type="button" onClick={() => (setMode('edit'), setTab('write'))} className="text-xs text-faint hover:text-text">
            Edit
          </button>
        ) : null}
      </div>
      {mode === 'view' ? (
        card.notes ? (
          <div className="prose-ann mt-1 rounded-md py-1" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <button type="button" onClick={() => setMode('edit')} className="mt-1 h-9 w-full rounded-md border border-dashed border-border px-3 text-left text-sm text-faint hover:border-border-strong hover:text-muted">
            Add notes (Markdown)
          </button>
        )
      ) : (
        <div className="mt-1">
          {tab === 'write' ? (
            <textarea
              autoFocus
              value={text}
              aria-label="Notes in Markdown"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commit();
                }
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setText(card.notes);
                  setMode('view');
                }
              }}
              rows={Math.min(16, Math.max(5, text.split('\n').length + 1))}
              className="block w-full resize-y rounded-md border border-accent bg-surface px-3 py-2 font-mono text-[12.5px] leading-5 text-text focus:outline-none"
              placeholder="**Bold**, - lists, [links](https://…)…"
            />
          ) : (
            <div className="prose-ann min-h-24 rounded-md border border-border px-3 py-2" dangerouslySetInnerHTML={{ __html: html || '<p style="color:var(--faint)">Nothing to preview.</p>' }} />
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={() => (setText(card.notes), setMode('view'))} className="h-7 rounded-md px-2.5 text-xs text-muted hover:text-text">
              Cancel
            </button>
            <button type="button" onClick={commit} className="h-7 rounded-full bg-primary px-3 text-xs font-medium text-primary-ink">
              Save notes
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
