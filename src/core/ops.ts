// High-level operations shared by MCP tools and the HTTP API: batch create with duplicate detection, batch update by
// fuzzy reference, archive with confirmation, quick add. Unresolved or ambiguous references abort the whole batch:
// nothing is written unless every card is identified.
import { Board, BoardError, normSource, type BatchMeta, type CardInput, type CardPatch } from './board.ts';
import type { Batch, Card } from './types.ts';
import { resolveCard, similarCards, type Resolution } from './resolve.ts';
import { parseQuickAdd } from './nlp.ts';
import { localDay } from './time.ts';

export interface AddItem extends CardInput {
  /** Create even when a similar open card exists. */
  allow_duplicate?: boolean;
  planned_today?: boolean;
}

export interface AddResult {
  created: Card[];
  /** Items not created because a similar card exists (pass allow_duplicate to force). */
  duplicates: { title: string; existing: Card[] }[];
  /** Same client_ref seen before, or an open card from the same source: the existing card, nothing created. */
  existing: Card[];
  notes: string[];
  batch: Batch | null;
}

export function addCards(board: Board, items: AddItem[], meta: BatchMeta, opts: { dryRun?: boolean } = {}): AddResult {
  if (!Array.isArray(items) || !items.length) throw new BoardError('give at least one card');
  if (items.length > 100) throw new BoardError('at most 100 cards per call');
  const pool = board.openCards();
  const recent = Date.now() - 7 * 864e5;
  const duplicates: AddResult['duplicates'] = [];
  const existing: Card[] = [];
  const toCreate: AddItem[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || typeof it.title !== 'string' || !it.title.trim()) throw new BoardError('every card needs a title');
    if (it.client_ref) {
      const prev = board.db.prepare('SELECT id FROM cards WHERE client_ref = ?').get(String(it.client_ref)) as { id: number } | undefined;
      if (prev) { existing.push(board.mustCard(prev.id)); continue; }
    }
    // Same thing from another app (e.g. a Socrates weak tag) while an open card for it exists: report that card.
    if (it.source) {
      const src = normSource(it.source);
      it.source = src;
      const open = findOpenBySource(board, src.app, src.id);
      if (open) { existing.push(open); continue; }
      // Study cards from Socrates: tagged "study", in a Study project unless one was given.
      if (src.app === 'socrates') {
        if (it.project === undefined && it.project_id === undefined) it.project = 'Study';
        if (!(it.tags ?? []).some((t) => t.toLowerCase() === 'study')) it.tags = [...(it.tags ?? []), 'study'];
      }
    }
    const key = it.title.trim().toLowerCase();
    if (seen.has(key) && !it.allow_duplicate) { duplicates.push({ title: it.title, existing: [] }); continue; }
    seen.add(key);
    // With a source, the source (checked above) is the identity; titles from other apps repeat by design.
    if (!it.allow_duplicate && !it.source) {
      const sim = similarCards(board, it.title, pool, recent);
      if (sim.length) { duplicates.push({ title: it.title, existing: sim }); continue; }
    }
    toCreate.push(it);
  }
  if (opts.dryRun) {
    // Validate everything without writing: run in a transaction that is rolled back.
    const preview = previewWrite(board, meta, (tx) => toCreate.map((it) => tx.createCard(toInput(it))));
    return { created: preview.result, duplicates, existing, notes: preview.notes, batch: null };
  }
  const { result, batch, notes } = runWrite(board, meta, (tx) => {
    const created = toCreate.map((it) => tx.createCard(toInput(it)));
    tx.summary = created.length === 1 ? `Added "${created[0].title}"` : `Added ${created.length} cards`;
    return created;
  });
  return { created: result, duplicates, existing, notes, batch };
}

function toInput(it: AddItem): CardInput {
  const { allow_duplicate, planned_today, ...rest } = it;
  return planned_today ? { ...rest, planned_for: rest.planned_for ?? 'today' } : rest;
}

export interface UpdateItem extends CardPatch {
  /** Card reference: "#12", "12", or (part of) its title. */
  card: string | number;
  /** Column name or kind: "done", "in progress", "review", "backlog". */
  move_to?: string;
  restore?: boolean;
  planned_today?: boolean;
}

