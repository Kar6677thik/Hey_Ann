// Natural-language parsing: due dates, recurrence, estimates and quick-add syntax. Dates resolve in the owner's
// timezone, never the server's, and the model's idea of "today" is never trusted.
import * as chrono from 'chrono-node';
import type { ParsedInput, Priority, Recurrence } from './types.ts';
import {
  addDays, addMonths, dayLabel, endOfDay, isDay, localDay, parseDay, timeLabel, tzOffsetMin, weekday, zonedTime,
} from './time.ts';

export interface ResolvedDate {
  due_at: number;
  has_time: boolean;
  day: string;
  /** "Fri 21 Nov" or "Fri 21 Nov 5pm". */
  label: string;
  /** The text that matched. */
  text: string;
  index: number;
}

const usesMonthFirst = (tz: string) => /^America\//.test(tz) || tz === 'US/Eastern' || tz === 'US/Pacific';

// Phrases chrono doesn't know, mapped to something it does (or to a fixed day).
function shortcut(text: string, today: string, weekStartsOn: number): { day: string; hour?: number } | null {
  const t = text.trim().toLowerCase().replace(/[.!]$/, '');
  if (/^(eod|end of (the )?day|by eod|tonight)$/.test(t)) return { day: today, hour: t === 'tonight' ? 21 : undefined };
  if (/^(eow|end of (the )?week|this weekend)$/.test(t)) {
    // The last working day of the week: Friday (or Saturday for "weekend").
    const target = t === 'this weekend' ? 6 : 5;
    const wd = weekday(today);
    return { day: addDays(today, (target - wd + 7) % 7) };
  }
  if (/^(next week)$/.test(t)) {
    const wd = weekday(today);
    return { day: addDays(today, ((weekStartsOn - wd + 7) % 7) || 7) };
  }
  if (/^(someday|no date|none|clear)$/.test(t)) return null;
  return null;
}

/**
 * Resolve a date phrase ("next friday 5pm", "in 3 days", "2026-12-01", "eow") to an instant in tz.
 * Returns null when nothing date-like is found.
 */
export function parseDate(text: string, tz: string, now = Date.now(), weekStartsOn = 1): ResolvedDate | null {
  const raw = text.trim();
  if (!raw) return null;
  const today = localDay(now, tz);
  if (isDay(raw)) return fromDay(raw, null, tz, today, raw, 0);
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(raw) ? Date.parse(raw) : NaN;
  if (!Number.isNaN(iso)) return { due_at: iso, has_time: true, day: localDay(iso, tz), label: `${dayLabel(localDay(iso, tz), today)} ${timeLabel(iso, tz)}`, text: raw, index: 0 };

  const sc = shortcut(raw, today, weekStartsOn);
  if (sc) return fromDay(sc.day, sc.hour ?? null, tz, today, raw, 0);

  const results = (usesMonthFirst(tz) ? chrono.casual : chrono.en.GB).parse(raw, { instant: new Date(now), timezone: tzOffsetMin(now, tz) }, { forwardDate: true });
  const r = results.find((x) => !isBareMonth(x));
  if (!r) {
    // Shortcuts embedded in a longer sentence: "finish report eod".
    const m = /\b(eod|eow|end of (the )?(day|week)|tonight|next week)\b/i.exec(raw);
    if (m) {
      const s = shortcut(m[0], today, weekStartsOn);
      if (s) return fromDay(s.day, s.hour ?? null, tz, today, m[0], m.index);
    }
    return null;
  }
  const s = r.start;
  const day = `${s.get('year')}-${String(s.get('month')).padStart(2, '0')}-${String(s.get('day')).padStart(2, '0')}`;
  const hasTime = s.isCertain('hour');
  return fromDay(day, hasTime ? s.get('hour')! : null, tz, today, r.text, r.index, hasTime ? s.get('minute') ?? 0 : 0);
}

function isBareMonth(r: chrono.ParsedResult): boolean {
  // "Prepare March report": a month name alone is far more often a title word than a deadline.
  return !r.start.isCertain('day') && !r.start.isCertain('weekday') && /^[a-z]+\.?$/i.test(r.text.trim());
}

function fromDay(day: string, hour: number | null, tz: string, today: string, text: string, index: number, minute = 0): ResolvedDate {
  const { y, m, d } = parseDay(day);
  if (hour === null) return { due_at: endOfDay(day, tz), has_time: false, day, label: dayLabel(day, today), text, index };
  const due_at = zonedTime(y, m, d, hour, minute, tz);
  return { due_at, has_time: true, day, label: `${dayLabel(day, today)} ${timeLabel(due_at, tz)}`, text, index };
}

