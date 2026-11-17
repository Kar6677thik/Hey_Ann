// Card detail: a right-hand drawer, deep-linkable as /card/:id (or ?card=:id on other screens).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Copy, Link2, MoreHorizontal, Play, Square, Timer, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Card } from '../../../../src/core/types.ts';
import { useOpenCard, useOpenCardId } from '../../app/nav.ts';
import { ApiError, api } from '../../lib/api.ts';
import { clientLabel } from '../../lib/clients.ts';
import { useFocus, useWrite } from '../../lib/mutations.ts';
import { useBoardIndex, useCard, type BoardIndex } from '../../lib/queries.ts';
import { fmtDateTime, fmtElapsed, fmtMinutes, useNow } from '../../lib/time.ts';
import { AnnMark, ErrorNote, Pill, Skeleton } from '../../components/ui/bits.tsx';
import { Button, IconButton } from '../../components/ui/Button.tsx';
import { MenuItem, Modal, Popover, Sheet } from '../../components/ui/overlay.tsx';
import { BatchItem } from '../activity/BatchItem.tsx';
import { Checklist } from './Checklist.tsx';
import { Links } from './Links.tsx';
import { Notes } from './Notes.tsx';
import { Properties } from './Properties.tsx';
import { parseDuration, useCardSave } from './useCardSave.ts';

export function CardDrawerHost() {
  const { id, close } = useOpenCardId();
  return (
    <Sheet open={id !== null} onClose={close} label={id !== null ? `Card #${id}` : 'Card'} width={620}>
      {id !== null ? <CardDrawer id={id} onClose={close} /> : null}
    </Sheet>
  );
}

function CardDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useCard(id);
  const { index } = useBoardIndex();

  return (
    <>
      <div className="flex h-12 flex-none items-center gap-2 border-b border-border px-4">
        <span className="num text-xs text-faint">#{id}</span>
        {q.data ? <DrawerActions card={q.data.card} onClose={onClose} /> : <span className="flex-1" />}
        <IconButton label="Close (Esc)" icon={X} onClick={onClose} size="sm" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {q.isPending || !index ? (
          <DrawerSkeleton />
        ) : q.isError ? (
          <div className="p-5">
            <ErrorNote
              message={q.error instanceof ApiError && q.error.status === 404 ? `Card #${id} doesn’t exist. It may have been deleted.` : `Couldn’t load card #${id}.`}
              onRetry={q.error instanceof ApiError && q.error.status === 404 ? undefined : () => void q.refetch()}
            />
          </div>
        ) : (
          <DrawerBody card={q.data.card} activity={q.data.activity} index={index} />
        )}
      </div>
    </>
  );
}

function DrawerActions({ card, onClose }: { card: Card; onClose: () => void }) {
  const focus = useFocus();
  const running = card.focus_started_at !== null;
  const moreRef = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openCard = useOpenCard();
  const dup = useWrite(() => api.duplicate(card.id));
  const archive = useWrite(() => api.archive([card.id]));
  const restore = useWrite(() => api.restore([card.id]));
  const del = useWrite(() => api.deleteCard(card.id));
  const now = useNow(running ? 1000 : 60_000);

  return (
    <>
      <span className="flex-1" />
      {card.archived_at ? null : (
        <Button
          size="sm"
          variant={running ? 'secondary' : 'ghost'}
          icon={running ? Square : Play}
          onClick={() => focus.mutate({ id: card.id, action: running ? 'stop' : 'start' })}
          disabled={focus.isPending}
          aria-label={running ? 'Stop focus' : 'Start focus'}
        >
          {running ? <span className="num">{fmtElapsed(now - card.focus_started_at!)}</span> : 'Focus'}
        </Button>
      )}
      <IconButton
        size="sm"
        label="Copy link to card"
        icon={Link2}
        onClick={() => {
          void navigator.clipboard?.writeText(`${location.origin}/card/${card.id}`).then(() => toast('Link copied'));
        }}
      />
      <IconButton ref={moreRef} size="sm" label="More actions" icon={MoreHorizontal} aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((m) => !m)} />
      <Popover open={more} onClose={() => setMore(false)} anchor={moreRef} align="end" label="Card actions">
        <div role="menu" className="w-52">
          <MenuItem onSelect={() => (setMore(false), setLogOpen(true))}>
            <Timer size={14} strokeWidth={1.75} aria-hidden className="text-faint" /> Log time…
          </MenuItem>
          <MenuItem
            onSelect={() => {
              setMore(false);
              dup.mutate(undefined, { onSuccess: (r) => openCard(r.card.id) });
            }}
          >
            <Copy size={14} strokeWidth={1.75} aria-hidden className="text-faint" /> Duplicate
          </MenuItem>
          {card.archived_at ? (
            <>
              <MenuItem onSelect={() => (setMore(false), restore.mutate(undefined))}>
                <ArchiveRestore size={14} strokeWidth={1.75} aria-hidden className="text-faint" /> Restore to the board
              </MenuItem>
              <MenuItem danger onSelect={() => (setMore(false), setConfirmDelete(true))}>
                <Trash2 size={14} strokeWidth={1.75} aria-hidden /> Delete permanently…
              </MenuItem>
            </>
          ) : (
            <MenuItem onSelect={() => (setMore(false), archive.mutate(undefined))}>
              <Archive size={14} strokeWidth={1.75} aria-hidden className="text-faint" /> Archive
            </MenuItem>
          )}
        </div>
      </Popover>
      <LogTimeDialog open={logOpen} onClose={() => setLogOpen(false)} card={card} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete card permanently">
        <div className="p-5">
          <h2 className="text-[15px] font-semibold">Delete “{card.title}” permanently?</h2>
          <p className="mt-1.5 text-sm text-muted">
            Card <span className="num">#{card.id}</span> and its checklist, notes and links will be removed from the database. You can still undo it from Activity right after.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} data-autofocus>
              Keep it
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() =>
                del.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    onClose();
                  },
                })
              }
            >
              Delete card #{card.id}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function LogTimeDialog({ open, onClose, card }: { open: boolean; onClose: () => void; card: Card }) {
  const [text, setText] = useState('25m');
  const log = useWrite((minutes: number) => api.logTime(card.id, minutes));
  const minutes = parseDuration(text);
  return (
    <Modal open={open} onClose={onClose} label="Log time" className="max-w-sm">
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (minutes && minutes > 0) log.mutate(minutes, { onSuccess: onClose });
        }}
      >
        <h2 className="text-[15px] font-semibold">Log time on #{card.id}</h2>
        <p className="mt-1 text-sm text-muted">{fmtMinutes(card.spent_min)} logged so far.</p>
        <label htmlFor="log-min" className="mt-4 block text-xs font-medium text-muted">
          Time spent
        </label>
        <input
          id="log-min"
          data-autofocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="log-hint"
          className="num mt-1.5 h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm focus:border-accent focus:outline-none"
        />
        <p id="log-hint" className="mt-1.5 text-xs text-faint">
          {minutes ? `Adds ${fmtMinutes(minutes)}` : 'Like 25m, 1h 30m or 90'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!minutes || log.isPending}>
            Log time
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TitleField({ card }: { card: Card }) {
  const { save } = useCardSave(card.id);
  const [v, setV] = useState(card.title);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused) setV(card.title);
  }, [card.title, focused]);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [v]);
  return (
    <textarea
      ref={ref}
      aria-label="Title"
      value={v}
      rows={1}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const t = v.trim();
        if (t && t !== card.title) save({ title: t });
        else setV(card.title);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          setV(card.title);
          requestAnimationFrame(() => (e.target as HTMLTextAreaElement).blur());
        }
      }}
      className="-mx-2 block w-[calc(100%+16px)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 text-[19px] font-semibold leading-7 tracking-[-0.01em] text-text hover:border-border focus:border-accent focus:bg-surface focus:outline-none"
    />
  );
}

