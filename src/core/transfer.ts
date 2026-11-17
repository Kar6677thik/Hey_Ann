// JSON export / import. Export is the whole board; import only ever adds (cards, plus any projects it needs).
import type { Board, BatchMeta } from './board.ts';
import { BoardError } from './board.ts';
import type { Card } from './types.ts';

export function exportJson(board: Board) {
  return {
    format: 'hey-ann',
    version: 1,
    exported_at: new Date().toISOString(),
    settings: board.settings(),
    columns: board.columns(),
    projects: board.projects(),
    tags: board.tags().map(({ count, ...t }) => t),
    cards: [...board.openCards(), ...board.archivedCards(100_000)],
  };
}

export function importJson(board: Board, data: any, meta: BatchMeta) {
  if (!data || data.format !== 'hey-ann' || !Array.isArray(data.cards)) throw new BoardError('not a Hey Ann export (expected format "hey-ann")');
  if (data.cards.length > 5000) throw new BoardError('too many cards in one import (max 5000)');
  const colById = new Map<number, { name: string; kind: string }>((data.columns ?? []).map((c: any) => [c.id, c]));
  const projById = new Map<number, string>((data.projects ?? []).map((p: any) => [p.id, p.name]));
  const { result, batch } = board.batch(meta, (tx) => {
    let n = 0;
    for (const c of data.cards as Card[]) {
      if (!c?.title) continue;
      const col = colById.get(c.column_id);
      let column_id: number;
      try { column_id = board.resolveColumn(col?.name ?? col?.kind ?? 'todo').id; } catch { column_id = (board.columnOfKind((col?.kind as any) ?? 'todo') ?? board.columns()[0]).id; }
      const card = tx.createCard({
        title: c.title, notes: c.notes ?? '', column_id, priority: c.priority ?? 2, due_at: c.due_at ?? null, due_has_time: !!c.due_has_time,
        planned_for: c.planned_for ?? null, estimate_min: c.estimate_min ?? null, project: c.project_id ? projById.get(c.project_id) ?? null : null,
        tags: c.tags ?? [], checklist: (c.checklist ?? []).map((i) => ({ text: i.text, done: i.done })), links: c.links ?? [],
        blocked_reason: c.blocked_reason ?? null, recurrence: c.recurrence ?? null,
      }, { top: false });
      if (c.archived_at) tx.archiveCard(card.id);
      n++;
    }
    tx.summary = `Imported ${n} card${n === 1 ? '' : 's'}`;
    return n;
  });
  return { cards: result, batch };
}
