// Card helpers shared by the board, list, calendar and palette.
import type { BoardSnapshot, Card, Priority } from '../../../src/core/types.ts';
import type { BoardFilters } from './ui-state.ts';
import { addDays, dayKey, nowMs } from './time.ts';

export const PRIORITY_SHORT = ['P0', 'P1', 'P2', 'P3'] as const;
export const PRIORITY_NAME = ['Urgent', 'High', 'Normal', 'Low'] as const;
export const isPriority = (n: number): n is Priority => n === 0 || n === 1 || n === 2 || n === 3;

export function isOverdue(c: Card, today: string, now = nowMs()): boolean {
  if (c.due_at === null) return false;
  return c.due_has_time ? c.due_at < now : dayKey(c.due_at) < today;
}

/** Board filter predicate (client-side, instant). */
export function matchesFilters(c: Card, f: BoardFilters, today: string, projectName?: string): boolean {
  if (f.project !== null && c.project_id !== f.project) return false;
  if (f.tag && !c.tags.includes(f.tag)) return false;
  if (f.priority !== null && c.priority !== f.priority) return false;
  if (f.blocked && !c.blocked_reason) return false;
  if (f.ann && c.created_by !== 'ann') return false;
  if (f.due) {
    if (c.due_at === null) return false;
    const day = dayKey(c.due_at);
    if (f.due === 'overdue' && !isOverdue(c, today)) return false;
    if (f.due === 'today' && day !== today) return false;
    if (f.due === 'week' && (day < today || day > addDays(today, 6))) return false;
  }
  const q = f.q.trim().toLowerCase();
  if (q) {
    const idq = q.replace(/^#/, '');
    if (/^\d+$/.test(idq) && String(c.id) === idq) return true;
    const hay = `${c.title}\n${c.notes}\n${c.tags.join(' ')}\n${projectName ?? ''}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** Simple fuzzy score for the palette: all chars in order, bonus for word starts and contiguity. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak + (found === 0 || t[found - 1] === ' ' ? 3 : 0);
    ti = found + 1;
  }
  return score;
}

export const projectOf = (b: BoardSnapshot, id: number | null) => (id === null ? undefined : b.projects.find((p) => p.id === id));

/** Done column cards, most recent first. */
export const byCompletedDesc = (a: Card, b: Card) => (b.completed_at ?? 0) - (a.completed_at ?? 0);

export function checklistProgress(c: Card) {
  const total = c.checklist.length;
  const done = c.checklist.filter((i) => i.done).length;
  return { total, done };
}