// ---------------------------------------------------------------- recurrence

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};
const FULL_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NUM_WORDS: Record<string, number> = { other: 2, two: 2, three: 3, four: 4, five: 5, six: 6, second: 2, third: 3 };

/** The recurrence phrase pattern, also used to cut it out of quick-add text. */
export const RECURRENCE_RE =
  /\b(?:every\s+(?:(\d+|other|two|three|four|five|six)\s+)?(days?|weeks?|months?|years?|weekdays?|workdays?|(?:(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?s?(?:\s*(?:,|and|&)\s*)?)+)|daily|weekly|biweekly|fortnightly|monthly|yearly|annually|weekdays)\b/i;

export function parseRecurrence(text: string): Recurrence | null {
  const m = RECURRENCE_RE.exec(text.trim());
  if (!m) return null;
  const whole = m[0].toLowerCase();
  const fixed: Record<string, Recurrence> = {
    daily: { every: 1, unit: 'day', label: 'every day' },
    weekly: { every: 1, unit: 'week', label: 'every week' },
    biweekly: { every: 2, unit: 'week', label: 'every 2 weeks' },
    fortnightly: { every: 2, unit: 'week', label: 'every 2 weeks' },
    monthly: { every: 1, unit: 'month', label: 'every month' },
    yearly: { every: 1, unit: 'year', label: 'every year' },
    annually: { every: 1, unit: 'year', label: 'every year' },
    weekdays: { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5], label: 'every weekday' },
  };
  if (fixed[whole]) return fixed[whole];
  const n = m[1] ? (NUM_WORDS[m[1].toLowerCase()] ?? Number(m[1])) : 1;
  const what = m[2].toLowerCase();
  if (/^(weekdays?|workdays?)$/.test(what)) return { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5], label: 'every weekday' };
  const unit = /^day/.test(what) ? 'day' : /^week/.test(what) ? 'week' : /^month/.test(what) ? 'month' : /^year/.test(what) ? 'year' : null;
  if (unit) return { every: n, unit, label: n === 1 ? `every ${unit}` : `every ${n} ${unit}s` };
  const days = [...new Set(what.split(/\s*(?:,|and|&|\s)\s*/).map((w) => DAY_NAMES[w.replace(/s$/, '')] ?? DAY_NAMES[w]).filter((d) => d !== undefined))].sort();
  if (!days.length) return null;
  return { every: n, unit: 'week', weekdays: days, label: `every ${n > 1 ? n + ' weeks on ' : ''}${days.map((d) => FULL_DAY[d]).join(', ')}` };
}

export function normalizeRecurrence(r: unknown): Recurrence | null {
  if (r === null || r === undefined || r === '') return null;
  if (typeof r === 'string') {
    const p = parseRecurrence(r);
    if (!p) throw new Error(`invalid recurrence "${r}" (try "every weekday", "every 2 weeks", "every mon and thu", "monthly")`);
    return p;
  }
  const o = r as Recurrence;
  if (!o || !Number.isInteger(o.every) || o.every < 1 || o.every > 365 || !['day', 'week', 'month', 'year'].includes(o.unit))
    throw new Error('invalid recurrence object');
  const weekdays = o.unit === 'week' && Array.isArray(o.weekdays) ? [...new Set(o.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : undefined;
  return { every: o.every, unit: o.unit, ...(weekdays?.length ? { weekdays } : {}), label: o.label || (o.every === 1 ? `every ${o.unit}` : `every ${o.every} ${o.unit}s`) };
}

/** The next occurrence strictly after `day`. */
export function nextOccurrence(r: Recurrence, day: string): string {
  if (r.unit === 'day') return addDays(day, r.every);
  if (r.unit === 'month') return addMonths(day, r.every);
  if (r.unit === 'year') return addMonths(day, 12 * r.every);
  if (!r.weekdays?.length) return addDays(day, 7 * r.every);
  // Next listed weekday in this week; past the last one, jump `every` weeks ahead to the first listed day.
  const wd = weekday(day);
  const later = r.weekdays.find((d) => d > wd);
  if (later !== undefined) return addDays(day, later - wd);
  return addDays(day, 7 * (r.every - 1) + (7 - wd) + r.weekdays[0]);
}

/** First occurrence on or after `today` (for a recurring card created without a due date). */
export function firstOccurrence(r: Recurrence, today: string): string {
  if (r.unit === 'week' && r.weekdays?.length) {
    const wd = weekday(today);
    if (r.weekdays.includes(wd)) return today;
    return nextOccurrence({ ...r, every: 1 }, today);
  }
  return today;
}

// ---------------------------------------------------------------- estimates & quick add

/** "2h", "90m", "1.5h", "1h30m", "45 min" -> minutes. */
export function parseEstimate(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined || text === '') return null;
  if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? Math.round(text) : null;
  const t = text.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?))?\s*(?:(\d+)\s*(?:m|min|mins|minutes?))?$/.exec(t);
  if (!m || (!m[1] && !m[2])) throw new Error(`invalid estimate "${text}" (try "30m", "2h", "1h30m")`);
  return Math.round((m[1] ? Number(m[1]) * 60 : 0) + (m[2] ? Number(m[2]) : 0));
}

