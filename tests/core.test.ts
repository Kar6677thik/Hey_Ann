import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.ts';
import { addCards, archiveCards, quickAdd, updateCards } from '../src/core/ops.ts';
import { resolveCard } from '../src/core/resolve.ts';
import { insights, planDay, rank, summary, triage } from '../src/core/insights.ts';
import { exportJson, importJson } from '../src/core/transfer.ts';
import { localDay } from '../src/core/time.ts';

const ann = { actor: 'ann' as const, client: 'Test', action: 'test' };
const web = { actor: 'web' as const, action: 'web:test' };

function fresh() {
  const b = new Board(':memory:');
  b.batch(web, (tx) => tx.updateSettings({ timezone: 'Asia/Kolkata' }));
  return b;
}

test('default board has five professional columns', () => {
  const b = fresh();
  assert.deepEqual(b.columns().map((c) => c.kind), ['backlog', 'todo', 'doing', 'review', 'done']);
  assert.equal(b.resolveColumn('in progress').kind, 'doing');
  assert.equal(b.resolveColumn('wip').kind, 'doing');
  assert.equal(b.resolveColumn('finished').kind, 'done');
  assert.throws(() => b.resolveColumn('nowhere'), /unknown column/);
});

test('brain dump creates one batch, resolves dates in the owner timezone, and undoes as a whole', () => {
  const b = fresh();
  const r = addCards(b, [
    { title: 'Finish the DB migration', due: 'friday', priority: 'P1' as any, project: 'Infra', tags: ['db'] },
    { title: "Review Raj's PR", due: 'tomorrow 5pm' },
    { title: 'Prep slides', checklist: ['Outline', 'Charts'] },
  ], { ...ann, utterance: 'Hey Ann, three things' });
  assert.equal(r.created.length, 3);
  assert.ok(r.batch);
  assert.equal(r.batch!.changes.filter((c) => c.entity === 'card').length, 3);
  assert.equal(r.created[0].priority, 1);
  assert.equal(b.findProject('infra')?.name, 'Infra');
  assert.equal(r.created[1].due_has_time, true);
  assert.equal(r.created[2].checklist.length, 2);
  assert.equal(r.created[0].source_utterance, 'Hey Ann, three things');
  // New cards land at the top of To Do, in the order given.
  const todo = b.openCards().filter((c) => c.column_id === b.resolveColumn('todo').id).sort((x, y) => x.position - y.position);
  assert.deepEqual(todo.map((c) => c.title), ['Finish the DB migration', "Review Raj's PR", 'Prep slides']);

  const u = b.undo(r.batch!.id, ann);
  assert.equal(u.conflicts.length, 0);
  assert.equal(b.openCards().length, 0);
  // The project created by the batch is gone too.
  assert.equal(b.findProject('Infra'), null);
  // Undo of the undo brings everything back with the same ids.
  b.undo(u.batch!.id, ann);
  assert.deepEqual(b.openCards().map((c) => c.id).sort(), r.created.map((c) => c.id).sort());
});

test('duplicates are reported, not created; client_ref makes retries idempotent', () => {
  const b = fresh();
  addCards(b, [{ title: 'Renew passport' }], ann);
  const r = addCards(b, [{ title: 'renew passport!' }, { title: 'Call mom', client_ref: 'x1' }], ann);
  assert.equal(r.created.length, 1);
  assert.equal(r.duplicates[0].existing[0].title, 'Renew passport');
  const again = addCards(b, [{ title: 'Call mom', client_ref: 'x1' }], ann);
  assert.equal(again.created.length, 0);
  assert.equal(again.existing.length, 1);
  assert.equal(b.openCards().length, 2);
});

test('fuzzy references: exact, partial, ambiguous, none', () => {
  const b = fresh();
  addCards(b, [{ title: "Review Raj's PR on tunnel config" }, { title: 'Security review of OAuth' }, { title: 'Weekly review' }, { title: 'Finish DB migration' }], ann);
  const ok = resolveCard(b, 'migration');
  assert.ok(ok.ok && ok.card.title === 'Finish DB migration');
  const raj = resolveCard(b, "raj's pr");
  assert.ok(raj.ok && raj.card.title.startsWith('Review Raj'));
  const amb = resolveCard(b, 'review');
  assert.ok(!amb.ok && amb.reason === 'ambiguous' && amb.candidates.length >= 2);
  const none = resolveCard(b, 'zebra stripes');
  assert.ok(!none.ok && none.reason === 'none');
  const id = resolveCard(b, '#1');
  assert.ok(id.ok && id.card.id === 1);
});

test('an unresolved reference aborts the whole update batch', () => {
  const b = fresh();
  addCards(b, [{ title: 'Alpha task' }, { title: 'Beta task' }], ann);
  const r = updateCards(b, [{ card: 'alpha', move_to: 'done' }, { card: 'gamma', move_to: 'done' }], ann);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.batch, null);
  assert.equal(b.openCards().filter((c) => b.isDone(c)).length, 0);
});

