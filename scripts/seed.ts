// Fill a fresh database with a realistic board and ~3 weeks of history, for development and screenshots.
//   npm run seed            (refuses if the board already has cards)
//   npm run seed -- --force (deletes the existing database first)
import { existsSync, rmSync } from 'node:fs';
import { Board } from '../src/core/board.ts';
import { DEFAULT_DB_PATH } from '../src/core/db.ts';
import { addCards, updateCards } from '../src/core/ops.ts';
import { addDays, endOfDay, localDay, zonedTime, parseDay } from '../src/core/time.ts';

const force = process.argv.includes('--force');
if (force) for (const s of ['', '-wal', '-shm']) if (existsSync(DEFAULT_DB_PATH + s)) rmSync(DEFAULT_DB_PATH + s);
const board = new Board(DEFAULT_DB_PATH);
if (board.openCards().length && !force) {
  console.error('The board already has cards. Use --force to wipe it and reseed.');
  process.exit(1);
}

const tz = board.tz;
const today = board.today();
const col = (k: string) => board.resolveColumn(k).id;
const ann = (client: string, utterance: string) => ({ actor: 'ann' as const, client, action: 'add_cards', utterance });

board.batch({ actor: 'web', action: 'web:settings' }, (tx) => {
  tx.updateSettings({ display_name: 'Karthik' });
  for (const [name, color, icon, description] of [
    ['Hey Ann', '#7c8cff', '🗂️', 'This board, and its MCP server'],
    ['Orbit Cloud', '#4fd1c5', '🛰️', 'Home server and k3s platform'],
    ['Socrates', '#f6ad55', '🦉', 'Quiz platform'],
    ['Learning', '#b794f4', '📚', 'Courses and reading'],
    ['Life', '#68d391', '🌱', 'Errands, health, money'],
  ]) tx.createProject({ name, color, icon, description });
  tx.summary = 'Set up projects';
});

addCards(board, [
  { title: 'Finish the Postgres to SQLite migration', due: 'friday', priority: 'P1', project: 'Orbit Cloud', tags: ['db'], estimate_min: '3h', notes: 'Dry-run on a copy first. Keep the old volume for a week.', checklist: ['Export schema', 'Write migration script', 'Dry run on a copy', 'Cut over'] },
  { title: "Review Raj's PR on the tunnel config", due: 'tomorrow', priority: 'P1', project: 'Orbit Cloud', tags: ['review'], estimate_min: '45m' },
  { title: 'Prep slides for Monday demo', due: 'monday 10am', project: 'Hey Ann', tags: ['demo'], estimate_min: '2h' },
], ann('Claude', "Hey Ann, I need to finish the DB migration by Friday, review Raj's PR tomorrow, and prep slides for Monday's demo at 10"));

addCards(board, [
  { title: 'Renew passport', due: 'in 12 days', project: 'Life', priority: 'P1', tags: ['errand'], needs_review: true },
  { title: 'Pay rent', recurrence: 'monthly', due: addDays(today, 3), project: 'Life', tags: ['money'] },
  { title: 'Gym', recurrence: 'every mon, wed and fri', project: 'Life', tags: ['health'], estimate_min: '1h' },
  { title: 'Weekly review', recurrence: 'every friday', project: 'Hey Ann', estimate_min: '30m' },
], ann('ChatGPT', 'Hey Ann add: renew passport soon, pay rent every month, gym mon wed fri, and a weekly review every friday'));

addCards(board, [
  { title: 'Add widget view for MCP Apps', column: 'backlog', project: 'Hey Ann', tags: ['idea'] },
  { title: 'Read "Designing Data-Intensive Applications" ch. 7', column: 'backlog', project: 'Learning', estimate_min: '1h30m' },
  { title: 'Try Vikunja import', column: 'backlog', project: 'Hey Ann', priority: 'P3' },
  { title: 'Set up restic off-site backups', column: 'backlog', project: 'Orbit Cloud', tags: ['backups'], priority: 'P2' },
  { title: 'Learn Rust ownership basics', column: 'backlog', project: 'Learning', tags: ['rust'] },
  { title: 'Write Socrates import for Quizlet', column: 'todo', project: 'Socrates', estimate_min: '2h', tags: ['feature'] },
  { title: 'Fix flaky e2e test on the grades page', column: 'todo', project: 'Socrates', priority: 'P1', tags: ['bug'], estimate_min: '1h' },
  { title: 'Book dentist appointment', column: 'todo', project: 'Life', due: 'next week', estimate_min: '10m' },
  { title: 'Draft blog post: running MCP servers at home', column: 'todo', project: 'Learning', tags: ['writing'], estimate_min: '2h', due: 'in 9 days' },
  { title: 'Update Grafana dashboards for slate-web', column: 'todo', project: 'Orbit Cloud', tags: ['monitoring'], estimate_min: '1h' },
  { title: 'Wire VictoriaMetrics alert for disk usage', column: 'in progress', project: 'Orbit Cloud', tags: ['monitoring'], priority: 'P0', estimate_min: '1h30m', due: 'today 6pm' },
  { title: 'Calibrate question difficulty from answers', column: 'in progress', project: 'Socrates', tags: ['feature'], estimate_min: '4h', checklist: ['Collect attempts', 'Fit IRT model', 'Show in UI'] },
  { title: 'Security review of the OAuth flow', column: 'review', project: 'Orbit Cloud', tags: ['security'], blocked_reason: 'Waiting on Raj to sign off' },
  { title: 'Hey Ann onboarding copy', column: 'review', project: 'Hey Ann', tags: ['writing'] },
], ann('Claude', 'Hey Ann, brain dump time'));

