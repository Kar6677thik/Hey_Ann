// Field-level differences that matter, from a change's before/after snapshots.
import type { Card, Change } from '../../../../src/core/types.ts';
import { PRIORITY_SHORT } from '../../lib/cards.ts';
import { fmtDateTime, fmtMinutes } from '../../lib/time.ts';

export interface FieldDiff {
  field: string;
  before?: string;
  after?: string;
}
export interface Lookup {
  column: (id: number) => string | undefined;
  project: (id: number) => string | undefined;
}

const dash = '—';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

function cardDiffs(b: Partial<Card>, a: Partial<Card>, look: Lookup): FieldDiff[] {
  const out: FieldDiff[] = [];
  const push = (field: string, before: string, after: string) => {
    if (before !== after) out.push({ field, before, after });
  };
  if (b.title !== a.title) push('Title', b.title ?? dash, a.title ?? dash);
  if (b.column_id !== a.column_id) push('Column', b.column_id ? (look.column(b.column_id) ?? `#${b.column_id}`) : dash, a.column_id ? (look.column(a.column_id) ?? `#${a.column_id}`) : dash);
  if (b.priority !== a.priority) push('Priority', b.priority !== undefined ? PRIORITY_SHORT[b.priority] : dash, a.priority !== undefined ? PRIORITY_SHORT[a.priority] : dash);
  if (b.due_at !== a.due_at) push('Due', b.due_at ? fmtDateTime(b.due_at, b.due_has_time) : dash, a.due_at ? fmtDateTime(a.due_at, a.due_has_time) : dash);
  if (b.planned_for !== a.planned_for) push('Planned', b.planned_for ?? dash, a.planned_for ?? dash);
  if (b.estimate_min !== a.estimate_min) push('Estimate', fmtMinutes(b.estimate_min), fmtMinutes(a.estimate_min));
  if (b.spent_min !== a.spent_min) push('Time spent', fmtMinutes(b.spent_min ?? 0), fmtMinutes(a.spent_min ?? 0));
  if (b.project_id !== a.project_id) push('Project', b.project_id ? (look.project(b.project_id) ?? dash) : dash, a.project_id ? (look.project(a.project_id) ?? dash) : dash);
  const bt = (b.tags ?? []).join(', ');
  const at = (a.tags ?? []).join(', ');
  if (bt !== at) {
    const added = (a.tags ?? []).filter((t) => !(b.tags ?? []).includes(t));
    const removed = (b.tags ?? []).filter((t) => !(a.tags ?? []).includes(t));
    out.push({ field: 'Tags', before: removed.length ? removed.map((t) => `#${t}`).join(' ') : undefined, after: added.length ? added.map((t) => `#${t}`).join(' ') : undefined });
  }
  if (b.blocked_reason !== a.blocked_reason) push('Blocked', b.blocked_reason ?? 'no', a.blocked_reason ?? 'no');
  if (b.recurrence?.label !== a.recurrence?.label) push('Repeats', b.recurrence?.label ?? dash, a.recurrence?.label ?? dash);
  const src = (c: Partial<Card>) => (c.source ? (APP_NAMES[c.source.app] ?? c.source.app) + (c.source.title ? ': ' + c.source.title : '') : dash);
  if (JSON.stringify(b.source ?? null) !== JSON.stringify(a.source ?? null)) push('From', src(b), src(a));
  if (b.notes !== a.notes) out.push({ field: 'Notes', before: b.notes ? `${b.notes.length} chars` : 'empty', after: a.notes ? `${a.notes.length} chars` : 'empty' });
  const bc = b.checklist ?? [];
  const ac = a.checklist ?? [];
  if (JSON.stringify(bc) !== JSON.stringify(ac)) {
    const d = (l: typeof bc) => `${l.filter((i) => i.done).length}/${l.length} done`;
    push('Checklist', d(bc), d(ac));
  }
  if ((b.links ?? []).length !== (a.links ?? []).length) push('Links', String((b.links ?? []).length), String((a.links ?? []).length));
  if (b.needs_review !== a.needs_review) push('Needs a check', b.needs_review ? 'yes' : 'no', a.needs_review ? 'yes' : 'no');
  if (b.focus_started_at !== a.focus_started_at) push('Focus', b.focus_started_at ? 'running' : 'off', a.focus_started_at ? 'running' : 'off');
  if (b.archived_at !== a.archived_at) push('Archived', b.archived_at ? 'yes' : 'no', a.archived_at ? 'yes' : 'no');
  return out;
}

function genericDiffs(b: Record<string, unknown>, a: Record<string, unknown>): FieldDiff[] {
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: FieldDiff[] = [];
  for (const k of keys) {
    if (['id', 'created_at', 'updated_at', 'position', 'version'].includes(k)) continue;
    const bv = JSON.stringify(b[k] ?? null);
    const av = JSON.stringify(a[k] ?? null);
    if (bv !== av) out.push({ field: k.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase()), before: bv === 'null' ? dash : bv.replace(/^"|"$/g, ''), after: av === 'null' ? dash : av.replace(/^"|"$/g, '') });
  }
  return out;
}

export interface ChangeView {
  entity: Change['entity'];
  id: number | string;
  op: Change['op'];
  /** "#42 Fix flaky test" or "Column In Review" */
  name: string;
  diffs: FieldDiff[];
}

export function describeChange(c: Change, look: Lookup): ChangeView {
  const snap = (isObj(c.after) ? c.after : isObj(c.before) ? c.before : {}) as Record<string, unknown>;
  const name =
    c.entity === 'card'
      ? `#${c.entity_id} ${String(snap.title ?? '')}`
      : c.entity === 'settings'
        ? 'Settings'
        : `${c.entity[0].toUpperCase()}${c.entity.slice(1)} ${String(snap.name ?? c.entity_id)}`;
  let diffs: FieldDiff[] = [];
  if (c.op === 'update' && isObj(c.before) && isObj(c.after)) {
    diffs = c.entity === 'card' ? cardDiffs(c.before as Partial<Card>, c.after as Partial<Card>, look) : genericDiffs(c.before, c.after);
  } else if (c.op === 'create' && c.entity === 'card' && isObj(c.after)) {
    const a = c.after as Partial<Card>;
    diffs = cardDiffs({ tags: [], checklist: [], links: [], notes: '', title: a.title, spent_min: 0, needs_review: false, blocked_reason: null, focus_started_at: null, archived_at: null, recurrence: null, source: null, due_at: null, project_id: null, estimate_min: null, planned_for: null, column_id: a.column_id, priority: a.priority }, a, look).filter((d) => d.field !== 'Title');
  }
  return { entity: c.entity, id: c.entity_id, op: c.op, name, diffs };
}

/** Display names for apps a card can come from (other Orbit Hub apps). */
export const APP_NAMES: Record<string, string> = { socrates: 'Socrates', slate: 'Slate', sprawl: 'Sprawl', orbit: 'Orbit' };
