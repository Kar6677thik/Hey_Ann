// Shared domain types. The server returns these shapes from /api and the UI imports them (type-only).
// Times are epoch milliseconds (UTC). Calendar days ("YYYY-MM-DD") are in the owner's timezone.

export type ColumnKind = 'backlog' | 'todo' | 'doing' | 'review' | 'done';

export interface Column {
  id: number;
  name: string;
  kind: ColumnKind;
  position: number;
  /** Soft limit: exceeding it warns, never blocks. Null: no limit. */
  wip_limit: number | null;
  color: string | null;
}

/** 0 = P0 urgent, 1 = P1 high, 2 = P2 normal (default), 3 = P3 low. */
export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_LABELS = ['Urgent', 'High', 'Normal', 'Low'] as const;

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface CardLink {
  url: string;
  title?: string;
}

export interface Recurrence {
  /** Repeat every N units. */
  every: number;
  unit: 'day' | 'week' | 'month' | 'year';
  /** unit = week only: which weekdays (0 = Sunday … 6 = Saturday). Empty/absent: same weekday as the due date. */
  weekdays?: number[];
  /** Human text, e.g. "every weekday", "every 2 weeks". */
  label: string;
}

/** Who made a change: the web UI, an AI client through MCP, or the system (recurrence, maintenance). */
export type Actor = 'web' | 'ann' | 'system';

export interface Card {
  id: number;
  column_id: number;
  /** Fractional order within the column (ascending). */
  position: number;
  title: string;
  /** Markdown. */
  notes: string;
  priority: Priority;
  /** Due instant (UTC ms). With due_has_time = false it is the end of that local day. */
  due_at: number | null;
  due_has_time: boolean;
  /** Local day this card is planned for ("My Day"), or null. */
  planned_for: string | null;
  estimate_min: number | null;
  /** Minutes logged through focus sessions and manual logging. */
  spent_min: number;
  project_id: number | null;
  tags: string[];
  checklist: ChecklistItem[];
  links: CardLink[];
  /** Non-null = blocked, with the reason. */
  blocked_reason: string | null;
  /** Ann guessed something (a date, a project) and the owner should glance at it. */
  needs_review: boolean;
  recurrence: Recurrence | null;
  /** A running focus session started at this instant, or null. */
  focus_started_at: number | null;
  /** Ann moved it to Done; its screen-minute credit waits for the owner to confirm. */
  credit_pending: boolean;
  /** Priority locked at the first focus session (credit is paid at this priority). */
  credit_priority?: Priority | null;
  /** Where the card came from in another app ("Socrates weak area: Integrals"), or null. */
  source: CardSource | null;
  created_by: Actor;
  /** The AI client that created it (e.g. "claude-ai", "openai-mcp"), if any. */
  created_client: string | null;
  /** The user's sentence Ann acted on when creating it. */
  source_utterance: string | null;
  created_at: number;
  updated_at: number;
  /** First time it entered a doing/review column. */
  started_at: number | null;
  /** Last time it entered a done column (null when not done). */
  completed_at: number | null;
  archived_at: number | null;
  version: number;
}

export interface Project {
  id: number;
  name: string;
  color: string;
  /** A single emoji or a lucide icon name, optional. */
  icon: string | null;
  description: string | null;
  archived_at: number | null;
  created_at: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  /** Non-archived cards carrying it. */
  count: number;
}

export interface Settings {
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** How many minutes of focused work fit in a day (for plan_day / whats_next). */
  day_capacity_min: number;
  /** "09:00" style local times. */
  work_start: string;
  work_end: string;
  /** 0 = Sunday, 1 = Monday. */
  week_starts_on: 0 | 1;
  /** Focus session length in minutes (Pomodoro). */
  focus_min: number;
  /** Display name used in summaries ("Good morning, …"). */
  display_name: string;
  /** Days a card can sit untouched in an active column before it counts as stale. */
  stale_after_days: number;
}

export interface BoardSnapshot {
  columns: Column[];
  /** Non-archived cards, all columns. */
  cards: Card[];
  projects: Project[];
  tags: Tag[];
  settings: Settings;
  /** Server clock and the owner's local "today" (YYYY-MM-DD). */
  now: number;
  today: string;
}

