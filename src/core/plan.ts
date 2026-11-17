import type { Board, BatchMeta } from './board.ts';
import type { Card } from './types.ts';
import { dayLabel } from './time.ts';

/** Make `ids` exactly the plan for `day`: plan them, and unplan other open cards planned for that day. */
export function setPlan(board: Board, ids: number[], day: string, meta: BatchMeta): { result: Card[]; batch: import('./types.ts').Batch | null } {
  const today = board.today();
  return board.batch(meta, (tx) => {
    const want = new Set(ids);
    for (const c of board.openCards()) if (c.planned_for === day && !want.has(c.id)) tx.updateCard(c.id, { planned_for: null });
    const planned = ids.map((id) => tx.updateCard(id, { planned_for: day }));
    tx.summary = `Planned ${planned.length} card${planned.length === 1 ? '' : 's'} for ${day === today ? 'today' : dayLabel(day, today)}`;
    return planned;
  });
}
