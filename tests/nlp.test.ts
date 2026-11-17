import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseQuickAdd, parseRecurrence, nextOccurrence, parseEstimate } from '../src/core/nlp.ts';
import { localDay } from '../src/core/time.ts';

// Tue 17 Nov 2026, 11:30 in Kolkata.
const NOW = Date.parse('2026-11-17T06:00:00Z');
const TZ = 'Asia/Kolkata';
const day = (t: string) => parseDate(t, TZ, NOW)?.day;

test('dates resolve in the owner timezone', () => {
  assert.equal(day('friday'), '2026-11-20');
  assert.equal(day('tomorrow'), '2026-11-18');
  assert.equal(day('in 3 days'), '2026-11-20');
  assert.equal(day('eod'), '2026-11-17');
  assert.equal(day('eow'), '2026-11-20');
  assert.equal(day('next week'), '2026-11-23');
  assert.equal(day('2026-12-01'), '2026-12-01');
  assert.equal(day('21 nov'), '2026-11-21');
  assert.equal(day('12/5'), '2027-05-12', 'day-first outside the Americas');
  assert.equal(parseDate('12/5', 'America/New_York', NOW)?.day, '2026-12-05');
  assert.equal(parseDate('not a date at all', TZ, NOW), null);
});

test('times become exact instants; date-only is end of the local day', () => {
  const t = parseDate('tomorrow 5pm', TZ, NOW)!;
  assert.equal(t.has_time, true);
  assert.equal(new Date(t.due_at).toISOString(), '2026-11-18T11:30:00.000Z');
  const d = parseDate('friday', TZ, NOW)!;
  assert.equal(d.has_time, false);
  assert.equal(localDay(d.due_at, TZ), '2026-11-20');
  assert.equal(localDay(d.due_at + 1, TZ), '2026-11-21');
});

test('late-night "tomorrow" uses the owner\'s day, not UTC', () => {
  // 01:30 Wed in Kolkata is still Tue in UTC.
  const lateNight = Date.parse('2026-11-17T20:00:00Z');
  assert.equal(parseDate('tomorrow', TZ, lateNight)?.day, '2026-11-19');
});

test('recurrence phrases and next occurrences', () => {
  assert.deepEqual(parseRecurrence('every weekday')?.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(parseRecurrence('every 2 weeks')?.every, 2);
  assert.equal(parseRecurrence('monthly')?.unit, 'month');
  assert.deepEqual(parseRecurrence('every mon and thu')?.weekdays, [1, 4]);
  assert.equal(parseRecurrence('buy milk'), null);
  const mt = parseRecurrence('every mon and thu')!;
  assert.equal(nextOccurrence(mt, '2026-11-17'), '2026-11-19');
  assert.equal(nextOccurrence(mt, '2026-11-19'), '2026-11-23');
  assert.equal(nextOccurrence(parseRecurrence('monthly')!, '2026-01-31'), '2026-02-28');
});

test('estimates', () => {
  assert.equal(parseEstimate('2h'), 120);
  assert.equal(parseEstimate('1h30m'), 90);
  assert.equal(parseEstimate('45 min'), 45);
  assert.equal(parseEstimate('1.5h'), 90);
  assert.throws(() => parseEstimate('a while'));
});

test('quick add pulls tokens out of the title', () => {
  const p = parseQuickAdd('Prepare March report by friday !high #finance @"Side Project" ~90m *today', TZ, NOW);
  assert.equal(p.title, 'Prepare March report');
  assert.equal(p.priority, 1);
  assert.deepEqual(p.tags, ['finance']);
  assert.equal(p.project, 'Side Project');
  assert.equal(p.estimate_min, 90);
  assert.equal(p.planned_today, true);
  assert.equal(p.due_label, 'Fri 20 Nov');
  // A bare month name stays in the title.
  assert.equal(parseQuickAdd('Prepare March report', TZ, NOW).due_at, null);
});
