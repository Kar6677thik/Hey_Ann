// Planning and reporting: what to do next, a day plan, triage, standup/weekly summaries and board metrics.
import type { Board } from './board.ts';
import type { Card, Column, DayPlan, Insights, RankedCard, Summary } from './types.ts';
import { PRIORITY_LABELS } from './types.ts';
import { addDays, dayLabel, daysBetween, dueLabel, endOfDay, localDay, startOfDay, startOfWeek } from './time.ts';
import { norm } from './resolve.ts';

const DEFAULT_ESTIMATE = 30;

interface Ctx {
  board: Board;
  now: number;
  tz: string;
  today: string;
  cols: Map<number, Column>;
}

function ctx(board: Board, now = Date.now()): Ctx {
  const tz = board.tz;
  return { board, now, tz, today: localDay(now, tz), cols: new Map(board.columns().map((c) => [c.id, c])) };
}

const kind = (x: Ctx, c: Card) => x.cols.get(c.column_id)?.kind ?? 'todo';
const isOpen = (x: Ctx, c: Card) => !c.archived_at && kind(x, c) !== 'done';
const isOverdue = (x: Ctx, c: Card) => c.due_at !== null && c.due_at < x.now && isOpen(x, c);

// ------------------------------------------------------------------ ranking

/** Score every open, unblocked card for "what should I do now". */
export function rank(board: Board, opts: { minutes?: number; context?: string; includeBacklog?: boolean } = {}, now = Date.now()): RankedCard[] {
  const x = ctx(board, now);
  const s = board.settings();
  const ctxWords = opts.context ? norm(opts.context).split(' ').filter((w) => w.length > 2) : [];
  const projects = new Map(board.projects().map((p) => [p.id, p.name]));
  const out: RankedCard[] = [];
  for (const c of board.openCards()) {
    const k = kind(x, c);
    if (k === 'done' || c.blocked_reason) continue;
    if (k === 'backlog' && !opts.includeBacklog && !c.due_at && c.priority > 1) continue;
    let score = 0;
    const why: string[] = [];
    score += [40, 25, 10, 0][c.priority];
    if (c.priority <= 1) why.push(`P${c.priority} ${PRIORITY_LABELS[c.priority].toLowerCase()}`);
    if (c.due_at !== null) {
      const days = daysBetween(x.today, localDay(c.due_at, x.tz));
      if (c.due_at < now) { score += 35 + Math.min(-days * 3, 15); why.push(days === 0 ? 'due earlier today' : `overdue ${-days}d`); }
      else if (days === 0) { score += 30; why.push('due today'); }
      else if (days === 1) { score += 20; why.push('due tomorrow'); }
      else if (days <= 3) { score += 12; why.push(`due in ${days}d`); }
      else if (days <= 7) { score += 6; why.push(`due ${dayLabel(localDay(c.due_at, x.tz), x.today)}`); }
    }
    if (c.planned_for === x.today) { score += 20; why.push('planned for today'); }
    else if (c.planned_for && c.planned_for < x.today) { score += 10; why.push('carried over'); }
    if (k === 'doing') { score += 15; why.push('already in progress'); }
    if (k === 'review') { score += 12; why.push('in review: close it out'); }
    if (k === 'backlog') score -= 15;
    if (c.focus_started_at) { score += 10; why.push('focus running'); }
    const idleDays = Math.floor((now - c.updated_at) / 864e5);
    if ((k === 'todo' || k === 'doing') && idleDays >= s.stale_after_days) { score += Math.min(idleDays / 7 * 2, 6); why.push(`untouched ${idleDays}d`); }
    const est = c.estimate_min;
    if (opts.minutes) {
      const need = est ?? DEFAULT_ESTIMATE;
      const left = Math.max(need - c.spent_min, 5);
      if (left <= opts.minutes) { score += 8; if (est) why.push(`fits (~${fmtMin(left)})`); }
      else if (left > opts.minutes * 1.5) { score -= 20; why.push(`needs ~${fmtMin(left)}`); }
    }
    if (ctxWords.length) {
      const hay = norm([c.title, c.notes.slice(0, 500), projects.get(c.project_id ?? -1) ?? '', ...c.tags].join(' '));
      const hit = ctxWords.filter((w) => hay.includes(w)).length;
      if (hit) { score += 10 * Math.min(hit, 2); why.push('matches what you asked'); }
    }
    const progress = c.checklist.length ? c.checklist.filter((i) => i.done).length / c.checklist.length : 0;
    if (progress >= 0.5 && progress < 1) { score += 4; why.push(`${Math.round(progress * 100)}% done`); }
    out.push({ card: c, score: Math.round(score), reasons: why });
  }
  return out.sort((a, b) => b.score - a.score || (a.card.due_at ?? Infinity) - (b.card.due_at ?? Infinity) || a.card.position - b.card.position);
}

