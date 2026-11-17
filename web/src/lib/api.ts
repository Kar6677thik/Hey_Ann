// Typed fetch wrapper for the Hey Ann HTTP API (docs/API.md).
import type {
  Batch,
  BoardSnapshot,
  Card,
  CardLink,
  Column,
  ColumnKind,
  DayPlan,
  Insights,
  ParsedInput,
  Priority,
  Project,
  RankedCard,
  Recurrence,
  Settings,
  Summary,
  Tag,
} from '../../../src/core/types.ts';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Listener = () => void;
const signinListeners = new Set<Listener>();
/** Called when any request comes back 401 code:'signin'. */
export function onSigninRequired(fn: Listener) {
  signinListeners.add(fn);
  return () => void signinListeners.delete(fn);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, 'Can’t reach the Hey Ann server.');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = (data && typeof data === 'object' ? data : {}) as { error?: string; code?: string; details?: unknown };
    if (res.status === 401 && err.code === 'signin') signinListeners.forEach((fn) => fn());
    throw new ApiError(res.status, err.error ?? `Request failed (${res.status})`, err.code, err.details);
  }
  return data as T;
}

/** Raw typed request, for feature modules with their own endpoint groups (e.g. lib/wallet.ts). */
export const apiRequest = request;

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

// ---- shapes the API adds on top of the core types

export type ProjectWithCounts = Project & { open: number; done: number };
export interface CardInput {
  title: string;
  notes?: string;
  column_id?: number;
  priority?: Priority;
  due?: string | null;
  due_at?: number | null;
  planned_for?: string | null;
  estimate_min?: number | null;
  project?: string | null;
  project_id?: number | null;
  tags?: string[];
  checklist?: string[] | Card['checklist'];
  links?: CardLink[];
  blocked_reason?: string | null;
  recurrence?: string | Recurrence | null;
  needs_review?: boolean;
}
export type ChecklistOp =
  | { op: 'add'; text: string }
  | { op: 'toggle' | 'remove'; id: string }
  | { op: 'edit'; id: string; text: string };
export type CardPatch = Partial<Omit<CardInput, 'title'>> & {
  title?: string;
  version?: number;
  checklist_ops?: ChecklistOp[];
  append_note?: string;
};
export interface Triage {
  overdue: Card[];
  stale: Card[];
  blocked: Card[];
  unplanned_urgent: Card[];
  wip_over?: unknown[];
  suggestions: { card_id: number; action: string; reason: string }[];
}
export interface McpInfo {
  mode: 'local' | 'oauth' | 'off';
  url?: string;
  token?: string;
  path_token_url?: string;
  stdio_command: { command: string; args: string[] };
  claude_code: string;
  instructions_snippet: string;
  server_instructions: string;
}
export interface CardQuery {
  q?: string;
  column?: number;
  project?: number;
  tag?: string;
  priority?: number;
  due?: 'overdue' | 'today' | 'week' | 'none';
  blocked?: boolean;
  archived?: boolean;
  limit?: number;
  offset?: number;
}
export interface Backup {
  name: string;
  bytes: number;
  at: number;
}
export type WriteResult = { batch: Batch };