export interface UnresolvedRef {
  ref: string;
  reason: 'ambiguous' | 'none';
  candidates: Card[];
}

export function resolveAll(board: Board, refs: (string | number)[], opts: { includeArchived?: boolean } = {}): { cards: Card[]; unresolved: UnresolvedRef[] } {
  const pool = opts.includeArchived ? [...board.openCards(), ...board.archivedCards(300)] : board.openCards();
  const cards: Card[] = [];
  const unresolved: UnresolvedRef[] = [];
  for (const ref of refs) {
    const r: Resolution = resolveCard(board, ref, { includeArchived: opts.includeArchived, pool });
    if (r.ok) cards.push(r.card);
    else unresolved.push({ ref: String(ref), reason: r.reason, candidates: r.candidates });
  }
  return { cards, unresolved };
}

export interface UpdateResult {
  updated: Card[];
  unchanged: Card[];
  unresolved: UnresolvedRef[];
  notes: string[];
  batch: Batch | null;
}

export function updateCards(board: Board, items: UpdateItem[], meta: BatchMeta, opts: { dryRun?: boolean } = {}): UpdateResult {
  if (!Array.isArray(items) || !items.length) throw new BoardError('give at least one update');
  if (items.length > 100) throw new BoardError('at most 100 updates per call');
  const { cards, unresolved } = resolveAll(board, items.map((i) => i.card), { includeArchived: items.some((i) => i.restore) });
  if (unresolved.length) return { updated: [], unchanged: [], unresolved, notes: [], batch: null };
  const ids = cards.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    const dup = cards.find((c, i) => ids.indexOf(c.id) !== i)!;
    throw new BoardError(`#${dup.id} "${dup.title}" is targeted twice; combine those changes into one update`);
  }
  const apply = (tx: import('./board.ts').Tx) => {
    const updated: Card[] = [], unchanged: Card[] = [];
    items.forEach((it, i) => {
      const { card: _ref, move_to, restore, planned_today, ...patch } = it;
      let c = cards[i];
      if (restore && c.archived_at) c = tx.restoreCard(c.id);
      const p: CardPatch = { ...patch };
      if (move_to) p.column = move_to;
      if (planned_today !== undefined) p.planned_for = planned_today ? 'today' : null;
      const after = tx.updateCard(c.id, p);
      (after.version !== cards[i].version ? updated : unchanged).push(after);
    });
    return { updated, unchanged };
  };
  if (opts.dryRun) {
    const p = previewWrite(board, meta, apply);
    return { ...p.result, unresolved: [], notes: p.notes, batch: null };
  }
  const { result, batch, notes } = runWrite(board, meta, (tx) => {
    const r = apply(tx);
    tx.summary = describeUpdate(board, r.updated, cards, items);
    return r;
  });
  return { ...result, unresolved: [], notes, batch };
}