export function fmtMin(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${r}m` : `${h}h`;
}

/** Propose a plan for a day: what's already planned, then the best-ranked cards until capacity is full. */
export function planDay(board: Board, opts: { date?: string; minutes?: number } = {}, now = Date.now()): DayPlan {
  const x = ctx(board, now);
  const date = opts.date ?? x.today;
  const s = board.settings();
  // Today: subtract what's already been logged since midnight.
  const loggedToday = date === x.today
    ? ((board.db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM focus_log WHERE ended_at >= ?').get(startOfDay(x.today, x.tz)) as { m: number }).m)
    : 0;
  const capacity = Math.max(opts.minutes ?? s.day_capacity_min - loggedToday, 30);
  const ranked = rank(board, { includeBacklog: false }, now);
  const must = (r: RankedCard) => r.card.planned_for === date || (r.card.due_at !== null && r.card.due_at <= endOfDay(date, x.tz) && r.card.priority <= 1);
  const ordered = [...ranked.filter(must), ...ranked.filter((r) => !must(r))];
  const cards: RankedCard[] = [], overflow: RankedCard[] = [];
  let used = 0;
  for (const r of ordered) {
    const need = Math.max((r.card.estimate_min ?? DEFAULT_ESTIMATE) - r.card.spent_min, 10);
    if (used + need <= capacity || (must(r) && used < capacity * 1.25)) { cards.push(r); used += need; }
    else if (overflow.length < 8) overflow.push(r);
    if (cards.length >= 12) break;
  }
  return { date, capacity_min: capacity, planned_min: used, cards, overflow };
}

// ------------------------------------------------------------------ triage

export function triage(board: Board, now = Date.now()) {
  const x = ctx(board, now);
  const s = board.settings();
  const open = board.openCards().filter((c) => isOpen(x, c));
  const overdue = open.filter((c) => isOverdue(x, c)).sort((a, b) => a.due_at! - b.due_at!);
  const stale = open.filter((c) => ['todo', 'doing', 'review'].includes(kind(x, c)) && now - c.updated_at > s.stale_after_days * 864e5 && !isOverdue(x, c))
    .sort((a, b) => a.updated_at - b.updated_at);
  const blocked = open.filter((c) => c.blocked_reason);
  const unplanned_urgent = open.filter((c) => c.priority <= 1 && c.due_at === null && !c.planned_for && kind(x, c) !== 'doing');
  const suggestions: { card_id: number; action: string; reason: string }[] = [];
  for (const c of overdue) {
    const days = -daysBetween(x.today, localDay(c.due_at!, x.tz));
    if (c.priority >= 3) suggestions.push({ card_id: c.id, action: 'archive or move to backlog', reason: `low priority and ${days}d overdue: probably not happening` });
    else if (days > 7) suggestions.push({ card_id: c.id, action: 'reschedule to a realistic date or split it', reason: `${days} days overdue` });
    else suggestions.push({ card_id: c.id, action: c.priority <= 1 ? 'plan it for today' : 'reschedule (e.g. next week)', reason: `overdue ${days}d` });
  }
  for (const c of stale) suggestions.push({
    card_id: c.id,
    action: kind(x, c) === 'doing' ? 'move back to To Do, or split into a smaller next step' : kind(x, c) === 'review' ? 'chase the review or mark done' : 'move to Backlog if it is not happening soon',
    reason: `untouched ${Math.floor((now - c.updated_at) / 864e5)} days`,
  });
  for (const c of blocked) suggestions.push({ card_id: c.id, action: 'follow up on the blocker', reason: c.blocked_reason! });
  for (const c of unplanned_urgent) suggestions.push({ card_id: c.id, action: 'give it a due date or plan it', reason: `P${c.priority} with no date` });
  const wip = board.columns().filter((c) => c.wip_limit).map((c) => ({ c, n: open.filter((k) => k.column_id === c.id).length })).filter(({ c, n }) => n > c.wip_limit!);
  return { overdue, stale, blocked, unplanned_urgent, wip_over: wip.map(({ c, n }) => ({ column: c.name, count: n, limit: c.wip_limit! })), suggestions };
}

// ------------------------------------------------------------------ summaries

export function summary(board: Board, kindArg: Summary['kind'], now = Date.now()): Summary {
  const x = ctx(board, now);
  const s = board.settings();
  const all = board.openCards();
  const since = kindArg === 'weekly' ? startOfDay(startOfWeek(x.today, s.week_starts_on), x.tz) : kindArg === 'standup' ? startOfDay(addDays(x.today, -1), x.tz) : startOfDay(x.today, x.tz);
  const done = all.filter((c) => kind(x, c) === 'done' && (c.completed_at ?? 0) >= since).sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
  const doing = all.filter((c) => ['doing', 'review'].includes(kind(x, c)));
  const blocked = all.filter((c) => isOpen(x, c) && c.blocked_reason);
  const overdue = all.filter((c) => isOverdue(x, c));
  const horizon = endOfDay(addDays(x.today, kindArg === 'weekly' ? 7 : 2), x.tz);
  const due_soon = all.filter((c) => isOpen(x, c) && c.due_at !== null && c.due_at >= now && c.due_at <= horizon).sort((a, b) => a.due_at! - b.due_at!);
  const planned = all.filter((c) => isOpen(x, c) && c.planned_for === x.today);
  const line = (c: Card) => `- ${cardLine(board, c, x)}`;
  const greet = s.display_name ? `, ${s.display_name}` : '';
  const parts: string[] = [];
  if (kindArg === 'standup') {
    parts.push(`**Standup, ${dayLabel(x.today)}${greet}**`);
    parts.push(`**Yesterday & since:** ${done.length ? '\n' + done.map(line).join('\n') : 'nothing moved to Done.'}`);
    const today = [...new Map([...doing, ...planned].map((c) => [c.id, c])).values()];
    parts.push(`**Today:** ${today.length ? '\n' + today.map(line).join('\n') : 'nothing in progress or planned yet. Ask "what should I work on?"'}`);
    parts.push(`**Blockers:** ${blocked.length ? '\n' + blocked.map((c) => `- #${c.id} ${c.title}: ${c.blocked_reason}`).join('\n') : 'none.'}`);
    if (overdue.length) parts.push(`**Overdue (${overdue.length}):**\n${overdue.slice(0, 8).map(line).join('\n')}`);
  } else if (kindArg === 'daily') {
    parts.push(`**${dayLabel(x.today)}${greet}**`);
    parts.push(`**Planned today (${planned.length}):** ${planned.length ? '\n' + planned.map(line).join('\n') : 'nothing planned. Try "plan my day".'}`);
    parts.push(`**In progress (${doing.length}):** ${doing.length ? '\n' + doing.map(line).join('\n') : 'none.'}`);
    parts.push(`**Done today (${done.length}):** ${done.length ? '\n' + done.map(line).join('\n') : 'nothing yet.'}`);
    if (overdue.length) parts.push(`**Overdue (${overdue.length}):**\n${overdue.slice(0, 8).map(line).join('\n')}`);
    if (due_soon.length) parts.push(`**Coming up:**\n${due_soon.slice(0, 8).map(line).join('\n')}`);
  } else {
    const created = (board.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE created_at >= ?').get(since) as { n: number }).n;
    const focus = (board.db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM focus_log WHERE ended_at >= ?').get(since) as { m: number }).m;
    const slipped = all.filter((c) => isOverdue(x, c) && c.due_at! >= since);
    parts.push(`**Week of ${dayLabel(startOfWeek(x.today, s.week_starts_on))}${greet}**`);
    parts.push(`Finished **${done.length}**, added **${created}**, focused **${fmtMin(focus)}**.`);
    parts.push(`**Done this week:** ${done.length ? '\n' + done.map(line).join('\n') : 'nothing yet.'}`);
    parts.push(`**Still in progress:** ${doing.length ? '\n' + doing.map(line).join('\n') : 'none.'}`);
    if (slipped.length) parts.push(`**Slipped this week (${slipped.length}):**\n${slipped.map(line).join('\n')}`);
    if (blocked.length) parts.push(`**Blocked:**\n${blocked.map((c) => `- #${c.id} ${c.title}: ${c.blocked_reason}`).join('\n')}`);
    if (due_soon.length) parts.push(`**Due in the next 7 days:**\n${due_soon.map(line).join('\n')}`);
  }
  return { kind: kindArg, text: parts.join('\n\n'), done, doing, blocked, overdue, due_soon, planned };
}

/** One compact line for a card: "#12 Fix login · In Progress · P1 · due tomorrow · @Backend #auth · ☑ 2/5". */
export function cardLine(board: Board, c: Card, x: Ctx = ctx(board), opts: { column?: boolean } = { column: true }): string {
  const bits = [`#${c.id} ${c.title}`];
  if (opts.column !== false) bits.push(x.cols.get(c.column_id)?.name ?? '?');
  if (c.priority <= 1) bits.push(`P${c.priority}`);
  if (c.due_at !== null && (kind(x, c) !== 'done')) bits.push(`due ${dueLabel(c.due_at, c.due_has_time, x.tz, x.now)}`);
  if (c.planned_for === x.today && kind(x, c) !== 'done') bits.push('★ today');
  const project = c.project_id ? board.projects().find((p) => p.id === c.project_id)?.name : null;
  if (project) bits.push(`@${project}`);
  if (c.tags.length) bits.push(c.tags.map((t) => `#${t}`).join(' '));
  if (c.checklist.length) bits.push(`☑ ${c.checklist.filter((i) => i.done).length}/${c.checklist.length}`);
  if (c.estimate_min) bits.push(`~${fmtMin(c.estimate_min)}${c.spent_min ? ` (${fmtMin(c.spent_min)} spent)` : ''}`);
  if (c.recurrence) bits.push(`↻ ${c.recurrence.label}`);
  if (c.blocked_reason) bits.push(`⛔ ${c.blocked_reason}`);
  if (c.focus_started_at) bits.push('⏱ focusing');
  if (c.archived_at) bits.push('(archived)');
  return bits.join(' · ');
}

