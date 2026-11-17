// Turns the board + filters + grouping into lanes of containers (one container per lane x column).
import type { Card, Column } from '../../../../src/core/types.ts';
import { PRIORITY_NAME, byCompletedDesc, matchesFilters } from '../../lib/cards.ts';
import type { BoardIndex } from '../../lib/queries.ts';
import type { BoardFilters, Prefs } from '../../lib/ui-state.ts';
import { addDays, dayKey } from '../../lib/time.ts';

export interface Container {
  id: string;
  column: Column;
  cards: Card[];
  hiddenDone: number;
}
export interface Lane {
  key: string;
  label: string;
  color?: string;
  containers: Container[];
  count: number;
}

const DONE_RECENT_DAYS = 7;
const DONE_MIN_SHOWN = 8;

export const containerId = (lane: string, columnId: number) => `${lane}::${columnId}`;
export const columnOfContainer = (id: string) => Number(id.split('::')[1]);
export const laneOfContainer = (id: string) => id.split('::')[0];

export function buildLanes(index: BoardIndex, filters: BoardFilters, groupBy: Prefs['groupBy'], showAllDone: boolean): { lanes: Lane[]; shown: number; total: number } {
  const { board, columns, cardsByColumn, projectById } = index;
  const today = board.today;
  const recentFrom = addDays(today, -DONE_RECENT_DAYS);
  let shown = 0;

  // Filter and trim the done column once.
  const visible = new Map<number, { cards: Card[]; hidden: number }>();
  for (const col of columns) {
    let cards = (cardsByColumn.get(col.id) ?? []).filter((c) => matchesFilters(c, filters, today, c.project_id !== null ? projectById.get(c.project_id)?.name : undefined));
    let hidden = 0;
    if (col.kind === 'done' && !showAllDone && cards.length > DONE_MIN_SHOWN) {
      const keep = new Set(
        cards
          .toSorted(byCompletedDesc)
          .filter((c, i) => i < DONE_MIN_SHOWN || (c.completed_at !== null && dayKey(c.completed_at) >= recentFrom))
          .map((c) => c.id),
      );
      hidden = cards.length - keep.size;
      cards = cards.filter((c) => keep.has(c.id));
    }
    shown += cards.length + hidden;
    visible.set(col.id, { cards, hidden });
  }

  const laneDefs: { key: string; label: string; color?: string; test: (c: Card) => boolean }[] =
    groupBy === 'project'
      ? [
          ...board.projects
            .filter((p) => !p.archived_at)
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map((p) => ({ key: `p${p.id}`, label: p.name, color: p.color, test: (c: Card) => c.project_id === p.id })),
          { key: 'pnone', label: 'No project', test: (c: Card) => c.project_id === null || !projectById.get(c.project_id) || !!projectById.get(c.project_id)?.archived_at },
        ]
      : groupBy === 'priority'
        ? [0, 1, 2, 3].map((p) => ({ key: `pr${p}`, label: `P${p} · ${PRIORITY_NAME[p]}`, test: (c: Card) => c.priority === p }))
        : [{ key: 'all', label: 'All', test: () => true }];

  const lanes: Lane[] = laneDefs.map((def) => {
    const containers = columns.map((col) => {
      const v = visible.get(col.id)!;
      return { id: containerId(def.key, col.id), column: col, cards: v.cards.filter(def.test), hiddenDone: def.key === 'all' || groupBy === 'none' ? v.hidden : 0 };
    });
    return { key: def.key, label: def.label, color: def.color, containers, count: containers.reduce((n, c) => n + c.cards.length, 0) };
  });

  return { lanes: groupBy === 'none' ? lanes : lanes.filter((l) => l.count > 0), shown, total: board.cards.length };
}