function describeUpdate(board: Board, updated: Card[], before: Card[], items: UpdateItem[]): string {
  if (!updated.length) return 'No changes';
  const cols = new Map(board.columns().map((c) => [c.id, c]));
  const moved = updated.filter((u) => before.find((b) => b.id === u.id)!.column_id !== u.column_id);
  if (moved.length === updated.length && new Set(moved.map((m) => m.column_id)).size === 1) {
    const col = cols.get(moved[0].column_id)!;
    const verb = col.kind === 'done' ? 'Completed' : `Moved to ${col.name}:`;
    return moved.length === 1 ? `${verb} "${moved[0].title}"` : `${verb} ${moved.length} cards`;
  }
  if (updated.length > 1) {
    // Mixed batch: "Completed 1 · moved 1 to In Progress · blocked 1 · updated 2".
    const parts = new Map<string, number>();
    const bump = (k: string) => parts.set(k, (parts.get(k) ?? 0) + 1);
    for (const u of updated) {
      const b = before.find((x) => x.id === u.id)!;
      if (b.column_id !== u.column_id) bump(cols.get(u.column_id)!.kind === 'done' ? 'completed' : `moved to ${cols.get(u.column_id)!.name}`);
      else if (u.blocked_reason && !b.blocked_reason) bump('blocked');
      else if (!u.blocked_reason && b.blocked_reason) bump('unblocked');
      else bump('updated');
    }
    const text = [...parts].map(([k, n]) => (k.startsWith('moved') ? `moved ${n} to${k.slice(8)}` : `${k} ${n}`)).join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  if (updated.length === 1) {
    const it = items[before.findIndex((b) => b.id === updated[0].id)] ?? items[0];
    if (it.blocked_reason) return `Blocked "${updated[0].title}"`;
    if (it.blocked_reason === null) return `Unblocked "${updated[0].title}"`;
    if (it.restore) return `Restored "${updated[0].title}"`;
    return `Updated "${updated[0].title}"`;
  }
  return `Updated ${updated.length} cards`;
}

export function archiveCards(board: Board, refs: (string | number)[], meta: BatchMeta, opts: { confirm?: boolean } = {}) {
  const { cards, unresolved } = resolveAll(board, refs);
  if (unresolved.length || !opts.confirm) return { archived: [] as Card[], targets: cards, unresolved, batch: null as Batch | null, confirmed: false };
  const { result, batch } = runWrite(board, meta, (tx) => {
    const archived = cards.map((c) => tx.archiveCard(c.id));
    tx.summary = archived.length === 1 ? `Archived "${archived[0].title}"` : `Archived ${archived.length} cards`;
    return archived;
  });
  return { archived: result, targets: cards, unresolved, batch, confirmed: true };
}

/** Quick add: one card per line (or ";"), each parsed for !priority #tags @project ~estimate *today, recurrence and dates. */
export function quickAdd(board: Board, text: string, meta: BatchMeta, opts: { columnId?: number } = {}) {
  const s = board.settings();
  const lines = String(text ?? '').split(/\n|;/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  if (!lines.length) throw new BoardError('nothing to add');
  if (lines.length > 50) throw new BoardError('at most 50 lines at once');
  const items: AddItem[] = lines.map((line) => {
    const p = parseQuickAdd(line, s.timezone, Date.now(), s.week_starts_on);
    if (!p.title) throw new BoardError(`"${line}" has no title left after parsing`);
    return {
      title: p.title, priority: p.priority ?? undefined, due_at: p.due_at ?? undefined, due_has_time: p.due_has_time,
      project: p.project ?? undefined, tags: p.tags.length ? p.tags : undefined, estimate_min: p.estimate_min ?? undefined,
      planned_today: p.planned_today, recurrence: p.recurrence ?? undefined,
      column_id: p.column ? board.resolveColumn(p.column).id : opts.columnId, allow_duplicate: true,
    };
  });
  return addCards(board, items, meta);
}

// ------------------------------------------------------------------ write helpers

function runWrite<T>(board: Board, meta: BatchMeta, fn: (tx: import('./board.ts').Tx) => T) {
  let notes: string[] = [];
  const { result, batch } = board.batch(meta, (tx) => {
    const r = fn(tx);
    notes = tx.notes;
    return r;
  });
  return { result, batch, notes };
}

class Rollback extends Error {
  payload: unknown;
  constructor(payload: unknown) { super('rollback'); this.payload = payload; }
}

/** Run a write and roll it back, returning what it would have produced (dry run). */
export function previewWrite<T>(board: Board, meta: BatchMeta, fn: (tx: import('./board.ts').Tx) => T): { result: T; notes: string[] } {
  try {
    board.batch(meta, (tx) => { throw new Rollback({ result: fn(tx), notes: tx.notes }); });
  } catch (e) {
    if (e instanceof Rollback) return e.payload as { result: T; notes: string[] };
    throw e;
  }
  throw new Error('unreachable');
}

export function todayOf(board: Board) {
  return localDay(Date.now(), board.tz);
}

/** An open (not done, not archived) card made from this source, if any. */
export function findOpenBySource(board: Board, app: string, id: string): Card | null {
  const doneIds = board.columns().filter((c) => c.kind === 'done').map((c) => c.id);
  const row = board.db.prepare(`SELECT id FROM cards WHERE source IS NOT NULL AND archived_at IS NULL
      AND json_extract(source, '$.app') = ? AND json_extract(source, '$.id') = ?
      ${doneIds.length ? `AND column_id NOT IN (${doneIds.join(',')})` : ''} ORDER BY id DESC LIMIT 1`).get(app, id) as { id: number } | undefined;
  return row ? board.mustCard(row.id) : null;
}