test('status update: complete, start and block in one call; side effects and summary', () => {
  const b = fresh();
  addCards(b, [{ title: 'Write report' }, { title: 'Fix login bug' }, { title: 'Deploy release' }], ann);
  const r = updateCards(b, [
    { card: 'report', move_to: 'done' },
    { card: 'login', move_to: 'in progress' },
    { card: 'deploy', blocked_reason: 'waiting on QA' },
  ], ann);
  assert.equal(r.updated.length, 3);
  assert.match(r.batch!.summary, /Completed 1, moved 1 to In Progress, blocked 1/);
  const report = b.openCards().find((c) => c.title === 'Write report')!;
  assert.ok(report.completed_at);
  const login = b.openCards().find((c) => c.title === 'Fix login bug')!;
  assert.ok(login.started_at);
  assert.equal(b.openCards().find((c) => c.title === 'Deploy release')!.blocked_reason, 'waiting on QA');
});

test('undo skips entities edited since, and reports them', () => {
  const b = fresh();
  const r = addCards(b, [{ title: 'One' }, { title: 'Two' }], ann);
  const one = r.created.find((c) => c.title === 'One')!;
  b.batch(web, (tx) => tx.updateCard(one.id, { title: 'One (edited)' }));
  const u = b.undo(r.batch!.id, ann);
  assert.equal(u.conflicts.length, 1);
  assert.deepEqual(b.openCards().map((c) => c.title), ['One (edited)']);
});

test('recurring card spawns the next occurrence when done; undo removes it', () => {
  const b = fresh();
  const [gym] = addCards(b, [{ title: 'Gym', recurrence: 'every mon, wed and fri' }], ann).created;
  assert.ok(gym.due_at, 'a recurring card gets a first due date');
  const r = updateCards(b, [{ card: 'gym', move_to: 'done' }], ann);
  const open = b.openCards().filter((c) => !b.isDone(c));
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'Gym');
  assert.ok(open[0].due_at! > gym.due_at!);
  assert.ok([1, 3, 5].includes(new Date(open[0].due_at! + 5.5 * 3600_000).getUTCDay()));
  assert.equal(b.mustCard(gym.id).recurrence, null);
  b.undo(r.batch!.id, ann);
  assert.equal(b.openCards().length, 1);
  assert.ok(b.mustCard(gym.id).recurrence);
});

test('checklist operations by number, text and id', () => {
  const b = fresh();
  const [c] = addCards(b, [{ title: 'Ship it', checklist: ['Build', 'Test', 'Deploy'] }], ann).created;
  updateCards(b, [{ card: c.id, checklist_ops: [{ op: 'check', id: '1' }, { op: 'check', id: 'test' }, { op: 'add', text: 'Announce' }, { op: 'remove', id: c.checklist[2].id }] }], ann);
  const after = b.mustCard(c.id);
  assert.deepEqual(after.checklist.map((i) => [i.text, i.done]), [['Build', true], ['Test', true], ['Announce', false]]);
});

test('drag and drop positions, WIP warnings and moves record transitions', () => {
  const b = fresh();
  const cards = addCards(b, [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }], web).created;
  const doing = b.resolveColumn('doing');
  b.batch(web, (tx) => tx.updateColumn(doing.id, { wip_limit: 2 }));
  let notes: string[] = [];
  for (const c of cards.slice(0, 3)) b.batch(web, (tx) => { tx.moveCard(c.id, doing.id); notes = tx.notes; });
  assert.match(notes.join(' '), /WIP limit/);
  // Drop D between A and B in To Do... it's the only one left there; drop it into Doing after A.
  const a = cards[0], d = cards[3];
  b.batch(web, (tx) => tx.moveCard(d.id, doing.id, a.id, null));
  const order = b.openCards().filter((c) => c.column_id === doing.id).sort((x, y) => x.position - y.position).map((c) => c.title);
  assert.equal(order.indexOf('D'), order.indexOf('A') + 1);
  const n = (b.db.prepare('SELECT COUNT(*) AS n FROM transitions').get() as { n: number }).n;
  assert.equal(n, 4 + 4);
});

test('focus sessions log time and only one runs at a time', () => {
  const b = fresh();
  const [x, y] = addCards(b, [{ title: 'X' }, { title: 'Y' }], web).created;
  b.batch(web, (tx) => tx.focus(x.id, 'start'));
  assert.equal(b.kindOf(b.mustCard(x.id).column_id), 'doing');
  b.db.prepare('UPDATE cards SET focus_started_at = ? WHERE id = ?').run(Date.now() - 30 * 60000, x.id);
  b.batch(web, (tx) => tx.focus(y.id, 'start'));
  assert.equal(b.mustCard(x.id).focus_started_at, null);
  assert.equal(b.mustCard(x.id).spent_min, 30);
  assert.ok(b.mustCard(y.id).focus_started_at);
});