function DrawerBody({ card, activity, index }: { card: Card; activity: import('../../../../src/core/types.ts').Batch[]; index: BoardIndex }) {
  const now = useNow(30_000);
  const openCard = useOpenCard();
  const restore = useWrite(() => api.restore([card.id]));
  const look = useMemo(() => ({ column: (id: number) => index.colById.get(id)?.name, project: (id: number) => index.projectById.get(id)?.name }), [index]);
  const col = index.colById.get(card.column_id);

  return (
    <div className="px-5 pt-4 pb-10">
      {card.archived_at ? (
        <div className="mb-4 flex items-center gap-3 rounded-md bg-raised px-3 py-2 text-sm">
          <Archive size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
          <span className="flex-1 text-muted">Archived {fmtDateTime(card.archived_at)}</span>
          <Button size="sm" onClick={() => restore.mutate(undefined)}>
            Restore
          </Button>
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-xs text-faint">
        <span>{col?.name}</span>
        {card.created_by === 'ann' ? (
          <>
            <span>·</span>
            <span className="flex items-center gap-1">
              <AnnMark size={13} client={card.created_client} /> Added by Ann via {clientLabel(card.created_client)}
            </span>
          </>
        ) : null}
        {card.blocked_reason ? <Pill tone="negative">Blocked</Pill> : null}
      </div>
      <div className="mt-1.5">
        <TitleField card={card} />
      </div>

      {card.created_by === 'ann' && card.source_utterance ? (
        <figure className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5">
          <figcaption className="text-[11px] text-faint">Ann, via {clientLabel(card.created_client)}:</figcaption>
          <blockquote className="mt-0.5 text-[13px] leading-5 text-text">“{card.source_utterance}”</blockquote>
        </figure>
      ) : null}

      <div className="mt-5">
        <Properties card={card} index={index} />
      </div>
      <hr className="my-5 border-rule" />
      <Notes card={card} />
      <hr className="my-5 border-rule" />
      <Checklist card={card} />
      <hr className="my-5 border-rule" />
      <Links card={card} />
      <hr className="my-5 border-rule" />
      <section aria-labelledby="hist-h">
        <h3 id="hist-h" className="text-xs font-medium text-faint">
          History
        </h3>
        {activity.length ? (
          <ul className="mt-1 divide-y divide-rule">
            {activity.map((b) => (
              <BatchItem key={b.id} batch={b} look={look} now={now} onOpenCard={(cid) => cid !== card.id && openCard(cid)} dense />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-faint">No changes recorded yet.</p>
        )}
      </section>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="px-5 pt-4" aria-busy="true" aria-label="Loading card">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-4/5" />
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="grid grid-cols-[112px_1fr] items-center gap-3">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
