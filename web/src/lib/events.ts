// Live updates over SSE (/api/events). Every change, from any source, refreshes the caches; Ann's changes
// also get a distinctive toast with Undo and a brief glow on the cards she touched.
import { createElement, useEffect } from 'react';
import { AnnMark } from '../components/ui/bits.tsx';
import { toast } from 'sonner';
import { api } from './api.ts';
import { clientLabel } from './clients.ts';
import { undoBatch } from './mutations.ts';
import { invalidateAll } from './queries.ts';
import { createStore } from './store.ts';
import { markTouched } from './ui-state.ts';
import type { Batch, BoardEvent } from '../../../src/core/types.ts';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
export const liveStore = createStore<{ status: LiveStatus; lastAnn: BoardEvent['batch'] | null }>({ status: 'connecting', lastAnn: null });

let refreshTimer: number | null = null;
function scheduleRefresh() {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void invalidateAll();
  }, 120);
}

function cardIdsOf(batch: Batch): number[] {
  return [...new Set(batch.changes.filter((c) => c.entity === 'card').map((c) => Number(c.entity_id)))];
}

async function onAnnBatch(ev: BoardEvent['batch']) {
  liveStore.set((s) => ({ ...s, lastAnn: ev }));
  const who = `Ann · via ${clientLabel(ev.client)}`;
  if (ev.undoes) {
    toast(who, { description: ev.summary, id: `ann-${ev.id}`, icon: createElement(AnnMark, { size: 16, client: ev.client }) });
  } else {
    toast(`${who}: ${ev.summary}`, {
      id: `ann-${ev.id}`,
      description: ev.utterance ? `“${ev.utterance}”` : undefined,
      duration: 9000,
      icon: createElement(AnnMark, { size: 16, client: ev.client }),
      action: { label: 'Undo', onClick: () => void undoBatch(ev.id) },
    });
  }
  // The event has no change list; find the batch in the recent activity to light up its cards.
  try {
    const { items } = await api.activity({ limit: 8, actor: 'ann' });
    const full = items.find((b) => b.id === ev.id);
    if (full) markTouched(cardIdsOf(full));
  } catch {
    /* the glow is a nicety */
  }
}

/** Opens the event stream for the lifetime of the signed-in app. */
export function useLiveEvents(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry = 0;
    let timer: number | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');
      es.addEventListener('hello', () => {
        // After a reconnect we may have missed events: refresh once.
        if (retry > 0) scheduleRefresh();
        retry = 0;
        liveStore.set((s) => ({ ...s, status: 'live' }));
      });
      es.addEventListener('board', (msg) => {
        let ev: BoardEvent;
        try {
          ev = JSON.parse((msg as MessageEvent<string>).data);
        } catch {
          return;
        }
        scheduleRefresh();
        if (ev.batch.actor === 'ann') void onAnnBatch(ev.batch);
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        retry += 1;
        liveStore.set((s) => ({ ...s, status: navigator.onLine ? 'reconnecting' : 'offline' }));
        const wait = Math.min(30_000, 1000 * 2 ** Math.min(retry - 1, 5));
        timer = window.setTimeout(connect, wait);
      };
    };
    connect();

    const wake = () => {
      if (!es && !closed) {
        if (timer !== null) clearTimeout(timer);
        connect();
      }
    };
    const offline = () => liveStore.set((s) => ({ ...s, status: 'offline' }));
    window.addEventListener('online', wake);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', wake);
    return () => {
      closed = true;
      es?.close();
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [enabled]);
}
