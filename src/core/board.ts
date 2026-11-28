// The board: every read and write. All writes run through Board.batch(), which wraps them in one SQLite
// transaction, records a before/after snapshot of every entity touched (the Batch), and broadcasts a BoardEvent.
// Undo replays a batch's "before" snapshots through the same path, so undo is itself an undoable batch.
import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { openDb, transaction, DEFAULT_DB_PATH, type DB } from './db.ts';
import type {
  Actor, Batch, BoardEvent, BoardSnapshot, Card, CardLink, CardSource, Change, ChecklistItem, Column, ColumnKind, EntityKind, Priority,
  Project, Recurrence, Settings, Tag,
} from './types.ts';
import { localDay, endOfDay, isDay, isValidTimezone, localParts, parseDay, zonedTime, daysBetween, addDays } from './time.ts';
import { firstOccurrence, nextOccurrence, normalizeRecurrence, parseDate, parseEstimate, parsePriority } from './nlp.ts';

export class BoardError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const COLUMN_KINDS: ColumnKind[] = ['backlog', 'todo', 'doing', 'review', 'done'];
const ACTIVE_KINDS = new Set<ColumnKind>(['doing', 'review']);
export const PROJECT_COLORS = ['#7c8cff', '#4fd1c5', '#f6ad55', '#f687b3', '#68d391', '#b794f4', '#63b3ed', '#fc8181', '#f6e05e', '#a0aec0'];
const MAX_TITLE = 300;
const MAX_NOTES = 20_000;

export const DEFAULT_SETTINGS: Settings = {
  timezone: process.env.HEYANN_TIMEZONE && isValidTimezone(process.env.HEYANN_TIMEZONE) ? process.env.HEYANN_TIMEZONE : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  day_capacity_min: 360,
  work_start: '09:00',
  work_end: '18:00',
  week_starts_on: 1,
  focus_min: 25,
  display_name: '',
  stale_after_days: 5,
};

const DEFAULT_COLUMNS: Omit<Column, 'id' | 'position'>[] = [
  { name: 'Backlog', kind: 'backlog', wip_limit: null, color: null },
  { name: 'To Do', kind: 'todo', wip_limit: null, color: null },
  { name: 'In Progress', kind: 'doing', wip_limit: 3, color: null },
  { name: 'In Review', kind: 'review', wip_limit: 3, color: null },
  { name: 'Done', kind: 'done', wip_limit: null, color: null },
];

export interface BatchMeta {
  actor: Actor;
  client?: string | null;
  action: string;
  utterance?: string | null;
}

/** What callers may set on a card. Phrases (due, estimate, recurrence) are parsed here, in the owner's timezone. */
export interface CardInput {
  title?: string;
  notes?: string;
  column_id?: number;
  /** Column by name or kind ("done", "in progress", "review"). */
  column?: string;
  priority?: Priority | string | null;
  /** Natural-language or ISO date; null clears. */
  due?: string | null;
  due_at?: number | null;
  due_has_time?: boolean;
  /** "YYYY-MM-DD", "today", "tomorrow", or null. */
  planned_for?: string | null;
  estimate_min?: number | string | null;
  project?: string | null;
  project_id?: number | null;
  tags?: string[];
  checklist?: (string | { text: string; done?: boolean })[];
  links?: (string | CardLink)[];
  blocked_reason?: string | null;
  needs_review?: boolean;
  recurrence?: string | Recurrence | null;
  /** Where it came from in another app; null clears. */
  source?: CardSource | null;
  client_ref?: string;
}

export interface CardPatch extends CardInput {
  version?: number;
  append_note?: string;
  add_tags?: string[];
  remove_tags?: string[];
  checklist_ops?: ({ op: 'add'; text: string } | { op: 'toggle' | 'remove' | 'check' | 'uncheck'; id: string } | { op: 'edit'; id: string; text: string })[];
  add_links?: (string | CardLink)[];
}

type CardRow = Record<string, any>;

