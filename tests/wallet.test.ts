import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.ts';
import { addCards, updateCards } from '../src/core/ops.ts';
import { getWallet } from '../src/core/wallet.ts';
import { addDays, startOfDay, zonedTime, parseDay } from '../src/core/time.ts';
import { createServers } from '../src/server/http.ts';
import { loadConfig } from '../src/server/config.ts';

const web = { actor: 'web' as const, action: 'web:test' };
const ann = { actor: 'ann' as const, client: 'Test', action: 'test' };
const TZ = 'Asia/Kolkata';

function setup(opts: { start?: boolean; baseline?: boolean } = {}) {
  const b = new Board(':memory:');
  b.batch(web, (tx) => tx.updateSettings({ timezone: TZ }));
  const w = getWallet(b);
  if (opts.start !== false) w.start({ baseline: opts.baseline ?? false });
  return { b, w };
}

/** Give a card `minutes` of logged focus ending now. */
function focus(b: Board, cardId: number, minutes: number, endsAt = Date.now()) {
  b.db.prepare('INSERT INTO focus_log(card_id, started_at, ended_at, minutes) VALUES (?, ?, ?, ?)').run(cardId, endsAt - minutes * 60000, endsAt, minutes);
}

const kinds = (w: ReturnType<typeof getWallet>) => w.ledger({ limit: 100 }).map((r) => `${r.kind}:${r.amount}`).reverse();

test('off until started; starting posts the daily allowance (yours to lose)', () => {
  const { b, w } = setup({ start: false });
  addCards(b, [{ title: 'x' }], web);
  assert.equal(w.phase(), 'off');
  assert.equal(w.balance(), 0);
  w.start({ baseline: false });
  assert.equal(w.phase(), 'active');
  assert.equal(w.balance(), 10);
});

test('focus minutes vest when the card is done; card count earns nothing', () => {
  const { b, w } = setup();
  const [c] = addCards(b, [{ title: 'Deep work', priority: 'P2' as any }], web).created;
  focus(b, c.id, 60);
  updateCards(b, [{ card: c.id, move_to: 'done' }], web);
  // 60 × 0.25 = 15, plus the 3-minute bonus (≥25 focus minutes).
  assert.equal(w.balance(), 10 + 15 + 3);
  // An instant create-and-complete card earns nothing.
  const [quick] = addCards(b, [{ title: 'Trivial' }], web).created;
  updateCards(b, [{ card: quick.id, move_to: 'done' }], web);
  assert.equal(w.balance(), 28);
});

test('undo and reopening claw credit back; re-completing does not pay twice', () => {
  const { b, w } = setup();
  const [c] = addCards(b, [{ title: 'Report' }], web).created;
  focus(b, c.id, 40);
  const done = updateCards(b, [{ card: c.id, move_to: 'done' }], web);
  assert.equal(w.balance(), 10 + 10 + 3);
  b.undo(done.batch!.id, web);
  assert.equal(w.balance(), 10);
  updateCards(b, [{ card: c.id, move_to: 'done' }], web);
  assert.equal(w.balance(), 23);
  updateCards(b, [{ card: c.id, move_to: 'todo' }], web);
  assert.equal(w.balance(), 10);
});

test("Ann's completions wait for the owner's confirmation", () => {
  const { b, w } = setup();
  const [c] = addCards(b, [{ title: 'Slides' }], web).created;
  focus(b, c.id, 40);
  updateCards(b, [{ card: c.id, move_to: 'done' }], ann);
  assert.equal(w.balance(), 10);
  assert.equal(w.pendingCards().length, 1);
  w.confirmCredit(c.id, true);
  assert.equal(w.balance(), 23);
  assert.equal(w.pendingCards().length, 0);
});

test('priority is locked at first focus; on-time needs a due date set well in advance', () => {
  const { b, w } = setup();
  const [c] = addCards(b, [{ title: 'Ship', priority: 'P3' as any }], web).created;
  b.batch(web, (tx) => tx.focus(c.id, 'start'));
  b.batch(web, (tx) => tx.updateCard(c.id, { priority: 0 }));
  b.batch(web, (tx) => tx.focus(c.id, 'stop'));
  focus(b, c.id, 40);
  // Due date set just now: no on-time multiplier.
  updateCards(b, [{ card: c.id, due: 'in 3 days', move_to: 'done' }], web);
  // 40 × 0.25 × 0.75 (P3, locked) = 7.5 → 8, plus bonus 3.
  assert.equal(w.balance(), 10 + 8 + 3);
});