export { ctx as boardContext };

// ------------------------------------------------------------------ insights

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] * 10) / 10;
};

export function insights(board: Board, days = 30, now = Date.now()): Insights {
  const x = ctx(board, now);
  days = Math.min(Math.max(Math.floor(days), 7), 365);
  const startDay = addDays(x.today, -(days - 1));
  const since = startOfDay(startDay, x.tz);
  const dayList = Array.from({ length: days }, (_, i) => addDays(startDay, i));
  const doneCols = new Set(board.columns().filter((c) => c.kind === 'done').map((c) => c.id));
  const doingCols = new Set(board.columns().filter((c) => c.kind === 'doing' || c.kind === 'review').map((c) => c.id));

  // Throughput from transitions into done (counts re-completions once per day per card).
  const trans = board.db.prepare('SELECT card_id, at, from_column, to_column FROM transitions ORDER BY at, id').all() as { card_id: number; at: number; from_column: number | null; to_column: number | null }[];
  const completedPerDay = new Map<string, Set<number>>();
  const createdPerDay = new Map<string, number>();
  const completionDays = new Set<string>();
  for (const t of trans) {
    if (t.to_column === null || !doneCols.has(t.to_column) || (t.from_column !== null && doneCols.has(t.from_column))) continue;
    const d = localDay(t.at, x.tz);
    completionDays.add(d);
    if (t.at >= since) (completedPerDay.get(d) ?? completedPerDay.set(d, new Set()).get(d)!).add(t.card_id);
  }
  for (const r of board.db.prepare('SELECT created_at FROM cards WHERE created_at >= ?').all(since) as { created_at: number }[]) {
    const d = localDay(r.created_at, x.tz);
    createdPerDay.set(d, (createdPerDay.get(d) ?? 0) + 1);
  }
  const throughput = dayList.map((date) => ({ date, completed: completedPerDay.get(date)?.size ?? 0, created: createdPerDay.get(date) ?? 0 }));

  // Cumulative flow: replay transitions to get each card's column at the end of each day.
  const state = new Map<number, number | null>();
  let ti = 0;
  const cfd: Insights['cfd'] = [];
  for (const date of dayList) {
    const end = endOfDay(date, x.tz);
    while (ti < trans.length && trans[ti].at <= end) { state.set(trans[ti].card_id, trans[ti].to_column); ti++; }
    const counts: Record<string, number> = {};
    for (const col of x.cols.keys()) counts[String(col)] = 0;
    for (const v of state.values()) if (v !== null && counts[String(v)] !== undefined) counts[String(v)]++;
    cfd.push({ date, counts });
  }

  const finished = board.db.prepare('SELECT created_at, started_at, completed_at, estimate_min, spent_min FROM cards WHERE completed_at >= ? AND archived_at IS NULL').all(since) as any[];
  const cyc = finished.filter((r) => r.started_at && r.completed_at >= r.started_at).map((r) => (r.completed_at - r.started_at) / 36e5);
  const lead = finished.map((r) => (r.completed_at - r.created_at) / 36e5);
  const stats = (xs: number[]) => ({ p50: pct(xs, 0.5), p85: pct(xs, 0.85), avg: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null, samples: xs.length });

  const wip_age = board.openCards().filter((c) => doingCols.has(c.column_id)).map((c) => {
    const entered = [...trans].reverse().find((t) => t.card_id === c.id && t.to_column === c.column_id)?.at ?? c.started_at ?? c.created_at;
    return { card_id: c.id, title: c.title, column_id: c.column_id, days: Math.round((now - entered) / 864e5 * 10) / 10 };
  }).sort((a, b) => b.days - a.days);

  const batches = board.db.prepare("SELECT at, client, undone_at, action FROM batches WHERE actor = 'ann' AND at >= ? AND undoes IS NULL").all(since) as any[];
  const by_client: Record<string, number> = {};
  for (const b of batches) by_client[b.client ?? 'unknown'] = (by_client[b.client ?? 'unknown'] ?? 0) + 1;
  const annDays = new Set(batches.map((b) => localDay(b.at, x.tz)));
  const annCreated = (board.db.prepare("SELECT COUNT(*) AS n FROM cards WHERE created_by = 'ann' AND created_at >= ?").get(since) as { n: number }).n;

  const est = finished.filter((r) => r.estimate_min && r.spent_min);
  const ratio = est.length ? Math.round(est.reduce((a, r) => a + r.spent_min / r.estimate_min, 0) / est.length * 100) / 100 : null;

  // Streak: consecutive days (ending today or yesterday) with at least one completion.
  let streak = 0;
  for (let d = completionDays.has(x.today) ? x.today : addDays(x.today, -1); ; d = addDays(d, -1)) {
    if (!completionDays.has(d) || streak > 365) break;
    streak++;
  }

  return {
    days, throughput, cfd, cycle_time: stats(cyc), lead_time: stats(lead), wip_age,
    ann: { batches: batches.length, undone: batches.filter((b) => b.undone_at).length, cards_created: annCreated, by_client, active_days: annDays.size },
    estimate_accuracy: { samples: est.length, ratio },
    streak_days: streak,
    review: review(board, x),
  };
}