const j = <T>(s: string | null, fallback: T): T => {
  if (s === null || s === undefined) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
const clean = (s: unknown, max: number, what: string): string => {
  if (typeof s !== 'string') throw new BoardError(`${what} must be text`);
  const t = s.replace(/\r\n/g, '\n').trim();
  if (t.length > max) throw new BoardError(`${what} is too long (max ${max} characters)`);
  return t;
};
const newId = () => randomBytes(6).toString('base64url');

export class Board {
  readonly db: DB;
  readonly dbPath: string;
  readonly events = new EventEmitter();
  /** Called synchronously after every committed batch (the wallet reconciles card credit here). */
  readonly afterCommit: ((batch: Batch) => void)[] = [];
  private settingsCache: Settings | null = null;

  constructor(path = DEFAULT_DB_PATH) {
    this.dbPath = path;
    this.db = openDb(path);
    this.events.setMaxListeners(100);
    this.ensureDefaults();
  }

  private ensureDefaults() {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM columns').get() as { n: number }).n;
    if (n === 0) {
      const ins = this.db.prepare('INSERT INTO columns(name, kind, position, wip_limit, color) VALUES (?, ?, ?, ?, ?)');
      DEFAULT_COLUMNS.forEach((c, i) => ins.run(c.name, c.kind, (i + 1) * 1024, c.wip_limit, c.color));
    }
    if (!this.db.prepare("SELECT 1 FROM settings WHERE key = 'review_started'").get())
      this.db.prepare("INSERT INTO settings(key, value) VALUES ('review_started', ?)").run(JSON.stringify(null));
  }

  // ======================================================================= settings

  settings(): Settings {
    if (this.settingsCache) return this.settingsCache;
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const s: any = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (r.key in DEFAULT_SETTINGS) s[r.key] = j(r.value, s[r.key]);
    this.settingsCache = s;
    return s;
  }

  get tz() {
    return this.settings().timezone;
  }

  today(now = Date.now()) {
    return localDay(now, this.tz);
  }

  meta<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? j(r.value, fallback) : fallback;
  }

  setMeta(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  // ======================================================================= reads

  columns(): Column[] {
    return this.db.prepare('SELECT id, name, kind, position, wip_limit, color FROM columns ORDER BY position').all() as unknown as Column[];
  }

  column(id: number): Column {
    const c = this.db.prepare('SELECT id, name, kind, position, wip_limit, color FROM columns WHERE id = ?').get(id) as unknown as Column | undefined;
    if (!c) throw new BoardError(`column ${id} not found`, 404);
    return c;
  }

  /** First column of a kind (by position). */
  columnOfKind(kind: ColumnKind): Column | null {
    return this.columns().find((c) => c.kind === kind) ?? null;
  }

  /** Resolve a column by id, exact name, kind or common synonym. */
  resolveColumn(ref: string | number): Column {
    const cols = this.columns();
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
      const c = cols.find((x) => x.id === Number(ref));
      if (c) return c;
    }
    const t = String(ref).trim().toLowerCase().replace(/[_-]+/g, ' ');
    const exact = cols.find((c) => c.name.toLowerCase() === t);
    if (exact) return exact;
    const synonyms: Record<string, ColumnKind> = {
      backlog: 'backlog', inbox: 'backlog', later: 'backlog', someday: 'backlog', icebox: 'backlog', ideas: 'backlog',
      todo: 'todo', 'to do': 'todo', next: 'todo', 'up next': 'todo', ready: 'todo', planned: 'todo',
      doing: 'doing', 'in progress': 'doing', progress: 'doing', wip: 'doing', started: 'doing', active: 'doing', working: 'doing', 'working on': 'doing',
      review: 'review', 'in review': 'review', reviewing: 'review', qa: 'review', testing: 'review', waiting: 'review',
      done: 'done', complete: 'done', completed: 'done', finished: 'done', closed: 'done', shipped: 'done',
    };
    const kind = synonyms[t];
    if (kind) {
      const c = cols.find((x) => x.kind === kind);
      if (c) return c;
    }
    const prefix = cols.filter((c) => c.name.toLowerCase().startsWith(t) || c.name.toLowerCase().includes(t));
    if (prefix.length === 1) return prefix[0];
    throw new BoardError(`unknown column "${ref}". Columns: ${cols.map((c) => c.name).join(', ')}`);
  }

  private tagMap(cardIds?: number[]): Map<number, string[]> {
    const rows = (cardIds && cardIds.length <= 500
      ? this.db.prepare(`SELECT ct.card_id, t.name FROM card_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.card_id IN (${cardIds.map(() => '?').join(',') || 'NULL'}) ORDER BY t.name`).all(...cardIds)
      : this.db.prepare('SELECT ct.card_id, t.name FROM card_tags ct JOIN tags t ON t.id = ct.tag_id ORDER BY t.name').all()) as { card_id: number; name: string }[];
    const m = new Map<number, string[]>();
    for (const r of rows) (m.get(r.card_id) ?? m.set(r.card_id, []).get(r.card_id)!).push(r.name);
    return m;
  }

  private toCard(r: CardRow, tags: string[]): Card {
    return {
      id: r.id, column_id: r.column_id, position: r.position, title: r.title, notes: r.notes, priority: r.priority as Priority,
      due_at: r.due_at, due_has_time: !!r.due_has_time, planned_for: r.planned_for, estimate_min: r.estimate_min, spent_min: r.spent_min,
      project_id: r.project_id, tags, checklist: j<ChecklistItem[]>(r.checklist, []), links: j<CardLink[]>(r.links, []),
      blocked_reason: r.blocked_reason, needs_review: !!r.needs_review, recurrence: j<Recurrence | null>(r.recurrence, null),
      source: j<CardSource | null>(r.source, null),
      focus_started_at: r.focus_started_at, credit_pending: !!r.credit_pending, credit_priority: r.credit_priority ?? null, created_by: r.created_by, created_client: r.created_client, source_utterance: r.source_utterance,
      created_at: r.created_at, updated_at: r.updated_at, started_at: r.started_at, completed_at: r.completed_at, archived_at: r.archived_at,
      version: r.version,
    };
  }

  private cardsWhere(where: string, ...params: any[]): Card[] {
    const rows = this.db.prepare(`SELECT * FROM cards WHERE ${where}`).all(...params) as CardRow[];
    const tags = this.tagMap(rows.map((r) => r.id));
    return rows.map((r) => this.toCard(r, tags.get(r.id) ?? []));
  }

  card(id: number): Card | null {
    const r = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
    return r ? this.toCard(r, this.tagMap([id]).get(id) ?? []) : null;
  }

  mustCard(id: number): Card {
    const c = this.card(id);
    if (!c) throw new BoardError(`card #${id} not found`, 404);
    return c;
  }

  /** All non-archived cards, by column position. */
  openCards(): Card[] {
    return this.cardsWhere('archived_at IS NULL ORDER BY position');
  }

  archivedCards(limit = 200): Card[] {
    return this.cardsWhere('archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT ?', limit);
  }

  projects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE').all() as unknown as Project[];
  }

  project(id: number): Project {
    const p = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Project | undefined;
    if (!p) throw new BoardError(`project ${id} not found`, 404);
    return p;
  }

  findProject(name: string): Project | null {
    const t = name.trim();
    return (this.db.prepare('SELECT * FROM projects WHERE name = ? COLLATE NOCASE').get(t) as unknown as Project | undefined)
      ?? (this.db.prepare("SELECT * FROM projects WHERE replace(replace(lower(name), ' ', ''), '-', '') = ?").get(t.toLowerCase().replace(/[\s_-]+/g, '')) as unknown as Project | undefined)
      ?? null;
  }

  tags(): Tag[] {
    return this.db.prepare(`SELECT t.id, t.name, t.color, COUNT(c.id) AS count FROM tags t
      LEFT JOIN card_tags ct ON ct.tag_id = t.id LEFT JOIN cards c ON c.id = ct.card_id AND c.archived_at IS NULL
      GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE`).all() as unknown as Tag[];
  }

  snapshot(now = Date.now()): BoardSnapshot {
    return { columns: this.columns(), cards: this.openCards(), projects: this.projects(), tags: this.tags(), settings: this.settings(), now, today: this.today(now) };
  }

  kindOf(columnId: number): ColumnKind {
    return this.column(columnId).kind;
  }

  isDone(c: Card) {
    return this.kindOf(c.column_id) === 'done';
  }

  /** Filtered search. q uses full-text search over title and notes (prefix matching). */
  search(f: {
    q?: string; column?: number; project?: number; tag?: string; priority?: number; due?: 'overdue' | 'today' | 'week' | 'none';
    blocked?: boolean; archived?: boolean; includeDone?: boolean; limit?: number; offset?: number;
  }, now = Date.now()): { items: Card[]; total: number } {
    const where: string[] = [f.archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL'];
    const params: any[] = [];
    if (f.q?.trim()) {
      const tokens = f.q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      if (tokens.length) {
        where.push('c.id IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)');
        params.push(tokens.map((t) => `"${t}"*`).join(' '));
      }
    }
    if (f.column !== undefined) { where.push('c.column_id = ?'); params.push(f.column); }
    if (f.project !== undefined) { where.push('c.project_id = ?'); params.push(f.project); }
    if (f.priority !== undefined) { where.push('c.priority = ?'); params.push(f.priority); }
    if (f.blocked) where.push('c.blocked_reason IS NOT NULL');
    if (f.tag) { where.push('c.id IN (SELECT ct.card_id FROM card_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.name = ? COLLATE NOCASE)'); params.push(f.tag); }
    const doneIds = this.columns().filter((c) => c.kind === 'done').map((c) => c.id);
    if (f.due) {
      const today = this.today(now);
      if (doneIds.length) where.push(`c.column_id NOT IN (${doneIds.join(',')})`);
      if (f.due === 'overdue') { where.push('c.due_at < ?'); params.push(now); }
      if (f.due === 'today') { where.push('c.due_at <= ?'); params.push(endOfDay(today, this.tz)); }
      if (f.due === 'week') { where.push('c.due_at <= ?'); params.push(endOfDay(addDays(today, 7), this.tz)); }
      if (f.due === 'none') where.push('c.due_at IS NULL');
    }
    if (f.includeDone === false && doneIds.length) where.push(`c.column_id NOT IN (${doneIds.join(',')})`);
    const w = where.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM cards c WHERE ${w}`).get(...params) as { n: number }).n;
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
    const rows = this.db.prepare(`SELECT c.* FROM cards c WHERE ${w} ORDER BY c.archived_at DESC, (c.due_at IS NULL), c.due_at, c.priority, c.updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, f.offset ?? 0) as CardRow[];
    const tags = this.tagMap(rows.map((r) => r.id));
    return { items: rows.map((r) => this.toCard(r, tags.get(r.id) ?? [])), total };
  }

  // ======================================================================= activity

  private rowToBatch(r: any, withChanges = true): Batch {
    return {
      id: r.id, at: r.at, actor: r.actor, client: r.client, action: r.action, utterance: r.utterance, summary: r.summary,
      undone_at: r.undone_at, undoes: r.undoes,
      changes: withChanges
        ? (this.db.prepare('SELECT entity, entity_id, op, before, after FROM changes WHERE batch_id = ? ORDER BY id').all(r.id) as any[]).map((c) => ({
          entity: c.entity, entity_id: /^\d+$/.test(c.entity_id) ? Number(c.entity_id) : c.entity_id, op: c.op, before: j(c.before, null), after: j(c.after, null),
        }))
        : [],
    };
  }

  getBatch(id: string): Batch {
    const r = this.db.prepare('SELECT * FROM batches WHERE id = ?').get(id);
    if (!r) throw new BoardError(`activity ${id} not found`, 404);
    return this.rowToBatch(r);
  }

  activity(opts: { limit?: number; before?: number; actor?: Actor; card?: number } = {}): Batch[] {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (opts.before) { where.push('b.at < ?'); params.push(opts.before); }
    if (opts.actor) { where.push('b.actor = ?'); params.push(opts.actor); }
    if (opts.card !== undefined) { where.push("b.id IN (SELECT batch_id FROM changes WHERE entity = 'card' AND entity_id = ?)"); params.push(String(opts.card)); }
    const rows = this.db.prepare(`SELECT b.* FROM batches b WHERE ${where.join(' AND ')} ORDER BY b.at DESC, b.rowid DESC LIMIT ?`).all(...params, Math.min(opts.limit ?? 50, 500));
    return rows.map((r) => this.rowToBatch(r));
  }

  /**
   * Run a write. Everything fn does through the Tx is one SQLite transaction and one Batch.
   * Returns null for the batch when nothing changed.
   */
  batch<T>(meta: BatchMeta, fn: (tx: Tx) => T): { result: T; batch: Batch | null } {
    const tx = new Tx(this, meta);
    const { result, batch } = transaction(this.db, () => {
      const result = fn(tx);
      return { result, batch: tx.commit() };
    });
    if (tx.touchedSettings) this.settingsCache = null;
    if (batch) {
      for (const hook of this.afterCommit) {
        try { hook(batch); } catch (e) { console.error('[hey-ann] after-commit hook failed:', e); }
      }
      const ev: BoardEvent = { type: 'changed', batch: { id: batch.id, at: batch.at, actor: batch.actor, client: batch.client, action: batch.action, summary: batch.summary, utterance: batch.utterance, undone_at: batch.undone_at, undoes: batch.undoes } };
      queueMicrotask(() => this.events.emit('board', ev));
    }
    return { result, batch };
  }

  /** The newest batch that can be undone (optionally only by one actor). */
  lastUndoable(actor?: Actor): Batch | null {
    const r = this.db.prepare(`SELECT * FROM batches WHERE undone_at IS NULL AND undoes IS NULL ${actor ? 'AND actor = ?' : ''} ORDER BY at DESC, rowid DESC LIMIT 1`).get(...(actor ? [actor] : []));
    return r ? this.rowToBatch(r) : null;
  }

  /**
   * Revert a batch. Each change is checked first: an entity changed again since then is skipped and reported as a
   * conflict rather than clobbered.
   */
  undo(batchId: string, meta: BatchMeta): { batch: Batch | null; reverted: Batch; conflicts: string[] } {
    const target = this.getBatch(batchId);
    if (target.undone_at) throw new BoardError(`"${target.summary}" was already undone`, 409);
    const conflicts: string[] = [];
    const { batch } = this.batch({ ...meta, action: meta.action || 'undo' }, (tx) => {
      tx.undoes = target.id;
      for (const ch of [...target.changes].reverse()) {
        const conflict = tx.revert(ch);
        if (conflict) conflicts.push(conflict);
      }
      tx.summary = `Undid: ${target.summary}${conflicts.length ? ` (${conflicts.length} change${conflicts.length > 1 ? 's' : ''} kept because they were edited since)` : ''}`;
      this.db.prepare('UPDATE batches SET undone_at = ? WHERE id = ?').run(Date.now(), target.id);
      // Undoing an undo re-opens the original.
      if (target.undoes) this.db.prepare('UPDATE batches SET undone_at = NULL WHERE id = ?').run(target.undoes);
    });
    return { batch, reverted: target, conflicts };
  }

  // ======================================================================= sessions (UI login)

  sessionCreate(tokenHash: string, persistent: boolean, now = Date.now()) {
    this.db.prepare('INSERT INTO sessions(token_hash, created_at, seen_at, persistent) VALUES (?, ?, ?, ?)').run(tokenHash, now, now, persistent ? 1 : 0);
  }

  sessionGet(tokenHash: string): { created_at: number; seen_at: number; persistent: number } | null {
    return (this.db.prepare('SELECT created_at, seen_at, persistent FROM sessions WHERE token_hash = ?').get(tokenHash) as any) ?? null;
  }

  sessionTouch(tokenHash: string, now = Date.now()) {
    this.db.prepare('UPDATE sessions SET seen_at = ? WHERE token_hash = ?').run(now, tokenHash);
  }

  sessionDelete(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  sessionPrune(before: number) {
    this.db.prepare('DELETE FROM sessions WHERE seen_at < ?').run(before);
  }

  /** Local-mode MCP bearer token, created on first use. */
  mcpToken(): string {
    let t = this.meta<string | null>('mcp_token', null);
    if (!t) {
      t = randomBytes(24).toString('base64url');
      this.setMeta('mcp_token', t);
    }
    return t;
  }

  close() {
    this.db.close();
  }
}

