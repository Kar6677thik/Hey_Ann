import { useCallback } from 'react';
import type { Card } from '../../../../src/core/types.ts';
import type { CardPatch } from '../../lib/api.ts';
import { latestVersion, usePatchCard } from '../../lib/mutations.ts';

/** Save part of a card with the freshest version (409 → refetch + tell the user, in usePatchCard). */
export function useCardSave(id: number) {
  const patch = usePatchCard();
  const save = useCallback(
    (p: CardPatch, opts: { optimistic?: (c: Card) => Card; toastId?: string; quiet?: boolean } = {}) =>
      patch.mutate({ id, patch: { ...p, version: latestVersion(id) }, ...opts }),
    [id, patch],
  );
  return { save, pending: patch.isPending };
}

/** "45m", "1h30m", "1.5h", "2h 15m", "90" → minutes; null when empty or unreadable. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/^~/, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?$/.exec(t);
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round((m[1] ? Number(m[1]) * 60 : 0) + (m[2] ? Number(m[2]) : 0));
}
