// Time helpers. "Today" always comes from the board (the owner's timezone and the server's clock),
// never from the browser's clock alone.
import { useSyncExternalStore } from 'react';

// ---- server clock: the offset between the server's `now` and ours, refreshed on each /board fetch
let offset = 0;
let tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export function syncClock(serverNow: number, timezone: string) {
  offset = serverNow - Date.now();
  tz = timezone;
}
export const nowMs = () => Date.now() + offset;
export const boardTz = () => tz;

// One shared ticker per cadence, so twenty timers don't make twenty intervals.
const tickers = new Map<number, { listeners: Set<() => void>; id: number | null; value: number }>();
function subscribeTick(ms: number) {
  return (fn: () => void) => {
    let t = tickers.get(ms);
    if (!t) {
      t = { listeners: new Set(), id: null, value: nowMs() };
      tickers.set(ms, t);
    }
    const ticker = t;
    ticker.listeners.add(fn);
    if (ticker.id === null) {
      ticker.id = window.setInterval(() => {
        ticker.value = nowMs();
        ticker.listeners.forEach((l) => l());
      }, ms);
    }
    return () => {
      ticker.listeners.delete(fn);
      if (!ticker.listeners.size && ticker.id !== null) {
        clearInterval(ticker.id);
        ticker.id = null;
      }
    };
  };
}
const subs = new Map<number, (fn: () => void) => () => void>();
/** Re-renders every `ms` with the server-adjusted clock. */
export function useNow(ms = 30_000): number {
  let sub = subs.get(ms);
  if (!sub) {
    sub = subscribeTick(ms);
    subs.set(ms, sub);
  }
  return useSyncExternalStore(sub, () => tickers.get(ms)?.value ?? nowMs());
}

// ---- calendar days ("YYYY-MM-DD" in the board timezone)
const dayFmt = new Map<string, Intl.DateTimeFormat>();
export function dayKey(ms: number, zone = tz): string {
  let f = dayFmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFmt.set(zone, f);
  }
  return f.format(ms);
}
const toUtc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export function addDays(day: string, n: number): string {
  return new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}
/** 0 = Sunday … 6 = Saturday, for a calendar day string. */
export const weekday = (day: string) => new Date(toUtc(day)).getUTCDay();
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const weekdayShort = (i: number) => WD[i];
export const monthName = (m: number) => MONTH_FULL[m];
/** "Tue 17 Nov" */
export function fmtDay(day: string, withYear = false): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${WD[weekday(day)]} ${d} ${MON[m - 1]}${withYear ? ` ${y}` : ''}`;
}
/** "17 Nov" */
export function fmtDayShort(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MON[m - 1]}`;
}

// ---- clock times
const partsFmt = new Map<string, Intl.DateTimeFormat>();
function hm(ms: number, zone = tz) {
  let f = partsFmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
    partsFmt.set(zone, f);
  }
  const p = f.formatToParts(ms);
  return { h: Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24, m: Number(p.find((x) => x.type === 'minute')?.value ?? 0) };
}
/** "6pm", "5:30pm" */
export function fmtClock(ms: number, zone = tz): string {
  const { h, m } = hm(ms, zone);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}
/** "18:05" for logs and stamps */
export function fmtClock24(ms: number, zone = tz): string {
  const { h, m } = hm(ms, zone);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** "HH:mm" in the board timezone, for re-sending a time with a new date. */
export const clockHHmm = fmtClock24;

/** "Tue 17 Nov, 6pm" */
export function fmtDateTime(ms: number, hasTime = true): string {
  const day = fmtDay(dayKey(ms));
  return hasTime ? `${day}, ${fmtClock(ms)}` : day;
}

// ---- durations
/** 45 → "45m", 90 → "1h 30m", 120 → "2h" */
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
/** Elapsed ms as "12:04" or "1:02:33" */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
/** Hours as "16h" or "2.9d" (cycle and lead times) */
export function fmtHours(h: number | null): string {
  if (h === null || h === undefined) return '—';
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** "just now", "4m ago", "3h ago", "Yesterday", "Mon", "12 Nov" */
export function fmtAgo(ms: number, now = nowMs()): string {
  const d = now - ms;
  if (d < 45_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  const today = dayKey(now);
  const day = dayKey(ms);
  if (day === today) return `${Math.round(d / 3_600_000)}h ago`;
  const days = diffDays(today, day);
  if (days === 1) return 'Yesterday';
  if (days < 7) return WD[weekday(day)];
  return fmtDayShort(day);
}

// ---- due dates
export type DueTone = 'overdue' | 'today' | 'soon' | 'later';
export interface DueInfo {
  tone: DueTone;
  /** Compact relative label: "2d overdue", "Today 6pm", "Tomorrow", "Fri", "28 Nov" */
  label: string;
  /** Full: "Tue 17 Nov, 6pm" */
  full: string;
  day: string;
}
export function dueInfo(due_at: number, hasTime: boolean, today: string, now = nowMs()): DueInfo {
  const day = dayKey(due_at);
  const delta = diffDays(day, today);
  const time = hasTime ? ` ${fmtClock(due_at)}` : '';
  const full = fmtDateTime(due_at, hasTime);
  const overdue = hasTime ? due_at < now : delta < 0;
  if (overdue) {
    const late = delta < 0 ? `${-delta}d overdue` : `Overdue${time}`;
    return { tone: 'overdue', label: late, full, day };
  }
  if (delta === 0) return { tone: 'today', label: `Today${time}`, full, day };
  if (delta === 1) return { tone: 'soon', label: `Tomorrow${time}`, full, day };
  if (delta < 7) return { tone: 'soon', label: `${WD[weekday(day)]}${time}`, full, day };
  return { tone: 'later', label: fmtDayShort(day), full, day };
}

/** Days of a month view: whole weeks covering the month, starting on the board's week start. */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1): string[] {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lead = (weekday(first) - weekStartsOn + 7) % 7;
  const start = addDays(first, -lead);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}