// ========================================================================= Tx: the write path

export class Tx {
  readonly board: Board;
  readonly meta: BatchMeta;
  readonly now = Date.now();
  readonly changes: Change[] = [];
  summary = '';
  undoes: string | null = null;
  touchedSettings = false;
  /** Extra lines for the caller (recurrences spawned, WIP warnings). */
  readonly notes: string[] = [];
  private db: DB;

  constructor(board: Board, meta: BatchMeta) {
    this.board = board;
    this.meta = meta;
    this.db = board.db;
  }

  private record(entity: EntityKind, id: number | string, op: Change['op'], before: unknown, after: unknown) {
    this.changes.push({ entity, entity_id: id, op, before, after });
  }

  commit(): Batch | null {
    if (!this.changes.length) return null;
    const id = randomUUID();
    const summary = this.summary || `${this.changes.length} change${this.changes.length > 1 ? 's' : ''}`;
    this.db.prepare('INSERT INTO batches(id, at, actor, client, action, utterance, summary, undone_at, undoes) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .run(id, this.now, this.meta.actor, this.meta.client ?? null, this.meta.action, this.meta.utterance?.slice(0, 2000) ?? null, summary.slice(0, 500), this.undoes);
    const ins = this.db.prepare('INSERT INTO changes(batch_id, entity, entity_id, op, before, after) VALUES (?, ?, ?, ?, ?, ?)');
    for (const c of this.changes) ins.run(id, c.entity, String(c.entity_id), c.op, c.before === null ? null : JSON.stringify(c.before), c.after === null ? null : JSON.stringify(c.after));
    return { id, at: this.now, actor: this.meta.actor, client: this.meta.client ?? null, action: this.meta.action, utterance: this.meta.utterance ?? null, summary, undone_at: null, undoes: this.undoes, changes: this.changes };
  }

  // ------------------------------------------------------------------ helpers

  private get settings() {
    return this.board.settings();
  }

  private transition(cardId: number, from: number | null, to: number | null) {
    if (from === to) return;
    this.db.prepare('INSERT INTO transitions(card_id, at, from_column, to_column) VALUES (?, ?, ?, ?)').run(cardId, this.now, from, to);
  }

  private syncFts(id: number, title: string | null, notes: string | null) {
    this.db.prepare('DELETE FROM cards_fts WHERE rowid = ?').run(id);
    if (title !== null) this.db.prepare('INSERT INTO cards_fts(rowid, title, notes) VALUES (?, ?, ?)').run(id, title, notes ?? '');
  }

  private ensureTag(name: string): number {
    const t = name.trim().replace(/^#/, '');
    if (!t || t.length > 40) throw new BoardError(`invalid tag "${name}"`);
    const ex = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(t) as { id: number } | undefined;
    if (ex) return ex.id;
    const id = Number(this.db.prepare('INSERT INTO tags(name, color) VALUES (?, NULL)').run(t).lastInsertRowid);
    this.record('tag', id, 'create', null, { id, name: t, color: null });
    return id;
  }

  private setTags(cardId: number, names: string[]) {
    const ids = [...new Set(names.map((n) => this.ensureTag(n)))];
    this.db.prepare('DELETE FROM card_tags WHERE card_id = ?').run(cardId);
    const ins = this.db.prepare('INSERT OR IGNORE INTO card_tags(card_id, tag_id) VALUES (?, ?)');
    for (const id of ids) ins.run(cardId, id);
  }

  /** Find a project by name, creating it (recorded) if new. */
  ensureProject(name: string): number {
    const t = clean(name, 60, 'project name');
    if (!t) throw new BoardError('project name is empty');
    const ex = this.board.findProject(t);
    if (ex) {
      if (ex.archived_at) this.updateProject(ex.id, { archived: false });
      return ex.id;
    }
    return this.createProject({ name: t }).id;
  }

  /** Cards placed at the top within this batch, per column: later ones go below earlier ones, above everything else. */
  private topRun = new Map<number, { last: number; floor: number }>();

  private positionAtTop(columnId: number): number {
    const run = this.topRun.get(columnId);
    if (run) {
      run.last = (run.last + run.floor) / 2;
      return run.last;
    }
    const r = this.db.prepare('SELECT MIN(position) AS p FROM cards WHERE column_id = ? AND archived_at IS NULL').get(columnId) as { p: number | null };
    const floor = r.p ?? 1024 * 1024;
    const last = floor - 1024;
    this.topRun.set(columnId, { last, floor });
    return last;
  }

  private positionAtEnd(columnId: number): number {
    const r = this.db.prepare('SELECT MAX(position) AS p FROM cards WHERE column_id = ? AND archived_at IS NULL').get(columnId) as { p: number | null };
    return (r.p ?? 0) + 1024;
  }

  /** Position for a drop between two neighbours (either may be omitted). */
  positionBetween(columnId: number, movingId: number | null, beforeId?: number | null, afterId?: number | null): number {
    const list = this.db.prepare('SELECT id, position FROM cards WHERE column_id = ? AND archived_at IS NULL AND id IS NOT ? ORDER BY position').all(columnId, movingId) as { id: number; position: number }[];
    let lo: number | null = null, hi: number | null = null;
    if (beforeId) {
      const i = list.findIndex((x) => x.id === beforeId);
      if (i >= 0) { lo = list[i].position; hi = list[i + 1]?.position ?? null; }
    } else if (afterId) {
      const i = list.findIndex((x) => x.id === afterId);
      if (i >= 0) { hi = list[i].position; lo = list[i - 1]?.position ?? null; }
    } else {
      return (list.at(-1)?.position ?? 0) + 1024;
    }
    if (lo === null && hi === null) return (list.at(-1)?.position ?? 0) + 1024;
    if (lo === null) return hi! - 1024;
    if (hi === null) return lo + 1024;
    if (hi - lo < 1e-6) {
      // Out of room: respace the column (positions only; order is unchanged so undo stays correct).
      const up = this.db.prepare('UPDATE cards SET position = ? WHERE id = ?');
      list.forEach((x, i) => up.run((i + 1) * 1024, x.id));
      return this.positionBetween(columnId, movingId, beforeId, afterId);
    }
    return (lo + hi) / 2;
  }

  /** Turn caller input into column values. Throws BoardError with a readable message on bad input. */
  private normalize(input: CardInput, existing: Card | null): Partial<CardRow> & { _tags?: string[] } {
    const s = this.settings;
    const out: Partial<CardRow> & { _tags?: string[] } = {};
    if (input.title !== undefined) {
      const t = clean(input.title, MAX_TITLE, 'title');
      if (!t) throw new BoardError('title is empty');
      out.title = t;
    }
    if (input.notes !== undefined) out.notes = input.notes === null ? '' : clean(input.notes, MAX_NOTES, 'notes');
    if (input.column_id !== undefined) out.column_id = this.board.column(input.column_id).id;
    else if (input.column !== undefined && input.column !== null && input.column !== '') out.column_id = this.board.resolveColumn(input.column).id;
    if (input.priority !== undefined) out.priority = parsePriority(input.priority) ?? 2;
    if (input.due !== undefined) {
      if (input.due === null || /^(none|no date|clear|remove|someday)$/i.test(String(input.due).trim())) { out.due_at = null; out.due_has_time = 0; }
      else {
        const d = parseDate(String(input.due), s.timezone, this.now, s.week_starts_on);
        if (!d) throw new BoardError(`could not understand the date "${input.due}". Try "friday", "tomorrow 5pm", "in 3 days" or "2026-12-01".`);
        out.due_at = d.due_at;
        out.due_has_time = d.has_time ? 1 : 0;
      }
    } else if (input.due_at !== undefined) {
      if (input.due_at !== null && (!Number.isFinite(input.due_at) || input.due_at < 0)) throw new BoardError('due_at must be epoch milliseconds');
      out.due_at = input.due_at;
      out.due_has_time = input.due_at === null ? 0 : input.due_has_time === false ? 0 : 1;
      if (input.due_at !== null && input.due_has_time === false) out.due_at = endOfDay(localDay(input.due_at, s.timezone), s.timezone);
    }
    if (input.planned_for !== undefined) {
      const p = input.planned_for;
      if (p === null || p === '') out.planned_for = null;
      else if (/^today$/i.test(p)) out.planned_for = localDay(this.now, s.timezone);
      else if (/^tomorrow$/i.test(p)) out.planned_for = addDays(localDay(this.now, s.timezone), 1);
      else if (isDay(p)) out.planned_for = p;
      else {
        const d = parseDate(p, s.timezone, this.now, s.week_starts_on);
        if (!d) throw new BoardError(`invalid planned_for "${p}"`);
        out.planned_for = d.day;
      }
    }
    if (input.estimate_min !== undefined) {
      try { out.estimate_min = parseEstimate(input.estimate_min as any); } catch (e: any) { throw new BoardError(e.message); }
      if (out.estimate_min !== null && (out.estimate_min < 1 || out.estimate_min > 100_000)) throw new BoardError('estimate out of range');
    }
    if (input.project_id !== undefined) out.project_id = input.project_id === null ? null : this.board.project(input.project_id).id;
    else if (input.project !== undefined) out.project_id = input.project === null || input.project === '' ? null : this.ensureProject(input.project);
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags)) throw new BoardError('tags must be a list');
      out._tags = input.tags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean);
    }
    if (input.checklist !== undefined) {
      if (!Array.isArray(input.checklist)) throw new BoardError('checklist must be a list');
      out.checklist = JSON.stringify(input.checklist.slice(0, 100).map((i) => typeof i === 'string'
        ? { id: newId(), text: clean(i, 500, 'checklist item'), done: false }
        : { id: newId(), text: clean(i.text, 500, 'checklist item'), done: !!i.done }).filter((i) => i.text));
    }
    if (input.links !== undefined) out.links = JSON.stringify(normLinks(input.links));
    if (input.blocked_reason !== undefined) out.blocked_reason = input.blocked_reason === null || input.blocked_reason === '' ? null : clean(input.blocked_reason, 500, 'blocked reason') || 'blocked';
    if (input.needs_review !== undefined) out.needs_review = input.needs_review ? 1 : 0;
    if (input.recurrence !== undefined) {
      let r: Recurrence | null;
      try { r = normalizeRecurrence(input.recurrence); } catch (e: any) { throw new BoardError(e.message); }
      out.recurrence = r ? JSON.stringify(r) : null;
      // A recurring card needs a due date to repeat from.
      const hasDue = out.due_at !== undefined ? out.due_at !== null : !!existing?.due_at;
      if (r && !hasDue) {
        const day = firstOccurrence(r, localDay(this.now, s.timezone));
        out.due_at = endOfDay(day, s.timezone);
        out.due_has_time = 0;
      }
    }
    if (input.source !== undefined) out.source = input.source === null ? null : JSON.stringify(normSource(input.source));
    return out;
  }

  // ------------------------------------------------------------------ cards

  createCard(input: CardInput, opts: { top?: boolean } = {}): Card {
    if (!input.title) throw new BoardError('title is required');
    if (input.client_ref) {
      const ex = this.db.prepare('SELECT id FROM cards WHERE client_ref = ?').get(String(input.client_ref)) as { id: number } | undefined;
      if (ex) return this.board.mustCard(ex.id);
    }
    const v = this.normalize(input, null);
    const column_id = v.column_id ?? (this.board.columnOfKind('todo') ?? this.board.columns()[0]).id;
    const kind = this.board.kindOf(column_id);
    const position = opts.top === false ? this.positionAtEnd(column_id) : this.positionAtTop(column_id);
    const id = Number(this.db.prepare(`INSERT INTO cards(column_id, position, title, notes, priority, due_at, due_has_time, planned_for, estimate_min,
      project_id, checklist, links, blocked_reason, needs_review, recurrence, source, created_by, created_client, source_utterance, client_ref,
      created_at, updated_at, started_at, completed_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
      column_id, position, v.title!, v.notes ?? '', v.priority ?? 2, v.due_at ?? null, v.due_has_time ?? 0, v.planned_for ?? null, v.estimate_min ?? null,
      v.project_id ?? null, v.checklist ?? '[]', v.links ?? '[]', v.blocked_reason ?? null, v.needs_review ?? 0, v.recurrence ?? null, v.source ?? null,
      this.meta.actor, this.meta.client ?? null, this.meta.actor === 'ann' ? this.meta.utterance?.slice(0, 2000) ?? null : null, input.client_ref ?? null,
      this.now, this.now, ACTIVE_KINDS.has(kind) ? this.now : null, kind === 'done' ? this.now : null,
    ).lastInsertRowid);
    if (v._tags?.length) this.setTags(id, v._tags);
    this.syncFts(id, v.title!, v.notes ?? '');
    this.transition(id, null, column_id);
    const card = this.board.mustCard(id);
    this.record('card', id, 'create', null, card);
    return card;
  }

  /** Apply a patch. Handles column side effects (started/completed, focus stop, recurrence) and optimistic locking. */
  updateCard(id: number, patch: CardPatch): Card {
    const before = this.board.mustCard(id);
    if (patch.version !== undefined && patch.version !== before.version)
      throw new BoardError(`card #${id} changed since you loaded it (version ${before.version}, you had ${patch.version}). Reload and retry.`, 409, { card: before });
    const v = this.normalize(patch, before);
    const sets: Record<string, any> = {};
    for (const k of ['title', 'notes', 'priority', 'due_at', 'due_has_time', 'planned_for', 'estimate_min', 'project_id', 'checklist', 'links', 'blocked_reason', 'needs_review', 'recurrence', 'source'] as const)
      if (v[k] !== undefined) sets[k] = v[k];

    if (patch.append_note) {
      const add = clean(patch.append_note, MAX_NOTES, 'note');
      const stamp = localDay(this.now, this.settings.timezone);
      const base = sets.notes ?? before.notes;
      sets.notes = (base ? base + '\n\n' : '') + `**${stamp}:** ${add}`;
      if (sets.notes.length > MAX_NOTES) throw new BoardError('notes are too long');
    }
    if (patch.checklist_ops?.length) {
      const list: ChecklistItem[] = j(sets.checklist ?? JSON.stringify(before.checklist), []);
      for (const op of patch.checklist_ops) {
        if (op.op === 'add') { const t = clean(op.text, 500, 'checklist item'); if (t) list.push({ id: newId(), text: t, done: false }); continue; }
        const i = list.findIndex((x) => x.id === op.id) >= 0 ? list.findIndex((x) => x.id === op.id) : matchItem(list, op.id);
        if (i < 0) throw new BoardError(`checklist item "${op.id}" not found on #${id}`, 404);
        if (op.op === 'toggle') list[i].done = !list[i].done;
        else if (op.op === 'check') list[i].done = true;
        else if (op.op === 'uncheck') list[i].done = false;
        else if (op.op === 'remove') list.splice(i, 1);
        else if (op.op === 'edit') list[i].text = clean(op.text, 500, 'checklist item');
      }
      sets.checklist = JSON.stringify(list);
    }
    if (patch.add_links?.length) sets.links = JSON.stringify([...j<CardLink[]>(sets.links ?? JSON.stringify(before.links), []), ...normLinks(patch.add_links)].slice(0, 50));

    let tags: string[] | undefined = v._tags;
    if (patch.add_tags?.length || patch.remove_tags?.length) {
      const cur = new Map((tags ?? before.tags).map((t) => [t.toLowerCase(), t]));
      for (const t of patch.add_tags ?? []) { const n = t.trim().replace(/^#/, ''); if (n) cur.set(n.toLowerCase(), n); }
      for (const t of patch.remove_tags ?? []) cur.delete(t.trim().replace(/^#/, '').toLowerCase());
      tags = [...cur.values()];
    }

    let spawned: Card | null = null;
    if (v.column_id !== undefined && v.column_id !== before.column_id) {
      const from = this.board.kindOf(before.column_id), to = this.board.kindOf(v.column_id);
      sets.column_id = v.column_id;
      sets.position = this.positionAtTop(v.column_id);
      if (ACTIVE_KINDS.has(to) && !before.started_at) sets.started_at = this.now;
      if (to === 'done') {
        sets.completed_at = this.now;
        // Ann's completions earn nothing until the owner confirms them in the web app.
        sets.credit_pending = this.meta.actor === 'ann' ? 1 : 0;
        if (before.focus_started_at) Object.assign(sets, this.stopFocusSets(before));
        sets.blocked_reason = null;
      } else if (from === 'done') { sets.completed_at = null; sets.credit_pending = 0; }
      if (to === 'done' && before.recurrence) {
        spawned = this.spawnNext(before);
        sets.recurrence = null;
      }
    }

    const tagsChanged = tags !== undefined && JSON.stringify([...tags].sort()) !== JSON.stringify([...before.tags].sort());
    const changed = Object.keys(sets).filter((k) => JSON.stringify(sets[k]) !== JSON.stringify(rowValue(before, k)));
    if (!changed.length && !tagsChanged) return before;
    sets.updated_at = this.now;
    sets.version = before.version + 1;
    const keys = Object.keys(sets);
    this.db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), id);
    if (tags !== undefined && tagsChanged) this.setTags(id, tags);
    if (sets.title !== undefined || sets.notes !== undefined) this.syncFts(id, sets.title ?? before.title, sets.notes ?? before.notes);
    if (sets.column_id !== undefined) this.transition(id, before.column_id, sets.column_id);
    const after = this.board.mustCard(id);
    this.record('card', id, 'update', before, after);
    if (spawned) this.notes.push(`Next "${spawned.title}" (#${spawned.id}) is due ${localDay(spawned.due_at!, this.settings.timezone)}.`);
    if (sets.column_id !== undefined) this.wipCheck(sets.column_id);
    return after;
  }

  /** Move to a column at a position between neighbours (UI drag and drop). */
  moveCard(id: number, columnId: number, beforeId?: number | null, afterId?: number | null): Card {
    const card = this.board.mustCard(id);
    if (card.archived_at) throw new BoardError(`card #${id} is archived`);
    let after = card;
    if (columnId !== card.column_id) after = this.updateCard(id, { column_id: columnId });
    const position = this.positionBetween(columnId, id, beforeId, afterId);
    if (position !== after.position) {
      const prev = this.board.mustCard(id);
      this.db.prepare('UPDATE cards SET position = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(position, this.now, id);
      const next = this.board.mustCard(id);
      // Fold into the existing change for this card when there is one, so the batch stays one change per card.
      const existing = this.changes.find((c) => c.entity === 'card' && c.entity_id === id && c.op === 'update');
      if (existing) existing.after = next;
      else this.record('card', id, 'update', prev, next);
      after = next;
    }
    return after;
  }

  private wipCheck(columnId: number) {
    const col = this.board.column(columnId);
    if (!col.wip_limit) return;
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE column_id = ? AND archived_at IS NULL').get(columnId) as { n: number }).n;
    if (n > col.wip_limit) this.notes.push(`WIP limit: "${col.name}" now has ${n} cards (limit ${col.wip_limit}). Finish something before starting more.`);
  }

  private spawnNext(card: Card): Card {
    const tz = this.settings.timezone;
    const today = localDay(this.now, tz);
    const r = card.recurrence!;
    let day = nextOccurrence(r, card.due_at ? localDay(card.due_at, tz) : today);
    for (let i = 0; day <= today && i < 1000; i++) day = nextOccurrence(r, day);
    let due_at = endOfDay(day, tz);
    if (card.due_has_time && card.due_at) {
      const p = localParts(card.due_at, tz);
      const d = parseDay(day);
      due_at = zonedTime(d.y, d.m, d.d, p.h, p.mi, tz);
    }
    const todo = this.board.columnOfKind('todo') ?? this.board.columns()[0];
    return this.createCard({
      title: card.title, notes: card.notes, column_id: todo.id, priority: card.priority, due_at, due_has_time: card.due_has_time,
      estimate_min: card.estimate_min, project_id: card.project_id, tags: card.tags,
      checklist: card.checklist.map((i) => ({ text: i.text, done: false })), links: card.links, recurrence: r, source: card.source,
    });
  }

  archiveCard(id: number): Card {
    const before = this.board.mustCard(id);
    if (before.archived_at) return before;
    const sets: Record<string, any> = { archived_at: this.now, updated_at: this.now, version: before.version + 1 };
    if (before.focus_started_at) Object.assign(sets, this.stopFocusSets(before));
    const keys = Object.keys(sets);
    this.db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), id);
    this.transition(id, before.column_id, null);
    const after = this.board.mustCard(id);
    this.record('card', id, 'archive', before, after);
    return after;
  }

  restoreCard(id: number): Card {
    const before = this.board.mustCard(id);
    if (!before.archived_at) return before;
    this.db.prepare('UPDATE cards SET archived_at = NULL, position = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(this.positionAtTop(before.column_id), this.now, id);
    this.transition(id, null, before.column_id);
    const after = this.board.mustCard(id);
    this.record('card', id, 'restore', before, after);
    return after;
  }

  /** Permanent delete (archived cards only; the UI's "empty trash"). Undo recreates it from the snapshot. */
  deleteCard(id: number) {
    const before = this.board.mustCard(id);
    if (!before.archived_at) throw new BoardError(`archive #${id} before deleting it permanently`, 409);
    this.putCard(id, null);
    this.record('card', id, 'delete', before, null);
  }

  private stopFocusSets(card: Card): Record<string, any> {
    const minutes = Math.round((this.now - card.focus_started_at!) / 60000);
    if (minutes >= 1) this.db.prepare('INSERT INTO focus_log(card_id, started_at, ended_at, minutes) VALUES (?, ?, ?, ?)').run(card.id, card.focus_started_at, this.now, minutes);
    this.notes.push(minutes >= 1 ? `Logged ${minutes} min on #${card.id}.` : `Focus on #${card.id} stopped (under a minute, not logged).`);
    return { focus_started_at: null, spent_min: card.spent_min + Math.max(minutes, 0) };
  }

  focus(id: number, action: 'start' | 'stop'): Card {
    const card = this.board.mustCard(id);
    if (action === 'stop') {
      if (!card.focus_started_at) return card;
      return this.writeRaw(card, this.stopFocusSets(card));
    }
    if (card.archived_at) throw new BoardError(`card #${id} is archived`);
    for (const other of this.board.openCards().filter((c) => c.focus_started_at && c.id !== id)) this.writeRaw(other, this.stopFocusSets(other));
    let cur = card;
    const kind = this.board.kindOf(card.column_id);
    if (kind === 'backlog' || kind === 'todo' || kind === 'done') {
      const doing = this.board.columnOfKind('doing');
      if (doing) cur = this.updateCard(id, { column_id: doing.id });
    }
    if (cur.focus_started_at) return cur;
    // Lock the priority that credit is paid at, so raising it just before finishing earns nothing extra.
    return this.writeRaw(cur, { focus_started_at: this.now, ...(cur.credit_priority === null ? { credit_priority: cur.priority } : {}) });
  }

  /** Focus done without a timer, logged by hand with a reason (limits: Wallet.checkManualFocus). Earns like timed focus. */
  logFocus(id: number, minutes: number, reason: string): Card {
    if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 480) throw new BoardError('minutes must be a whole number between -480 and 480');
    if (!reason?.trim() || reason.trim().length < 5) throw new BoardError('say what the work was (a reason of 5+ characters)');
    const card = this.board.mustCard(id);
    this.db.prepare('INSERT INTO focus_log(card_id, started_at, ended_at, minutes, manual) VALUES (?, ?, ?, ?, ?)').run(id, this.now, this.now, minutes, reason.trim().slice(0, 200));
    return this.writeRaw(card, { spent_min: Math.max(0, card.spent_min + minutes) });
  }

  logTime(id: number, minutes: number): Card {
    if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 24 * 60) throw new BoardError('minutes must be a whole number between -1440 and 1440');
    const card = this.board.mustCard(id);
    return this.writeRaw(card, { spent_min: Math.max(0, card.spent_min + minutes) });
  }

  /** Set raw columns and record the change (merging into an existing change for the same card in this batch). */
  private writeRaw(before: Card, sets: Record<string, any>): Card {
    const s: Record<string, any> = { ...sets, updated_at: this.now, version: before.version + 1 };
    const keys = Object.keys(s);
    this.db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => s[k]), before.id);
    const after = this.board.mustCard(before.id);
    const existing = this.changes.find((c) => c.entity === 'card' && c.entity_id === before.id && c.op === 'update');
    if (existing) existing.after = after;
    else this.record('card', before.id, 'update', before, after);
    return after;
  }

  /** Write a card snapshot back verbatim (undo). null deletes the card. */
  private putCard(id: number, snap: Card | null) {
    const cur = this.board.card(id);
    const eff = (c: Card | null) => (c && !c.archived_at ? c.column_id : null);
    if (!snap) {
      this.db.prepare('DELETE FROM card_tags WHERE card_id = ?').run(id);
      this.db.prepare('DELETE FROM cards WHERE id = ?').run(id);
      this.syncFts(id, null, null);
      if (eff(cur) !== null) this.transition(id, eff(cur), null);
      return;
    }
    // A column deleted since: fall back to the first column of the same kind.
    let column_id = snap.column_id;
    if (!this.db.prepare('SELECT 1 FROM columns WHERE id = ?').get(column_id)) column_id = (this.board.columnOfKind(this.guessKind(snap)) ?? this.board.columns()[0]).id;
    let project_id = snap.project_id;
    if (project_id !== null && !this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(project_id)) project_id = null;
    const vals = {
      column_id, position: snap.position, title: snap.title, notes: snap.notes, priority: snap.priority, due_at: snap.due_at,
      due_has_time: snap.due_has_time ? 1 : 0, planned_for: snap.planned_for, estimate_min: snap.estimate_min, spent_min: snap.spent_min,
      project_id, checklist: JSON.stringify(snap.checklist), links: JSON.stringify(snap.links), blocked_reason: snap.blocked_reason,
      needs_review: snap.needs_review ? 1 : 0, recurrence: snap.recurrence ? JSON.stringify(snap.recurrence) : null,
      source: snap.source ? JSON.stringify(snap.source) : null,
      focus_started_at: snap.focus_started_at, created_by: snap.created_by, created_client: snap.created_client,
      source_utterance: snap.source_utterance, created_at: snap.created_at, updated_at: this.now, started_at: snap.started_at,
      completed_at: snap.completed_at, archived_at: snap.archived_at, version: (cur?.version ?? snap.version) + 1,
    };
    const keys = Object.keys(vals) as (keyof typeof vals)[];
    if (cur) this.db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => vals[k]), id);
    else this.db.prepare(`INSERT INTO cards(id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).run(id, ...keys.map((k) => vals[k]));
    this.setTags(id, snap.tags);
    this.syncFts(id, snap.title, snap.notes);
    const next = this.board.card(id)!;
    if (eff(cur) !== eff(next)) this.transition(id, eff(cur), eff(next));
  }

  private guessKind(c: Card): ColumnKind {
    return c.completed_at ? 'done' : c.started_at ? 'doing' : 'todo';
  }

  // ------------------------------------------------------------------ columns

  createColumn(input: { name: string; kind: ColumnKind; wip_limit?: number | null; color?: string | null; after_id?: number }): Column {
    const name = clean(input.name, 40, 'column name');
    if (!name) throw new BoardError('column name is empty');
    if (!COLUMN_KINDS.includes(input.kind)) throw new BoardError(`kind must be one of ${COLUMN_KINDS.join(', ')}`);
    const cols = this.board.columns();
    let position = (cols.at(-1)?.position ?? 0) + 1024;
    if (input.after_id) {
      const i = cols.findIndex((c) => c.id === input.after_id);
      if (i >= 0) position = cols[i + 1] ? (cols[i].position + cols[i + 1].position) / 2 : cols[i].position + 1024;
    } else {
      // Default: keep "done" columns last.
      const firstDone = cols.find((c) => c.kind === 'done');
      if (input.kind !== 'done' && firstDone) {
        const i = cols.indexOf(firstDone);
        position = i > 0 ? (cols[i - 1].position + firstDone.position) / 2 : firstDone.position - 1024;
      }
    }
    const id = Number(this.db.prepare('INSERT INTO columns(name, kind, position, wip_limit, color) VALUES (?, ?, ?, ?, ?)').run(name, input.kind, position, wipValue(input.wip_limit), input.color ?? null).lastInsertRowid);
    const col = this.board.column(id);
    this.record('column', id, 'create', null, col);
    return col;
  }

  updateColumn(id: number, patch: { name?: string; kind?: ColumnKind; wip_limit?: number | null; color?: string | null; position?: number }): Column {
    const before = this.board.column(id);
    const next = { ...before };
    if (patch.name !== undefined) { next.name = clean(patch.name, 40, 'column name'); if (!next.name) throw new BoardError('column name is empty'); }
    if (patch.kind !== undefined) {
      if (!COLUMN_KINDS.includes(patch.kind)) throw new BoardError(`kind must be one of ${COLUMN_KINDS.join(', ')}`);
      next.kind = patch.kind;
    }
    if (patch.wip_limit !== undefined) next.wip_limit = wipValue(patch.wip_limit);
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.position !== undefined) next.position = patch.position;
    if (JSON.stringify(next) === JSON.stringify(before)) return before;
    this.putColumn(id, next);
    this.record('column', id, 'update', before, next);
    return next;
  }

  reorderColumns(ids: number[]): Column[] {
    const cols = this.board.columns();
    if (ids.length !== cols.length || !cols.every((c) => ids.includes(c.id))) throw new BoardError('reorder needs every column id exactly once');
    ids.forEach((id, i) => this.updateColumn(id, { position: (i + 1) * 1024 }));
    return this.board.columns();
  }

  deleteColumn(id: number) {
    const before = this.board.column(id);
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE column_id = ?').get(id) as { n: number }).n;
    if (n) throw new BoardError(`"${before.name}" still has ${n} card${n > 1 ? 's' : ''} (archived ones count). Move them first.`, 409);
    if (this.board.columns().length <= 1) throw new BoardError('the board needs at least one column', 409);
    this.putColumn(id, null);
    this.record('column', id, 'delete', before, null);
  }

  private putColumn(id: number, c: Column | null) {
    if (!c) { this.db.prepare('DELETE FROM columns WHERE id = ?').run(id); return; }
    const exists = this.db.prepare('SELECT 1 FROM columns WHERE id = ?').get(id);
    if (exists) this.db.prepare('UPDATE columns SET name = ?, kind = ?, position = ?, wip_limit = ?, color = ? WHERE id = ?').run(c.name, c.kind, c.position, c.wip_limit, c.color, id);
    else this.db.prepare('INSERT INTO columns(id, name, kind, position, wip_limit, color) VALUES (?, ?, ?, ?, ?, ?)').run(id, c.name, c.kind, c.position, c.wip_limit, c.color);
  }

  // ------------------------------------------------------------------ projects

  createProject(input: { name: string; color?: string; icon?: string | null; description?: string | null }): Project {
    const name = clean(input.name, 60, 'project name');
    if (!name) throw new BoardError('project name is empty');
    if (this.board.findProject(name)) throw new BoardError(`project "${name}" already exists`, 409);
    const used = new Set(this.board.projects().map((p) => p.color));
    const color = validColor(input.color) ?? PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[this.board.projects().length % PROJECT_COLORS.length];
    const id = Number(this.db.prepare('INSERT INTO projects(name, color, icon, description, archived_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
      .run(name, color, input.icon ?? null, input.description ?? null, this.now).lastInsertRowid);
    const p = this.board.project(id);
    this.record('project', id, 'create', null, p);
    return p;
  }

  updateProject(id: number, patch: { name?: string; color?: string; icon?: string | null; description?: string | null; archived?: boolean }): Project {
    const before = this.board.project(id);
    const next = { ...before };
    if (patch.name !== undefined) {
      next.name = clean(patch.name, 60, 'project name');
      const clash = this.board.findProject(next.name);
      if (!next.name || (clash && clash.id !== id)) throw new BoardError(`project "${patch.name}" already exists`, 409);
    }
    if (patch.color !== undefined) next.color = validColor(patch.color) ?? before.color;
    if (patch.icon !== undefined) next.icon = patch.icon || null;
    if (patch.description !== undefined) next.description = patch.description || null;
    if (patch.archived !== undefined) next.archived_at = patch.archived ? (before.archived_at ?? this.now) : null;
    if (JSON.stringify(next) === JSON.stringify(before)) return before;
    this.putProject(id, next);
    this.record('project', id, patch.archived === true ? 'archive' : patch.archived === false ? 'restore' : 'update', before, next);
    return next;
  }

  private putProject(id: number, p: Project | null) {
    if (!p) {
      this.db.prepare('UPDATE cards SET project_id = NULL WHERE project_id = ?').run(id);
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return;
    }
    const exists = this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id);
    if (exists) this.db.prepare('UPDATE projects SET name = ?, color = ?, icon = ?, description = ?, archived_at = ? WHERE id = ?').run(p.name, p.color, p.icon, p.description, p.archived_at, id);
    else this.db.prepare('INSERT INTO projects(id, name, color, icon, description, archived_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, p.name, p.color, p.icon, p.description, p.archived_at, p.created_at);
  }

  // ------------------------------------------------------------------ tags

  updateTag(id: number, patch: { name?: string; color?: string | null }): Tag {
    const before = this.db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(id) as { id: number; name: string; color: string | null } | undefined;
    if (!before) throw new BoardError(`tag ${id} not found`, 404);
    const next = { ...before };
    if (patch.name !== undefined) {
      next.name = clean(patch.name, 40, 'tag name').replace(/^#/, '');
      const clash = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?').get(next.name, id);
      if (!next.name || clash) throw new BoardError(`tag "${next.name}" already exists: merge instead`, 409);
    }
    if (patch.color !== undefined) next.color = patch.color === null ? null : validColor(patch.color) ?? before.color;
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      // Cards reference the tag by id, so a rename (and its undo) carries them along.
      this.db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(next.name, next.color, id);
      this.record('tag', id, 'update', before, next);
    }
    return this.board.tags().find((t) => t.id === id)!;
  }

  mergeTags(sourceId: number, targetId: number): Tag {
    if (sourceId === targetId) throw new BoardError('cannot merge a tag into itself');
    const src = this.db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(sourceId) as { id: number; name: string; color: string | null } | undefined;
    const dst = this.db.prepare('SELECT id, name FROM tags WHERE id = ?').get(targetId) as { id: number; name: string } | undefined;
    if (!src || !dst) throw new BoardError('tag not found', 404);
    const ids = (this.db.prepare('SELECT card_id FROM card_tags WHERE tag_id = ?').all(sourceId) as { card_id: number }[]).map((r) => r.card_id);
    for (const id of ids) {
      const c = this.board.mustCard(id);
      this.updateCard(id, { tags: [...c.tags.filter((t) => t.toLowerCase() !== src.name.toLowerCase()), dst.name] });
    }
    this.db.prepare('DELETE FROM card_tags WHERE tag_id = ?').run(sourceId);
    this.db.prepare('DELETE FROM tags WHERE id = ?').run(sourceId);
    this.record('tag', sourceId, 'delete', src, null);
    return this.board.tags().find((t) => t.id === targetId)!;
  }

  private putTag(id: number, t: { id: number; name: string; color: string | null } | null) {
    if (!t) { this.db.prepare('DELETE FROM card_tags WHERE tag_id = ?').run(id); this.db.prepare('DELETE FROM tags WHERE id = ?').run(id); return; }
    const exists = this.db.prepare('SELECT 1 FROM tags WHERE id = ?').get(id);
    if (exists) this.db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(t.name, t.color, id);
    else {
      // A same-named tag may have been created since; keep that one.
      if (this.db.prepare('SELECT 1 FROM tags WHERE name = ? COLLATE NOCASE').get(t.name)) return;
      this.db.prepare('INSERT INTO tags(id, name, color) VALUES (?, ?, ?)').run(id, t.name, t.color);
    }
  }

  // ------------------------------------------------------------------ settings

  updateSettings(patch: Partial<Settings>): Settings {
    const before = this.board.settings();
    const next: Settings = { ...before };
    if (patch.timezone !== undefined) {
      if (!isValidTimezone(patch.timezone)) throw new BoardError(`unknown timezone "${patch.timezone}" (use an IANA name like "Asia/Kolkata")`);
      next.timezone = patch.timezone;
    }
    const int = (v: unknown, lo: number, hi: number, name: string) => {
      if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new BoardError(`${name} must be a whole number from ${lo} to ${hi}`);
      return v as number;
    };
    if (patch.day_capacity_min !== undefined) next.day_capacity_min = int(patch.day_capacity_min, 30, 960, 'day_capacity_min');
    if (patch.focus_min !== undefined) next.focus_min = int(patch.focus_min, 5, 180, 'focus_min');
    if (patch.stale_after_days !== undefined) next.stale_after_days = int(patch.stale_after_days, 1, 90, 'stale_after_days');
    if (patch.week_starts_on !== undefined) next.week_starts_on = patch.week_starts_on === 0 ? 0 : 1;
    for (const k of ['work_start', 'work_end'] as const) if (patch[k] !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch[k]!)) throw new BoardError(`${k} must be HH:MM`);
      next[k] = patch[k]!;
    }
    if (patch.display_name !== undefined) next.display_name = clean(patch.display_name, 40, 'display name');
    if (JSON.stringify(next) === JSON.stringify(before)) return before;
    this.putSettings(next);
    this.record('settings', 'settings', 'update', before, next);
    return next;
  }

  private putSettings(s: Settings) {
    const up = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(s)) up.run(k, JSON.stringify(v));
    this.touchedSettings = true;
    (this.board as any).settingsCache = null;
  }

  // ------------------------------------------------------------------ undo

  /** Put one entity back to its "before" state. Returns a conflict message instead when it changed since. */
  revert(ch: Change): string | null {
    const id = ch.entity_id;
    if (ch.entity === 'card') {
      const cur = this.board.card(Number(id));
      const after = ch.after as Card | null;
      if (after ? !cur || cur.version !== after.version : !!cur) return `#${id} "${(cur ?? (ch.before as Card))?.title}" was changed again later`;
      const before = ch.before as Card | null;
      this.putCard(Number(id), before);
      this.record('card', Number(id), before ? (after ? 'update' : 'create') : 'delete', cur, before ? this.board.card(Number(id)) : null);
      return null;
    }
    if (ch.entity === 'column') {
      const cur = this.db.prepare('SELECT id, name, kind, position, wip_limit, color FROM columns WHERE id = ?').get(Number(id)) ?? null;
      if (JSON.stringify(cur) !== JSON.stringify(ch.after ?? null)) return `column "${(ch.after as Column | null)?.name ?? (ch.before as Column).name}" was changed again later`;
      if (!ch.before && this.db.prepare('SELECT 1 FROM cards WHERE column_id = ?').get(Number(id))) return `column "${(ch.after as Column).name}" has cards now`;
      this.putColumn(Number(id), ch.before as Column | null);
      this.record('column', Number(id), ch.before ? (ch.after ? 'update' : 'create') : 'delete', cur, ch.before);
      return null;
    }
    if (ch.entity === 'project') {
      const cur = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id)) ?? null;
      if (JSON.stringify(cur) !== JSON.stringify(ch.after ?? null)) return `project "${(ch.after as Project | null)?.name ?? (ch.before as Project).name}" was changed again later`;
      this.putProject(Number(id), ch.before as Project | null);
      this.record('project', Number(id), ch.before ? (ch.after ? 'update' : 'create') : 'delete', cur, ch.before);
      return null;
    }
    if (ch.entity === 'tag') {
      const cur = this.db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(Number(id)) ?? null;
      if (!ch.before && cur && this.db.prepare('SELECT 1 FROM card_tags WHERE tag_id = ?').get(Number(id))) return null; // still used: keep it
      this.putTag(Number(id), ch.before as any);
      this.record('tag', Number(id), ch.before ? (ch.after ? 'update' : 'create') : 'delete', cur, ch.before);
      return null;
    }
    if (ch.entity === 'settings') {
      const cur = this.board.settings();
      if (JSON.stringify(cur) !== JSON.stringify(ch.after)) return 'settings were changed again later';
      this.putSettings(ch.before as Settings);
      this.record('settings', 'settings', 'update', cur, ch.before);
      return null;
    }
    return null;
  }
}