test('daily earning cap', () => {
  const { b, w } = setup();
  const cards = addCards(b, [{ title: 'A' }, { title: 'B' }], web).created;
  // Four 60-minute sessions each (a single long session would be cut at the 90-minute session cap).
  for (const c of cards) for (let i = 0; i < 4; i++) focus(b, c.id, 60, Date.now() - i * 3600_000);
  updateCards(b, cards.map((c) => ({ card: c.id, move_to: 'done' })), web);
  assert.equal(w.balance(), 10 + 60);
});

test('focus overlapping a phone session is voided', () => {
  const { b, w } = setup();
  const [c] = addCards(b, [{ title: 'Focus?' }], web).created;
  const now = Date.now();
  focus(b, c.id, 60, now);
  // 30 minutes of the hour were spent in a walled app.
  b.db.prepare("INSERT INTO phone_sessions(device_id, app, kind, started_at, ends_at, stopped_at) VALUES (1, 'yt', 'spend', ?, ?, ?)").run(now - 40 * 60000, now - 10 * 60000, now - 10 * 60000);
  assert.equal(w.focusMinutes(c.id), 30);
});

test('spending: prepaid sessions, early stop refunds, empty wallet blocks, go-back reward', () => {
  const { w } = setup();
  const s = w.spend(1, 'com.instagram.android', 5) as any;
  assert.equal(w.balance(), 5);
  assert.throws(() => w.spend(1, 'x', 5), /already running/);
  const r = w.stopSession(s.id, s.started_at + 60_000);
  assert.equal(r.refunded, 4);
  assert.equal(w.balance(), 9);
  assert.throws(() => w.spend(1, 'x', 10), /only 9 minutes/);
  assert.throws(() => w.spend(1, 'x', 30), /minutes must be/);
  for (let i = 0; i < 7; i++) w.back();
  assert.equal(w.balance(), 9 + 5, 'go-back reward is capped at 5 a day');
});

test('baseline week: nothing is charged and nothing is enforced', () => {
  const { w } = setup({ baseline: true });
  assert.equal(w.phase(), 'baseline');
  assert.equal(w.phoneState().enforce, false);
  w.spend(1, 'yt', 20);
  assert.equal(w.balance(), 0);
});

test('emergency unlock: costs 30, can go into debt down to the floor, limited per week', () => {
  const { w } = setup();
  w.emergency(1, 'need the train app thing');
  assert.equal(w.balance(), -20);
  const s = w.activeSession()!;
  w.stopSession(s.id);
  w.emergency(1, 'again, really');
  assert.equal(w.balance(), -50);
  w.stopSession(w.activeSession()!.id);
  assert.throws(() => w.emergency(1, 'third time'), /no emergency unlocks left|debt floor/);
});

test('debt is repaid at 1.5x by earnings', () => {
  const { b, w } = setup();
  w.adjust(-30, 'confessed to doomscrolling', 'web');
  assert.equal(w.balance(), -20);
  const [c] = addCards(b, [{ title: 'Payback' }], web).created;
  focus(b, c.id, 40); // base 10 → 15 toward the debt; bonus 3 → after debt is cleared... (20 owed)
  updateCards(b, [{ card: c.id, move_to: 'done' }], web);
  // base: 10 × 1.5 = 15 (debt 20 → 5). bonus: 3 → first 5/1.5 ≈ 3.33 of it clears the rest... → +5, capped by the 3 earned
  assert.ok(w.balance() > -20 + 13, `balance ${w.balance()} should reflect the 1.5x repayment`);
});