export const api = {
  session: () => request<{ signedIn: boolean; loginRequired: boolean }>('GET', '/session'),
  signIn: (password: string, remember: boolean) => request<{ signedIn: true }>('POST', '/session', { password, remember }),
  signOut: () => request<{ signedIn: false }>('DELETE', '/session'),
  revokeAll: () => request<{ ok?: boolean }>('POST', '/session/revoke-all'),

  board: () => request<BoardSnapshot>('GET', '/board'),
  cards: (q: CardQuery) => request<{ items: Card[]; total: number }>('GET', `/cards${qs({ ...q, blocked: q.blocked ? 1 : undefined, archived: q.archived ? 1 : undefined })}`),
  card: (id: number) => request<{ card: Card; activity: Batch[] }>('GET', `/cards/${id}`),
  createCards: (items: CardInput[]) => request<{ cards: Card[] } & WriteResult>('POST', '/cards', { items }),
  patchCard: (id: number, patch: CardPatch) => request<{ card: Card } & WriteResult>('PATCH', `/cards/${id}`, patch),
  moveCard: (id: number, body: { column_id: number; before_id: number | null; after_id: number | null }) =>
    request<{ card: Card; wip_warning?: string } & WriteResult>('POST', `/cards/${id}/move`, body),
  archive: (ids: number[]) => request<{ cards: Card[] } & WriteResult>('POST', '/cards/archive', { ids }),
  restore: (ids: number[]) => request<{ cards: Card[] } & WriteResult>('POST', '/cards/restore', { ids }),
  deleteCard: (id: number) => request<{ ok: boolean } & WriteResult>('DELETE', `/cards/${id}`),
  focus: (id: number, action: 'start' | 'stop') => request<{ card: Card; logged_min?: number } & WriteResult>('POST', `/cards/${id}/focus`, { action }),
  logTime: (id: number, minutes: number) => request<{ card: Card } & WriteResult>('POST', `/cards/${id}/log`, { minutes }),
  duplicate: (id: number) => request<{ card: Card } & WriteResult>('POST', `/cards/${id}/duplicate`),

  parse: (text: string) => request<ParsedInput>('POST', '/parse', { text }),
  quickAdd: (text: string, column_id?: number) => request<{ cards: Card[] } & WriteResult>('POST', '/quick-add', { text, column_id }),

  next: (minutes?: number) => request<{ items: RankedCard[] }>('GET', `/next${qs({ minutes })}`),
  plan: (date?: string) => request<DayPlan>('GET', `/plan${qs({ date })}`),
  setPlan: (ids: number[], date?: string) => request<{ cards: Card[] } & WriteResult>('POST', '/plan', { ids, date }),
  summary: (kind: Summary['kind']) => request<Summary>('GET', `/summary${qs({ kind })}`),
  insights: (days: number) => request<Insights>('GET', `/insights${qs({ days })}`),
  triage: () => request<Triage>('GET', '/triage'),

  activity: (p: { limit?: number; before?: number; actor?: string }) => request<{ items: Batch[] }>('GET', `/activity${qs(p)}`),
  undoBatch: (id: string) => request<{ batch: Batch; conflicts: string[] }>('POST', `/activity/${encodeURIComponent(id)}/undo`),
  undoLast: () => request<{ batch: Batch; conflicts: string[] }>('POST', '/undo'),

  createColumn: (b: { name: string; kind: ColumnKind; wip_limit?: number | null; color?: string | null }) => request<{ column: Column } & WriteResult>('POST', '/columns', b),
  patchColumn: (id: number, b: Partial<Pick<Column, 'name' | 'kind' | 'wip_limit' | 'color'>>) => request<{ column: Column } & WriteResult>('PATCH', `/columns/${id}`, b),
  reorderColumns: (ids: number[]) => request<{ columns: Column[] } & WriteResult>('POST', '/columns/reorder', { ids }),
  deleteColumn: (id: number) => request<{ ok: boolean } & WriteResult>('DELETE', `/columns/${id}`),

  projects: () => request<{ items: ProjectWithCounts[] }>('GET', '/projects'),
  createProject: (b: { name: string; color?: string; icon?: string | null; description?: string | null }) => request<{ project: Project } & WriteResult>('POST', '/projects', b),
  patchProject: (id: number, b: Partial<Pick<Project, 'name' | 'color' | 'icon' | 'description'>> & { archived?: boolean }) =>
    request<{ project: Project } & WriteResult>('PATCH', `/projects/${id}`, b),
  patchTag: (id: number, b: { name?: string; color?: string | null }) => request<{ tag: Tag } & WriteResult>('PATCH', `/tags/${id}`, b),
  mergeTags: (source_id: number, target_id: number) => request<{ tag: Tag } & WriteResult>('POST', '/tags/merge', { source_id, target_id }),

  settings: () => request<Settings>('GET', '/settings'),
  patchSettings: (b: Partial<Settings>) => request<{ settings: Settings } & WriteResult>('PATCH', '/settings', b),

  mcpInfo: () => request<McpInfo>('GET', '/mcp-info'),
  importJson: (data: unknown) => request<{ cards: number } & WriteResult>('POST', '/import/json', data),
  backups: () => request<{ items: Backup[] }>('GET', '/backups'),
  backupNow: () => request<{ file: string }>('POST', '/backups'),
};