// ------------------------------------------------------------------------ small helpers

function rowValue(c: Card, k: string): unknown {
  switch (k) {
    case 'due_has_time': return c.due_has_time ? 1 : 0;
    case 'needs_review': return c.needs_review ? 1 : 0;
    case 'checklist': return JSON.stringify(c.checklist);
    case 'links': return JSON.stringify(c.links);
    case 'recurrence': return c.recurrence ? JSON.stringify(c.recurrence) : null;
    case 'source': return c.source ? JSON.stringify(c.source) : null;
    default: return (c as any)[k];
  }
}

function matchItem(list: ChecklistItem[], ref: string): number {
  const t = ref.trim().toLowerCase();
  if (/^\d+$/.test(t)) { const i = Number(t) - 1; return i >= 0 && i < list.length ? i : -1; }
  let i = list.findIndex((x) => x.text.toLowerCase() === t);
  if (i < 0) {
    const hits = list.map((x, k) => (x.text.toLowerCase().includes(t) ? k : -1)).filter((k) => k >= 0);
    if (hits.length === 1) i = hits[0];
  }
  return i;
}

function normLinks(links: (string | CardLink)[]): CardLink[] {
  if (!Array.isArray(links)) throw new BoardError('links must be a list');
  return links.slice(0, 50).map((l) => {
    const url = typeof l === 'string' ? l.trim() : String(l.url ?? '').trim();
    let u: URL;
    try { u = new URL(url); } catch { throw new BoardError(`invalid link "${url}"`); }
    if (!/^https?:$/.test(u.protocol)) throw new BoardError(`links must be http(s): "${url}"`);
    const title = typeof l === 'string' ? undefined : l.title?.trim().slice(0, 200) || undefined;
    return title ? { url: u.href, title } : { url: u.href };
  });
}

