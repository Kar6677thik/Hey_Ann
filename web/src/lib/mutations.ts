// Writes: every write returns a batch, so every write gets a toast with Undo.
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api, type CardPatch } from './api.ts';
import { invalidateAll, qk, queryClient } from './queries.ts';
import type { Batch, BoardSnapshot, Card } from '../../../src/core/types.ts';

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export async function undoBatch(id: string) {
  try {
    const r = await api.undoBatch(id);
    await invalidateAll();
    if (r.conflicts.length) toast.warning('Undone, with conflicts', { description: r.conflicts.join(' · ') });
    else toast('Undone', { description: r.batch.summary });
  } catch (err) {
    toast.error('Couldn’t undo', { description: errorMessage(err) });
  }
}

export async function undoLast() {
  try {
    const r = await api.undoLast();
    await invalidateAll();
    if (r.conflicts.length) toast.warning('Undone, with conflicts', { description: r.conflicts.join(' · ') });
    else toast('Undone', { description: r.batch.summary.replace(/^Undo:?\s*/i, '') });
  } catch (err) {
    toast(errorMessage(err) === 'Nothing to undo.' ? 'Nothing to undo' : 'Couldn’t undo', {
      description: errorMessage(err) === 'Nothing to undo.' ? undefined : errorMessage(err),
    });
  }
}

/** The standard "done, with Undo" toast. `id` collapses repeated toasts (e.g. typing in a field). */
export function batchToast(batch: Batch, opts: { id?: string; description?: string } = {}) {
  toast(batch.summary, {
    id: opts.id,
    description: opts.description,
    action: { label: 'Undo', onClick: () => void undoBatch(batch.id) },
  });
}

/** A write mutation: on success toast + refresh everything; on failure toast the server's message. */
export function useWrite<V, R extends { batch: Batch }>(fn: (v: V) => Promise<R>, opts: { toastId?: (v: V) => string; describe?: (r: R) => string | undefined; quiet?: boolean } = {}) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (!opts.quiet) batchToast(r.batch, { id: opts.toastId?.(v), description: opts.describe?.(r) });
      void invalidateAll();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// ---- optimistic board edits

function patchBoardCard(id: number, fn: (c: Card) => Card) {
  queryClient.setQueryData<BoardSnapshot>(qk.board, (b) => (b ? { ...b, cards: b.cards.map((c) => (c.id === id ? fn(c) : c)) } : b));
  queryClient.setQueryData<{ card: Card; activity: Batch[] }>(qk.card(id), (d) => (d ? { ...d, card: fn(d.card) } : d));
}

export interface MoveVars {
  id: number;
  column_id: number;
  before_id: number | null;
  after_id: number | null;
}
/**
 * Apply a move to the cached board right now (synchronously, so a drop never flickers back) and return
 * the previous snapshot for rollback.
 */
export function optimisticMove(v: MoveVars): BoardSnapshot | undefined {
  void queryClient.cancelQueries({ queryKey: qk.board });
  const prev = queryClient.getQueryData<BoardSnapshot>(qk.board);
  if (!prev) return prev;
  const pos = (id: number | null) => (id === null ? null : (prev.cards.find((c) => c.id === id)?.position ?? null));
  const above = pos(v.before_id);
  const below = pos(v.after_id);
  const position = above !== null && below !== null ? (above + below) / 2 : above !== null ? above + 1024 : below !== null ? below - 1024 : 1024;
  const done = prev.columns.find((c) => c.id === v.column_id)?.kind === 'done';
  queryClient.setQueryData<BoardSnapshot>(qk.board, {
    ...prev,
    cards: prev.cards.map((c) => (c.id === v.id ? { ...c, column_id: v.column_id, position, completed_at: done ? (c.completed_at ?? Date.now()) : null } : c)),
  });
  return prev;
}

export function useMoveCard() {
  return useMutation({
    mutationFn: (v: MoveVars & { prev?: BoardSnapshot }) => api.moveCard(v.id, { column_id: v.column_id, before_id: v.before_id, after_id: v.after_id }),
    onMutate: (v) => ({ prev: v.prev ?? optimisticMove(v) }),
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.board, ctx.prev);
      toast.error('Couldn’t move the card', { description: errorMessage(err) });
    },
    onSuccess: (r) => {
      batchToast(r.batch, { id: `move-${r.card.id}` });
      if (r.wip_warning) toast.warning(r.wip_warning, { id: `wip-${r.card.column_id}` });
    },
    onSettled: () => void invalidateAll(),
  });
}

/**
 * Edit a card. Sends `version` for optimistic concurrency; a 409 refetches and says so.
 * `optimistic` applies a local change first (checklist toggles, planned-for-today).
 */
export function usePatchCard() {
  return useMutation({
    mutationFn: (v: { id: number; patch: CardPatch; optimistic?: (c: Card) => Card; toastId?: string; quiet?: boolean }) => api.patchCard(v.id, v.patch),
    onMutate: async (v) => {
      if (!v.optimistic) return {};
      await queryClient.cancelQueries({ queryKey: qk.board });
      await queryClient.cancelQueries({ queryKey: qk.card(v.id) });
      const prevBoard = queryClient.getQueryData<BoardSnapshot>(qk.board);
      const prevCard = queryClient.getQueryData(qk.card(v.id));
      patchBoardCard(v.id, v.optimistic);
      return { prevBoard, prevCard };
    },
    onError: (err, v, ctx) => {
      if (ctx?.prevBoard) queryClient.setQueryData(qk.board, ctx.prevBoard);
      if (ctx?.prevCard) queryClient.setQueryData(qk.card(v.id), ctx.prevCard);
      if (err instanceof ApiError && err.status === 409) {
        toast.warning('This card changed somewhere else', { description: 'Ann or another tab edited it first. I’ve loaded the latest version; make your change again.' });
        void invalidateAll();
      } else toast.error('Couldn’t save', { description: errorMessage(err) });
    },
    onSuccess: (r, v) => {
      // Keep the drawer's copy current so the next edit sends the new version.
      queryClient.setQueryData<{ card: Card; activity: Batch[] }>(qk.card(v.id), (d) => (d ? { ...d, card: r.card } : d));
      if (!v.quiet) batchToast(r.batch, { id: v.toastId ?? `edit-${v.id}` });
    },
    onSettled: () => void invalidateAll(),
  });
}

/** The freshest known version of a card (drawer copy first, then the board). */
export function latestVersion(id: number): number | undefined {
  const d = queryClient.getQueryData<{ card: Card }>(qk.card(id));
  if (d) return d.card.version;
  return queryClient.getQueryData<BoardSnapshot>(qk.board)?.cards.find((c) => c.id === id)?.version;
}

export function useFocus() {
  return useWrite((v: { id: number; action: 'start' | 'stop' }) => api.focus(v.id, v.action), {
    toastId: (v) => `focus-${v.id}`,
    describe: (r) => (r.logged_min ? `Logged ${r.logged_min} min` : undefined),
  });
}