const PRIORITY_WORDS: Record<string, Priority> = { p0: 0, urgent: 0, critical: 0, p1: 1, high: 1, p2: 2, normal: 2, medium: 2, p3: 3, low: 3 };

export function parsePriority(v: unknown): Priority | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && [0, 1, 2, 3].includes(v)) return v as Priority;
  const p = PRIORITY_WORDS[String(v).trim().toLowerCase().replace(/^!/, '')];
  if (p === undefined) throw new Error(`invalid priority "${v}" (use P0 urgent, P1 high, P2 normal, P3 low)`);
  return p;
}

/**
 * Quick-add syntax: "Fix login bug tomorrow 5pm !p1 #auth @backend ~2h *today every weekday".
 * Tokens: !p0-3 / !urgent|high|low, #tag, @project (use - or _ for spaces), ~estimate, *today, >column,
 * recurrence phrases, and any date phrase.
 */
export function parseQuickAdd(input: string, tz: string, now = Date.now(), weekStartsOn = 1): ParsedInput {
  let text = ` ${input.trim()} `;
  const out: ParsedInput = {
    title: '', due_at: null, due_has_time: false, due_text: null, due_label: null, priority: null, project: null,
    tags: [], estimate_min: null, planned_today: false, recurrence: null, column: null,
  };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    text = text.replace(re, (...args) => {
      fn(args.slice(0, -2) as unknown as RegExpExecArray);
      return ' ';
    });
  };
  take(/\s!(p[0-3]|urgent|critical|high|normal|medium|low)\b/gi, (m) => { out.priority = PRIORITY_WORDS[m[1].toLowerCase()]; });
  take(/\s#([\p{L}\p{N}_\-/.]+)/gu, (m) => { if (!out.tags.includes(m[1])) out.tags.push(m[1]); });
  take(/\s@"([^"]+)"/g, (m) => { out.project = m[1].trim(); });
  take(/\s@([\p{L}\p{N}_\-.]+)/gu, (m) => { out.project = m[1].replace(/[_-]+/g, ' ').trim(); });
  take(/\s~(\d+(?:\.\d+)?\s*(?:h|hr|hrs|m|min|mins)?(?:\d+\s*m(?:in)?)?)\b/gi, (m) => {
    try { out.estimate_min = parseEstimate(/^\d+$/.test(m[1]) ? m[1] + 'm' : m[1]); } catch {}
  });
  take(/\s\*(today|td)\b/gi, () => { out.planned_today = true; });
  take(/\s>([\p{L}\p{N}_\-]+)/gu, (m) => { out.column = m[1].replace(/[_-]+/g, ' '); });
  const rec = RECURRENCE_RE.exec(text);
  if (rec) {
    out.recurrence = parseRecurrence(rec[0]);
    text = text.slice(0, rec.index) + ' ' + text.slice(rec.index + rec[0].length);
  }
  // parseDate reports indexes into the trimmed text.
  text = text.replace(/\s+/g, ' ').trim();
  const date = parseDate(text, tz, now, weekStartsOn);
  if (date) {
    out.due_at = date.due_at;
    out.due_has_time = date.has_time;
    out.due_text = date.text;
    out.due_label = date.label;
    text = text.slice(0, date.index) + ' ' + text.slice(date.index + date.text.length);
    // Drop a dangling "by"/"on"/"due"/"at" left before the removed date.
    text = text.replace(/\s+(by|on|due|at|before|until)\s*$/i, ' ');
  }
  out.title = text.replace(/\s+/g, ' ').trim().replace(/[,;:]+$/, '').trim();
  return out;
}