/** Validate a cross-app source reference. The url is kept exactly as the other app returned it (http(s) only). */
export function normSource(s: unknown): CardSource {
  const o = s as Partial<CardSource> | null;
  if (!o || typeof o !== 'object') throw new BoardError('source must be { app, id, url?, title? }');
  const app = String(o.app ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(app)) throw new BoardError('source.app must be a short app name like "socrates"');
  const id = String(o.id ?? '').trim();
  if (!id || id.length > 200 || /[\u0000-\u001f]/.test(id)) throw new BoardError('source.id must be a stable id (1-200 characters)');
  const out: CardSource = { app, id };
  if (o.url !== undefined && o.url !== null && o.url !== '') {
    let u: URL;
    try { u = new URL(String(o.url)); } catch { throw new BoardError(`invalid source.url "${o.url}"`); }
    if (!/^https?:$/.test(u.protocol) || u.href.length > 2000) throw new BoardError('source.url must be an http(s) address');
    out.url = u.href;
  }
  if (o.title) out.title = clean(String(o.title), 200, 'source.title');
  return out;
}

function wipValue(v: unknown): number | null {
  if (v === null || v === undefined || v === 0) return null;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 99) throw new BoardError('wip_limit must be 1-99 or null');
  return v as number;
}

function validColor(c: unknown): string | null {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
}

export { daysBetween };