test('archive needs confirmation; restore brings it back', () => {
  const b = fresh();
  addCards(b, [{ title: 'Old thing' }], ann);
  const preview = archiveCards(b, ['old thing'], ann);
  assert.equal(preview.confirmed, false);
  assert.equal(b.openCards().length, 1);
  archiveCards(b, ['old thing'], ann, { confirm: true });
  assert.equal(b.openCards().length, 0);
  const r = updateCards(b, [{ card: 'old thing', restore: true }], ann);
  assert.equal(r.updated.length, 1);
  assert.equal(b.openCards().length, 1);
});

test('quick add parses tokens and lines', () => {
  const b = fresh();
  const r = quickAdd(b, 'Fix login bug tomorrow !p1 #auth @backend ~2h\n- Call the bank *today\nPay rent monthly', web);
  assert.equal(r.created.length, 3);
  const fix = r.created.find((c) => c.title === 'Fix login bug')!;
  assert.equal(fix.priority, 1);
  assert.deepEqual(fix.tags, ['auth']);
  assert.equal(b.findProject('backend')?.id, fix.project_id);
  assert.equal(fix.estimate_min, 120);
  assert.equal(r.created.find((c) => c.title === 'Call the bank')!.planned_for, localDay(Date.now(), 'Asia/Kolkata'));
  assert.equal(r.created.find((c) => c.title === 'Pay rent')!.recurrence?.unit, 'month');
});

test('ranking, plan, triage, summaries and insights run on a populated board', () => {
  const b = fresh();
  addCards(b, [
    { title: 'Urgent overdue', due: '2020-01-01', priority: 'P0' as any },
    { title: 'Someday idea', column: 'backlog', priority: 'P3' as any },
    { title: 'Normal task', estimate_min: '30m' },
    { title: 'Blocked task', blocked_reason: 'waiting' },
  ], ann);
  const r = rank(b, { minutes: 45 });
  assert.equal(r[0].card.title, 'Urgent overdue');
  assert.ok(!r.some((x) => x.card.title === 'Blocked task'));
  assert.ok(!r.some((x) => x.card.title === 'Someday idea'));
  const plan = planDay(b);
  assert.ok(plan.cards.length >= 2);
  const t = triage(b);
  assert.equal(t.overdue.length, 1);
  assert.equal(t.blocked.length, 1);
  for (const k of ['standup', 'daily', 'weekly'] as const) assert.ok(summary(b, k).text.length > 20);
  updateCards(b, [{ card: 'normal task', move_to: 'done' }], ann);
  const i = insights(b, 14);
  assert.equal(i.throughput.at(-1)!.completed, 1);
  assert.equal(i.ann.batches, 2);
  assert.equal(i.streak_days, 1);
  assert.equal(i.cfd.length, 14);
});

test('board config: columns, projects, tags and settings are undoable', () => {
  const b = fresh();
  addCards(b, [{ title: 'T', tags: ['bug', 'urgent-fix'] }], ann);
  const r = b.batch(web, (tx) => {
    tx.createColumn({ name: 'Blocked', kind: 'review' });
    tx.createProject({ name: 'Side quest' });
    const tags = b.tags();
    tx.mergeTags(tags.find((t) => t.name === 'urgent-fix')!.id, tags.find((t) => t.name === 'bug')!.id);
    tx.updateSettings({ day_capacity_min: 240 });
  });
  assert.equal(b.columns().length, 6);
  assert.equal(b.columns().at(-1)!.kind, 'done', 'new columns go before Done');
  assert.deepEqual(b.openCards()[0].tags, ['bug']);
  b.undo(r.batch!.id, web);
  assert.equal(b.columns().length, 5);
  assert.equal(b.findProject('Side quest'), null);
  assert.deepEqual(b.openCards()[0].tags.sort(), ['bug', 'urgent-fix']);
  assert.equal(b.settings().day_capacity_min, 360);
});

test('export and import round-trip', () => {
  const b = fresh();
  addCards(b, [{ title: 'Keep me', project: 'P', tags: ['t'], checklist: ['a'] }, { title: 'Done one', column: 'done' }], ann);
  const data = JSON.parse(JSON.stringify(exportJson(b)));
  const c = fresh();
  const r = importJson(c, data, web);
  assert.equal(r.cards, 2);
  const keep = c.openCards().find((x) => x.title === 'Keep me')!;
  assert.deepEqual(keep.tags, ['t']);
  assert.equal(c.findProject('P')?.id, keep.project_id);
  assert.equal(c.kindOf(c.openCards().find((x) => x.title === 'Done one')!.column_id), 'done');
});

test('optimistic concurrency rejects stale web edits', () => {
  const b = fresh();
  const [c] = addCards(b, [{ title: 'V' }], web).created;
  b.batch(web, (tx) => tx.updateCard(c.id, { title: 'V2' }));
  assert.throws(() => b.batch(web, (tx) => tx.updateCard(c.id, { title: 'V3', version: c.version })), /changed since/);
});
