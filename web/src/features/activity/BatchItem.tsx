// One batch of changes: who, when, what, the words that asked for it, the diff, and Undo.
import { memo, useMemo, useState } from 'react';
import { ChevronRight, Cog, RotateCcw, User } from 'lucide-react';
import type { Batch } from '../../../../src/core/types.ts';
import { actorLabel } from '../../lib/clients.ts';
import { undoBatch } from '../../lib/mutations.ts';
import { fmtAgo, fmtDateTime } from '../../lib/time.ts';
import { AnnMark, Pill } from '../../components/ui/bits.tsx';
import { cn } from '../../components/ui/cn.ts';
import { describeChange, type Lookup } from './diff.ts';

const OP_LABEL = { create: 'Created', update: 'Updated', archive: 'Archived', restore: 'Restored', delete: 'Deleted' } as const;

export function ActorMark({ actor, client, size = 22 }: { actor: Batch['actor']; client: string | null; size?: number }) {
  if (actor === 'ann') return <AnnMark client={client} size={size} />;
  if (actor === 'system')
    return (
      <span aria-hidden className="inline-flex flex-none items-center justify-center rounded-full bg-raised text-faint" style={{ width: size, height: size }}>
        <Cog size={size * 0.55} strokeWidth={1.75} />
      </span>
    );
  return (
    <span aria-hidden className="inline-flex flex-none items-center justify-center rounded-full bg-raised text-muted" style={{ width: size, height: size }}>
      <User size={size * 0.6} strokeWidth={1.75} />
    </span>
  );
}

export const BatchItem = memo(function BatchItem({ batch, look, now, onOpenCard, dense }: { batch: Batch; look: Lookup; now: number; onOpenCard?: (id: number) => void; dense?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const views = useMemo(() => (open ? batch.changes.map((c) => describeChange(c, look)) : []), [open, batch.changes, look]);
  const undone = batch.undone_at !== null;
  const isUndo = batch.undoes !== null;
  const panelId = `diff-${batch.id}`;

  return (
    <li className={cn('group relative grid grid-cols-[22px_1fr] gap-x-3', dense ? 'py-2.5' : 'py-3.5')}>
      <div className="pt-0.5">
        <ActorMark actor={batch.actor} client={batch.client} size={dense ? 18 : 22} />
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-faint">
              <span className={cn('font-medium', batch.actor === 'ann' ? 'text-accent-ink' : 'text-muted')}>{actorLabel(batch.actor, batch.client)}</span>
              <time dateTime={new Date(batch.at).toISOString()} title={fmtDateTime(batch.at)} className="num">
                {fmtAgo(batch.at, now)}
              </time>
              {undone ? <Pill tone="neutral">Undone</Pill> : null}
              {isUndo ? <Pill tone="neutral">Undo</Pill> : null}
            </p>
            <p className={cn('mt-0.5 text-sm leading-5', undone ? 'text-faint line-through decoration-faint' : 'text-text')}>{batch.summary}</p>
            {batch.utterance ? <blockquote className="mt-1 border-l border-border-strong pl-2.5 text-[13px] leading-5 text-muted">“{batch.utterance}”</blockquote> : null}
          </div>
          {!undone && !isUndo ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await undoBatch(batch.id);
                setBusy(false);
              }}
              className="inline-flex h-7 flex-none items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
            >
              <RotateCcw size={12} strokeWidth={1.75} aria-hidden />
              Undo
            </button>
          ) : null}
        </div>
        {batch.changes.length ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="mt-1.5 inline-flex h-6 items-center gap-1 rounded text-xs text-faint hover:text-text"
          >
            <ChevronRight size={12} strokeWidth={1.75} aria-hidden className={cn('transition-transform duration-150', open && 'rotate-90')} />
            {batch.changes.length === 1 ? '1 change' : <span><span className="num">{batch.changes.length}</span> changes</span>}
          </button>
        ) : null}
        {open ? (
          <div id={panelId} className="mt-1.5 flex flex-col gap-2 rounded-md border border-border bg-surface p-2.5">
            {views.map((v, i) => (
              <div key={`${v.entity}-${v.id}-${i}`}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-faint">{OP_LABEL[v.op]}</span>
                  {v.entity === 'card' && onOpenCard && v.op !== 'delete' ? (
                    <button type="button" onClick={() => onOpenCard(Number(v.id))} className="min-w-0 truncate text-left text-text hover:underline">
                      <span className="num text-faint">{v.name.split(' ')[0]}</span> {v.name.split(' ').slice(1).join(' ')}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate text-text">{v.name}</span>
                  )}
                </div>
                {v.diffs.length ? (
                  <dl className="mt-1 grid grid-cols-[96px_1fr] gap-x-3 gap-y-0.5 pl-0.5 text-xs">
                    {v.diffs.map((d) => (
                      <div key={d.field} className="contents">
                        <dt className="text-faint">{d.field}</dt>
                        <dd className="min-w-0 [overflow-wrap:anywhere]">
                          {d.before !== undefined ? <span className="text-faint line-through decoration-faint/60">{d.before}</span> : null}
                          {d.before !== undefined && d.after !== undefined ? <span className="px-1.5 text-faint">→</span> : null}
                          {d.after !== undefined ? <span className="text-text">{d.after}</span> : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
});