// A few overdue and stale cards to triage.
addCards(board, [
  { title: 'Reply to the landlord about the lease', due: addDays(today, -2), priority: 'P1', project: 'Life', tags: ['errand'] },
  { title: 'Clean up old Docker images on the PC', due: addDays(today, -6), priority: 'P3', project: 'Orbit Cloud' },
], { actor: 'web', action: 'web:add' });

// History: completed cards spread over the last 3 weeks, so insights have something to show.
const doneTitles = [
  ['Deploy Socrates to Megatron', 'Socrates'], ['Write the Hey Ann plan', 'Hey Ann'], ['Fix slate-web event loop stalls', 'Orbit Cloud'],
  ['Add scrape job for slate-web', 'Orbit Cloud'], ['Spaced repetition settings page', 'Socrates'], ['Finish OAuth spike', 'Orbit Cloud'],
  ['Buy a new SSD for Megatron', 'Life'], ['Read the MCP auth spec', 'Learning'], ['Socrates Anki import', 'Socrates'],
  ['Tailscale serve for Sprawl', 'Orbit Cloud'], ['Courthouse planning session', 'Hey Ann'], ['File taxes', 'Life'],
  ['Watch the k3s networking talk', 'Learning'], ['Socrates code runner sandbox', 'Socrates'], ['Rotate Orbit Identity keys', 'Orbit Cloud'],
  ['Call the bank', 'Life'], ['Hey Ann data model', 'Hey Ann'], ['MCP tool design', 'Hey Ann'], ['Fix tag merge bug', 'Socrates'],
  ['Backup restore drill', 'Orbit Cloud'], ['Groceries', 'Life'], ['Draft API contract', 'Hey Ann'],
];
const doneCol = col('done');
const doingCol = col('in progress');
const r = addCards(board, doneTitles.map(([title, project]) => ({ title, project, estimate_min: [30, 60, 90, 120][title.length % 4] })), { actor: 'web', action: 'web:add' });
const set = board.db.prepare('UPDATE cards SET column_id = ?, created_at = ?, started_at = ?, completed_at = ?, updated_at = ?, spent_min = ? WHERE id = ?');
const tr = board.db.prepare('INSERT INTO transitions(card_id, at, from_column, to_column) VALUES (?, ?, ?, ?)');
const fl = board.db.prepare('INSERT INTO focus_log(card_id, started_at, ended_at, minutes) VALUES (?, ?, ?, ?)');
r.created.forEach((c, i) => {
  const dayBack = Math.max(0, 20 - Math.floor(i * 0.95));
  const d = parseDay(addDays(today, -dayBack));
  const completed = Math.min(zonedTime(d.y, d.m, d.d, 11 + (i % 7), (i * 13) % 60, tz), Date.now() - 3600_000);
  const started = completed - (2 + (i % 5) * 7) * 3600_000;
  const created = started - (1 + (i % 4)) * 864e5;
  const spent = Math.round((c.estimate_min ?? 60) * (0.7 + (i % 5) * 0.2));
  set.run(doneCol, created, started, completed, completed, spent, c.id);
  board.db.prepare('DELETE FROM transitions WHERE card_id = ?').run(c.id);
  tr.run(c.id, created, null, col('todo'));
  tr.run(c.id, started, col('todo'), doingCol);
  tr.run(c.id, completed, doingCol, doneCol);
  fl.run(c.id, completed - spent * 60000, completed, spent);
});
// Spread the open cards' creation over the last two weeks too, and backdate the batches so the activity feed reads naturally.
const openRows = board.db.prepare('SELECT id FROM cards WHERE completed_at IS NULL ORDER BY id').all() as { id: number }[];
openRows.forEach((o, i) => {
  const t = Date.now() - Math.round(((openRows.length - i) / openRows.length) * 14 * 864e5);
  board.db.prepare('UPDATE cards SET created_at = ?, updated_at = MAX(updated_at, ?) WHERE id = ?').run(t, t, o.id);
});
board.db.prepare('UPDATE transitions SET at = (SELECT created_at FROM cards WHERE cards.id = transitions.card_id) WHERE from_column IS NULL').run();
const batches = board.db.prepare('SELECT id FROM batches ORDER BY at').all() as { id: string }[];
batches.forEach((b, i) => board.db.prepare('UPDATE batches SET at = ? WHERE id = ?').run(Date.now() - (batches.length - i) * 5 * 3600_000, b.id));

// Today: a plan, a running focus session, and a status update from chat.
updateCards(board, [
  { card: 'disk usage alert', planned_today: true },
  { card: "Raj's PR", planned_today: true },
  { card: 'flaky e2e', planned_today: true },
], { actor: 'ann', client: 'Claude', action: 'plan_day', utterance: 'Hey Ann, plan my day' });
board.batch({ actor: 'web', action: 'web:focus:start' }, (tx) => {
  const c = board.openCards().find((x) => x.title.startsWith('Wire VictoriaMetrics'))!;
  tx.focus(c.id, 'start');
  board.db.prepare('UPDATE cards SET focus_started_at = ? WHERE id = ?').run(Date.now() - 18 * 60000, c.id);
  tx.summary = `Started focus on "${c.title}"`;
});
updateCards(board, [
  { card: 'onboarding copy', move_to: 'done' },
  { card: 'quizlet', move_to: 'in progress' },
], { actor: 'ann', client: 'ChatGPT', action: 'update_cards', utterance: 'Hey Ann, onboarding copy is done, starting on the Quizlet import' });

console.log(`Seeded ${board.openCards().length} cards in ${board.columns().length} columns (${DEFAULT_DB_PATH}). Today is ${today} in ${tz}.`);
void endOfDay; void localDay;
board.close();