// ---- Activity (every change, grouped into batches that undo as one)

export type EntityKind = 'card' | 'column' | 'project' | 'tag' | 'settings';

export interface Change {
  entity: EntityKind;
  entity_id: number | string;
  op: 'create' | 'update' | 'archive' | 'restore' | 'delete';
  /** Full snapshot before (null on create) and after (null on delete). */
  before: unknown;
  after: unknown;
}

export interface Batch {
  id: string;
  at: number;
  actor: Actor;
  /** AI client name for actor = ann. */
  client: string | null;
  /** MCP tool or UI action, e.g. "add_cards", "web:move". */
  action: string;
  /** What the user said, when Ann passed it along. */
  utterance: string | null;
  /** One human line: "Added 3 cards to To Do". */
  summary: string;
  undone_at: number | null;
  /** Set on undo batches: the batch they reverted. */
  undoes: string | null;
  changes: Change[];
}

// ---- Quick add / natural language

export interface ParsedInput {
  title: string;
  due_at: number | null;
  due_has_time: boolean;
  /** The matched date phrase and its resolution, e.g. "next fri" -> "Fri 21 Nov". */
  due_text: string | null;
  due_label: string | null;
  priority: Priority | null;
  project: string | null;
  tags: string[];
  estimate_min: number | null;
  planned_today: boolean;
  recurrence: Recurrence | null;
  column: string | null;
}

// ---- Planning and insights

export interface RankedCard {
  card: Card;
  score: number;
  /** Short reasons: "overdue 2 days", "P1", "fits in 45 min". */
  reasons: string[];
}

export interface DayPlan {
  date: string;
  capacity_min: number;
  planned_min: number;
  cards: RankedCard[];
  /** Cards that did not fit. */
  overflow: RankedCard[];
}

export interface Summary {
  kind: 'standup' | 'daily' | 'weekly';
  /** Ready-to-read markdown. */
  text: string;
  done: Card[];
  doing: Card[];
  blocked: Card[];
  overdue: Card[];
  due_soon: Card[];
  planned: Card[];
}

export interface Insights {
  days: number;
  /** Per local day: cards completed and created. */
  throughput: { date: string; completed: number; created: number }[];
  /** Cumulative flow: per local day, card counts per column id at end of day. */
  cfd: { date: string; counts: Record<string, number> }[];
  /** Cycle time (started -> completed) in hours over the window. */
  cycle_time: { p50: number | null; p85: number | null; avg: number | null; samples: number };
  /** Lead time (created -> completed) in hours. */
  lead_time: { p50: number | null; p85: number | null; avg: number | null; samples: number };
  /** Active (doing/review) cards and how long they have been there, in days. */
  wip_age: { card_id: number; title: string; column_id: number; days: number }[];
  /** How Ann is doing. */
  ann: { batches: number; undone: number; cards_created: number; by_client: Record<string, number>; active_days: number };
  estimate_accuracy: { samples: number; ratio: number | null };
  streak_days: number;
  /** The day-14 review (docs/PLAN.md §8). */
  review: { started: string | null; days_used: number; cards: number; done: number; undo_rate: number | null; pass: boolean | null };
}

/** Server-sent event pushed to every open UI on /api/events. */
export interface BoardEvent {
  type: 'changed';
  batch: Pick<Batch, 'id' | 'at' | 'actor' | 'client' | 'action' | 'summary' | 'utterance' | 'undone_at' | 'undoes'>;
}

/**
 * A reference to the thing in another app a card was made from (the Orbit Hub convention, shared with Socrates, Slate
 * and Sprawl). `url` is an address the other app returned, copied as-is (never built by Hey Ann or a model).
 */
export interface CardSource {
  /** Short app slug: "socrates", "slate", "sprawl", … */
  app: string;
  /** Stable id within that app, e.g. "tag:42". Hey Ann dedupes open cards on app + id. */
  id: string;
  url?: string;
  title?: string;
}
