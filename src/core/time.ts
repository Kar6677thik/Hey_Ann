// Timezone-aware calendar helpers built on Intl only. A "day" is "YYYY-MM-DD" in the owner's timezone.

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    y: Number(o.year), m: Number(o.month), d: Number(o.day), h: Number(o.hour), mi: Number(o.minute), s: Number(o.second),
    wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday),
  };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of tz from UTC at instant ms, in minutes (e.g. +330 for Asia/Kolkata). */
export function tzOffsetMin(ms: number, tz: string): number {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The UTC instant of a local wall-clock time in tz. */
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, tz: string, s = 0, msec = 0): number {
  const guess = Date.UTC(y, m - 1, d, h, mi, s, msec);
  let t = guess - tzOffsetMin(guess, tz) * 60000;
  // A second pass settles DST transitions.
  t = guess - tzOffsetMin(t, tz) * 60000;
  return t;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDay(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localParts(ms: number, tz: string) {
  return parts(ms, tz);
}

export function parseDay(day: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`invalid day "${day}" (expected YYYY-MM-DD)`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function startOfDay(day: string, tz: string): number {
  const { y, m, d } = parseDay(day);
  return zonedTime(y, m, d, 0, 0, tz);
}

/** Last millisecond of the local day. */
export function endOfDay(day: string, tz: string): number {
  return startOfDay(addDays(day, 1), tz) - 1;
}

export function addDays(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMonths(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** 0 = Sunday. */
export function weekday(day: string): number {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDay(a), pb = parseDay(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 864e5);
}

export function startOfWeek(day: string, weekStartsOn: 0 | 1): string {
  const wd = weekday(day);
  return addDays(day, -((wd - weekStartsOn + 7) % 7));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Fri 21 Nov", plus the year when it isn't the current one. */
export function dayLabel(day: string, today?: string): string {
  const { y, m, d } = parseDay(day);
  const base = `${WEEKDAYS[weekday(day)]} ${d} ${MONTHS[m - 1]}`;
  return today && parseDay(today).y !== y ? `${base} ${y}` : base;
}

export function timeLabel(ms: number, tz: string): string {
  const p = parts(ms, tz);
  const h12 = p.h % 12 || 12;
  return `${h12}${p.mi ? ':' + pad(p.mi) : ''}${p.h < 12 ? 'am' : 'pm'}`;
}

/** "today", "tomorrow", "yesterday", "in 3 days", "2 days ago". */
export function relativeDay(day: string, today: string): string {
  const n = daysBetween(today, day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Human due label: "today 5pm", "Fri 21 Nov", "overdue 2 days". */
export function dueLabel(dueAt: number, hasTime: boolean, tz: string, now: number): string {
  const today = localDay(now, tz);
  const day = localDay(dueAt, tz);
  const n = daysBetween(today, day);
  const t = hasTime ? ' ' + timeLabel(dueAt, tz) : '';
  if (dueAt < now) {
    if (n === 0) return `overdue (today${t})`;
    return `overdue ${-n} day${n === -1 ? '' : 's'} (${dayLabel(day, today)})`;
  }
  if (n === 0) return `today${t}`;
  if (n === 1) return `tomorrow${t}`;
  if (n < 7) return `${dayLabel(day, today)}${t}`;
  return `${dayLabel(day, today)}${t}`;
}
