import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = DatabaseSync;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = process.env.HEYANN_DATA ?? join(ROOT, 'data');
export const DEFAULT_DB_PATH = join(DATA_DIR, 'heyann.db');

/** Ordered migrations. Never edit an applied one; append a new entry. */
const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE columns (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,              -- backlog|todo|doing|review|done
    position REAL NOT NULL,
    wip_limit INTEGER,
    color TEXT
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT,
    description TEXT,
    archived_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX projects_name ON projects(name COLLATE NOCASE);

  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT
  );
  CREATE UNIQUE INDEX tags_name ON tags(name COLLATE NOCASE);

  CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    column_id INTEGER NOT NULL REFERENCES columns(id),
    position REAL NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 2,
    due_at INTEGER,
    due_has_time INTEGER NOT NULL DEFAULT 0,
    planned_for TEXT,
    estimate_min INTEGER,
    spent_min INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id),
    checklist TEXT NOT NULL DEFAULT '[]',
    links TEXT NOT NULL DEFAULT '[]',
    blocked_reason TEXT,
    needs_review INTEGER NOT NULL DEFAULT 0,
    recurrence TEXT,
    focus_started_at INTEGER,
    created_by TEXT NOT NULL,
    created_client TEXT,
    source_utterance TEXT,
    client_ref TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    archived_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX cards_client_ref ON cards(client_ref) WHERE client_ref IS NOT NULL;
  CREATE INDEX cards_column ON cards(column_id, position);
  CREATE INDEX cards_due ON cards(due_at) WHERE archived_at IS NULL;

  CREATE TABLE card_tags (
    card_id INTEGER NOT NULL REFERENCES cards(id),
    tag_id INTEGER NOT NULL REFERENCES tags(id),
    PRIMARY KEY (card_id, tag_id)
  );
  CREATE INDEX card_tags_tag ON card_tags(tag_id);

  -- rowid = card id; kept in sync by the card write path.
  CREATE VIRTUAL TABLE cards_fts USING fts5(title, notes, tokenize='porter unicode61');

  CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,             -- web|ann|system
    client TEXT,
    action TEXT NOT NULL,
    utterance TEXT,
    summary TEXT NOT NULL,
    undone_at INTEGER,
    undoes TEXT
  );
  CREATE INDEX batches_at ON batches(at);

  CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES batches(id),
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL,
    before TEXT,
    after TEXT
  );
  CREATE INDEX changes_batch ON changes(batch_id);
  CREATE INDEX changes_entity ON changes(entity, entity_id);

  -- Column history per card, for cumulative flow and cycle time. to_column NULL = archived/deleted.
  CREATE TABLE transitions (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    from_column INTEGER,
    to_column INTEGER
  );
  CREATE INDEX transitions_card ON transitions(card_id, at);
  CREATE INDEX transitions_at ON transitions(at);

  CREATE TABLE focus_log (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    minutes INTEGER NOT NULL
  );
  CREATE INDEX focus_log_at ON focus_log(ended_at);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    persistent INTEGER NOT NULL
  );
  `,
  /* 2: rewards (docs/REWARDS.md) */ `
  ALTER TABLE cards ADD COLUMN credit_priority INTEGER;       -- priority locked at the first focus session
  ALTER TABLE cards ADD COLUMN credit_pending INTEGER NOT NULL DEFAULT 0;  -- Ann completed it; owner must confirm

  -- Append-only screen-minute ledger. Balance = SUM(amount). Never edited; corrections are new rows.
  CREATE TABLE ledger (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL,             -- earn|bonus|clawback|allowance|forfeit|penalty|spend|refund|emergency|grant|fine|veto|expire|pause|back
    reason TEXT NOT NULL,
    card_id INTEGER,
    source TEXT NOT NULL,           -- system|web|ann|phone
    rule_version INTEGER NOT NULL,
    dedupe TEXT                     -- one-off events (daily allowance, a day's penalty) post at most once
  );
  CREATE UNIQUE INDEX ledger_dedupe ON ledger(dedupe) WHERE dedupe IS NOT NULL;
  CREATE INDEX ledger_at ON ledger(at);
  CREATE INDEX ledger_card ON ledger(card_id) WHERE card_id IS NOT NULL;

  CREATE TABLE devices (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER,
    revoked_at INTEGER
  );

  -- Prepaid phone sessions in walled apps: minutes are charged at start, unused whole minutes refunded at stop.
  CREATE TABLE phone_sessions (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL,
    app TEXT NOT NULL,
    kind TEXT NOT NULL,             -- spend|emergency
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    stopped_at INTEGER
  );
  CREATE INDEX phone_sessions_time ON phone_sessions(started_at);

  -- Per-app daily usage reported by the phone (baseline and stats).
  CREATE TABLE phone_usage (
    day TEXT NOT NULL,
    app TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    PRIMARY KEY (day, app)
  );

  CREATE TABLE pause_days (
    day TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- What each card's credit has been accounted at (nominal, before daily caps), so reconciling never pays twice.
  CREATE TABLE card_credit (
    card_id INTEGER PRIMARY KEY,
    base INTEGER NOT NULL DEFAULT 0,
    bonus INTEGER NOT NULL DEFAULT 0
  );

  -- Closing balance per local day (for the "3 days in debt" rule).
  CREATE TABLE wallet_days (
    day TEXT PRIMARY KEY,
    closing INTEGER NOT NULL
  );
  `,
  /* 3: where a card came from in another app (Orbit Hub) */ `
  ALTER TABLE cards ADD COLUMN source TEXT;   -- JSON {app, id, url?, title?}
  CREATE INDEX cards_source ON cards(json_extract(source, '$.app'), json_extract(source, '$.id')) WHERE source IS NOT NULL;
  `,
  /* 4: study rewards pushed by Socrates (docs/REWARDS.md §10). The ledger row (dedupe = event_id) is the payment;
     this keeps what the daily study sub-cap needs: the event's own study day and its minutes after overlap voiding. */ `
  CREATE TABLE study_events (
    event_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,              -- study_minutes|mastery_up
    day TEXT NOT NULL,               -- Socrates' study day, used as given
    received_at INTEGER NOT NULL,
    minutes REAL NOT NULL,           -- study minutes left after voiding overlap with focus and phone sessions
    base INTEGER NOT NULL,           -- wallet minutes this event used of the day's study sub-cap
    credited INTEGER NOT NULL,       -- what was actually paid (after the daily cap, debt and balance cap)
    note TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX study_events_day ON study_events(day);
  `,
];

export function openDb(path = DEFAULT_DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const isNew = path === ':memory:' || !existsSync(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db, path, isNew);
  return db;
}

function migrate(db: DB, path: string, isNew: boolean) {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current > MIGRATIONS.length) throw new Error(`Database schema v${current} is newer than this build (v${MIGRATIONS.length}). Update Hey Ann.`);
  if (current === MIGRATIONS.length) return;
  if (!isNew && current > 0) backup(db, path, `pre-v${MIGRATIONS.length}`);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

const BACKUP_KEEP = 14;

/** A consistent, integrity-checked copy in data/backups. Returns the file path. */
export function backup(db: DB, dbPath = DEFAULT_DB_PATH, label?: string): string | null {
  if (dbPath === ':memory:') return null;
  const dir = join(dirname(dbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = join(dir, `heyann-${stamp}${label ? '-' + label : ''}.db`);
  const status = (state: 'Succeeded' | 'Failed', extra: Record<string, unknown>) =>
    writeFileSync(join(dir, 'backup-status.json'), JSON.stringify({ state, at: new Date().toISOString(), ...extra }));
  try {
    if (existsSync(file)) unlinkSync(file);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const copy = new DatabaseSync(file, { readOnly: true });
    let check: string;
    try {
      check = (copy.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check).join('; ');
    } finally {
      copy.close();
    }
    if (check !== 'ok') {
      unlinkSync(file);
      throw new Error(`Backup copy failed its integrity check: ${check.slice(0, 500)}`);
    }
    status('Succeeded', { file: basename(file), bytes: statSync(file).size });
  } catch (e: any) {
    try { status('Failed', { error: String(e?.message ?? e).slice(0, 500) }); } catch {}
    throw e;
  }
  // Keep the newest dated daily backups; labelled ones (manual, pre-migration) are kept too but count toward the cap.
  const all = readdirSync(dir).filter((f) => /^heyann-.*\.db$/.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const old of all.slice(BACKUP_KEEP)) unlinkSync(join(dir, old.f));
  return file;
}

export function backupIfDue(db: DB, dbPath = DEFAULT_DB_PATH) {
  if (dbPath === ':memory:') return;
  const dir = join(dirname(dbPath), 'backups');
  const stamp = new Date().toISOString().slice(0, 10);
  const today = join(dir, `heyann-${stamp}.db`);
  if (existsSync(today) && Date.now() - statSync(today).mtimeMs < 864e5) return;
  backup(db, dbPath);
}

export function listBackups(dbPath: string) {
  const dir = join(dirname(dbPath), 'backups');
  if (dbPath === ':memory:' || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => {
    const s = statSync(join(dir, f));
    return { name: f, bytes: s.size, at: s.mtimeMs };
  }).sort((a, b) => b.at - a.at);
}

/** Run fn inside a write transaction (nested calls join the outer one). */
export function transaction<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