/** The 14-day review from docs/PLAN.md §8, counted from the first Ann action. */
function review(board: Board, x: Ctx): Insights['review'] {
  const first = board.db.prepare("SELECT MIN(at) AS at FROM batches WHERE actor = 'ann'").get() as { at: number | null };
  if (!first.at) return { started: null, days_used: 0, cards: 0, done: 0, undo_rate: null, pass: null };
  const started = localDay(first.at, x.tz);
  const end = endOfDay(addDays(started, 13), x.tz);
  const bs = board.db.prepare("SELECT at, undone_at FROM batches WHERE actor = 'ann' AND undoes IS NULL AND at <= ?").all(end) as any[];
  const days_used = new Set(bs.map((b) => localDay(b.at, x.tz))).size;
  const cards = (board.db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;
  const doneCols = board.columns().filter((c) => c.kind === 'done').map((c) => c.id);
  const done = doneCols.length ? (board.db.prepare(`SELECT COUNT(DISTINCT card_id) AS n FROM transitions WHERE to_column IN (${doneCols.join(',')})`).get() as { n: number }).n : 0;
  const undo_rate = bs.length ? Math.round(bs.filter((b) => b.undone_at).length / bs.length * 1000) / 10 : null;
  const finished = daysBetween(started, x.today) >= 14;
  const pass = finished ? days_used >= 10 && cards >= 30 && done >= 15 && (undo_rate ?? 0) < 10 : null;
  return { started, days_used, cards, done, undo_rate, pass };
}