test('closing a day: missed plan and overdue P1 penalties, capped; pause day refunds them', () => {
  const { b, w } = setup();
  // Find the next weekday to use as "day 1", and make the wallet think it started then.
  let day = b.today();
  while ([0, 6].includes(new Date(day + 'T12:00:00Z').getUTCDay())) day = addDays(day, 1);
  const { y, m, d } = parseDay(day);
  const morning = zonedTime(y, m, d, 9, 0, TZ);
  const s = b.meta<any>('wallet', null);
  b.setMeta('wallet', { ...s, started: day, last_closed: addDays(day, -1) });
  addCards(b, [{ title: 'Planned thing', planned_for: day }], web);
  addCards(b, [{ title: 'Urgent overdue', priority: 'P1' as any, due: addDays(day, -2) }], web);
  w.tick(morning);
  const before = w.balance();
  // Next morning: day 1 closes.
  w.tick(startOfDay(addDays(day, 1), TZ) + 9 * 3600_000);
  const k = kinds(w);
  assert.ok(k.includes('forfeit:-10'), k.join(' '));
  assert.ok(k.includes('penalty:-10'), k.join(' '));
  assert.ok(k.includes('penalty:-5'), k.join(' '));
  const after = w.balance();
  assert.ok(after < before);
  // Declaring day 1 a pause day (yesterday) refunds its penalties.
  w.pauseDay(day, 'was sick', 'ann', startOfDay(addDays(day, 1), TZ) + 10 * 3600_000);
  assert.ok(w.balance() > after);
});

test("Ann's adjustments are bounded, need a reason, and can be vetoed", () => {
  const { w } = setup();
  assert.throws(() => w.adjust(5, 'meh', 'ann'), /real reason/);
  w.adjust(15, 'logged 3h of offline lab work the timer missed', 'ann');
  assert.throws(() => w.adjust(5, 'more offline work today', 'ann'), /grant limit/);
  const fine = w.adjust(-20, 'admitted to scrolling during a focus session', 'ann')!;
  assert.equal(w.balance(), 10 + 15 - 20);
  w.veto(fine.id);
  assert.equal(w.balance(), 25);
  assert.throws(() => w.veto(fine.id), /already vetoed/);
});

test('rule changes wait until next Monday once active; walling more apps applies now', () => {
  const { w } = setup();
  const r = w.setRules({ rate: 0.5, walled_apps: [...w.rules().walled_apps, 'com.example.game'] });
  assert.notEqual(r.effective, null);
  assert.equal(w.rules().rate, 0.25);
  assert.ok(w.rules().walled_apps.includes('com.example.game'));
  assert.throws(() => w.setRules({ rate: 9 }), /between/);
  assert.throws(() => w.setRules({ walled_apps: ['not a package'] }), /package names/);
});

test('snoozing an overdue P1 costs minutes', () => {
  const { b, w } = setup();
  addCards(b, [{ title: 'Late urgent', priority: 'P1' as any, due: '2020-01-01' }], web);
  updateCards(b, [{ card: 'late urgent', due: 'next friday' }], web);
  assert.ok(kinds(w).includes('penalty:-5'), kinds(w).join(' '));
});

test('phone API: device tokens, state, spend, revoke', async () => {
  const { b } = setup();
  const { ui } = createServers(b, loadConfig({}), { owner: null, verifyToken: null });
  const call = (path: string, init: RequestInit = {}) => ui.fetch(new Request(`http://localhost${path}`, { ...init, headers: { host: 'localhost:4321', 'content-type': 'application/json', ...(init.headers as any) } }), { remoteAddress: '127.0.0.1' });
  const dev = await (await call('/api/devices', { method: 'POST', body: JSON.stringify({ name: 'Pixel' }) })).json();
  assert.ok(dev.token);
  const auth = { authorization: `Bearer ${dev.token}` };
  assert.equal((await call('/api/phone/state')).status, 401);
  const st = await (await call('/api/phone/state', { headers: auth })).json();
  assert.equal(st.enforce, true);
  assert.equal(st.balance, 10);
  assert.ok(st.walled_apps.includes('com.instagram.android'));
  const sp = await call('/api/phone/session', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'start', app: 'com.instagram.android', minutes: 5 }) });
  assert.equal(sp.status, 200);
  assert.equal((await sp.json()).state.balance, 5);
  const broke = await call('/api/phone/session', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'start', app: 'x', minutes: 5 }) });
  assert.equal(broke.status, 409);
  await call(`/api/devices/${dev.id}`, { method: 'DELETE', body: '{}' });
  assert.equal((await call('/api/phone/state', { headers: auth })).status, 401);
  // The owner can fine themselves but never grant.
  const fine = await call('/api/wallet/fine', { method: 'POST', body: JSON.stringify({ minutes: 3, reason: 'cheated on a session' }) });
  assert.equal((await fine.json()).balance, 2);
});
