// The screen-minute wallet (docs/REWARDS.md). One append-only ledger; balance = SUM(amount).
// Earning: verified focus minutes on cards that reach Done. Penalties: missed plans, overdue P0/P1, snoozing overdue
// work, emergency unlocks, protection gaps. Everything is capped so a bad day can't spiral.
// The ledger lives outside board undo: undoing a card triggers reconcile(), which posts the difference.
import type { Board } from './board.ts';
import { BoardError } from './board.ts';
import type { Batch, Card } from './types.ts';
import { addDays, daysBetween, endOfDay, localDay, startOfDay, startOfWeek, weekday } from './time.ts';

/** A Socrates study event after schema validation (src/server/rewards.ts). */
export type StudyEventIn = { event_id: string; day: string; occurred_at: number; baseline?: boolean } & (
  | { kind: 'study_minutes'; minutes: number; intervals: [number, number][]; session_id: number; attempts_credited: number; pending: number; supplement?: boolean }
  | { kind: 'mastery_up'; tag: { id: number; path: string; title: string }; threshold: number }
);

export interface Rules {
  version: number;
  /** Screen minutes per focused minute. */
  rate: number;
  /** Multiplier by locked priority P0..P3. */
  priority_mult: [number, number, number, number];
  on_time_mult: number;
  /** Due date must have been set this many hours before completion to count as "on time". */
  on_time_notice_h: number;
  bonus: number;
  bonus_min_focus: number;
  bonus_per_day: number;
  /** Focus minutes counted per session at most (a forgotten timer earns nothing extra). */
  session_cap_min: number;
  daily_earn_cap: number;
  /** Of daily_earn_cap, at most this much from Socrates study minutes (per Socrates study day). */
  study_day_cap: number;
  allowance: number;
  plan_deadline: string;
  missed_plan_penalty: number;
  missed_plan_focus_min: number;
  overdue_per_day: number;
  overdue_card_cap: number;
  snooze_penalty: number;
  emergency_cost: number;
  emergency_minutes: number;
  emergency_per_week: number;
  tamper_penalty: number;
  tamper_gap_min: number;
  /** Unpaid minutes in walled apps forgiven per day (bounces, accidental opens). */
  tab_grace_min: number;
  /** Unpaid use is charged down to this balance at most. */
  tab_floor: number;
  /** A paired phone silent this long gets silent_penalty once a day until it reports again. */
  silent_hours: number;
  silent_penalty: number;
  penalty_day_cap: number;
  penalty_week_cap: number;
  balance_cap: number;
  expiry_days: number;
  debt_floor: number;
  repay_mult: number;
  debt_pause_days: number;
  back_reward: number;
  back_per_day: number;
  unlock_max: number;
  pause_allowance: number;
  pause_per_month: number;
  ann_grant_day: number;
  ann_fine_day: number;
  veto_threshold: number;
  veto_hours: number;
  baseline_days: number;
  /** Android package names that are walled. Everything else (calls, maps, banking...) is never touched. */
  walled_apps: string[];
}

export const DEFAULT_RULES: Rules = {
  version: 1,
  rate: 0.25,
  priority_mult: [1.5, 1.25, 1, 0.75],
  on_time_mult: 1.2,
  on_time_notice_h: 48,
  bonus: 3,
  bonus_min_focus: 25,
  bonus_per_day: 3,
  session_cap_min: 90,
  daily_earn_cap: 60,
  study_day_cap: 30,
  allowance: 10,
  plan_deadline: '11:00',
  missed_plan_penalty: 10,
  missed_plan_focus_min: 60,
  overdue_per_day: 5,
  overdue_card_cap: 15,
  snooze_penalty: 5,
  emergency_cost: 30,
  emergency_minutes: 15,
  emergency_per_week: 2,
  tamper_penalty: 30,
  tamper_gap_min: 15,
  tab_grace_min: 3,
  tab_floor: -300,
  silent_hours: 48,
  silent_penalty: 30,
  penalty_day_cap: 30,
  penalty_week_cap: 100,
  balance_cap: 180,
  expiry_days: 7,
  debt_floor: -60,
  repay_mult: 1.5,
  debt_pause_days: 3,
  back_reward: 1,
  back_per_day: 5,
  unlock_max: 20,
  pause_allowance: 30,
  pause_per_month: 7,
  ann_grant_day: 15,
  ann_fine_day: 20,
  veto_threshold: 5,
  veto_hours: 24,
  baseline_days: 7,
  walled_apps: [
    'com.instagram.android', 'com.google.android.youtube', 'com.zhiliaoapp.musically', 'com.twitter.android',
    'com.reddit.frontpage', 'com.snapchat.android', 'com.facebook.katana', 'com.netflix.mediaclient',
  ],
};

/** Rule fields the owner may change (with a delay); numbers are bounded so a typo can't break the economy. */
const BOUNDS: Partial<Record<keyof Rules, [number, number]>> = {
  rate: [0.05, 1], on_time_mult: [1, 2], bonus: [0, 20], bonus_min_focus: [5, 120], bonus_per_day: [0, 10], session_cap_min: [25, 240],
  daily_earn_cap: [10, 240], study_day_cap: [0, 120], allowance: [0, 60], missed_plan_penalty: [0, 60], missed_plan_focus_min: [0, 240], overdue_per_day: [0, 30],
  overdue_card_cap: [0, 120], snooze_penalty: [0, 30], emergency_cost: [5, 120], emergency_minutes: [5, 60], emergency_per_week: [0, 7],
  tamper_penalty: [0, 120], tamper_gap_min: [5, 240], tab_grace_min: [0, 30], tab_floor: [-600, 0], silent_hours: [12, 168], silent_penalty: [0, 120], penalty_day_cap: [0, 120], penalty_week_cap: [0, 500], balance_cap: [30, 600],
  expiry_days: [1, 30], debt_floor: [-300, 0], repay_mult: [1, 3], debt_pause_days: [1, 14], back_reward: [0, 5], back_per_day: [0, 20],
  unlock_max: [5, 60], pause_allowance: [0, 120], pause_per_month: [0, 14], ann_grant_day: [0, 60], ann_fine_day: [0, 60],
  veto_threshold: [0, 60], veto_hours: [1, 72], baseline_days: [0, 14], on_time_notice_h: [0, 168],
};

export type Phase = 'off' | 'baseline' | 'active';
type Source = 'system' | 'web' | 'ann' | 'phone' | 'socrates';

interface State {
  rules: Rules;
  pending: { rules: Rules; effective: string } | null;
  started: string | null;
  baseline_until: string | null;
  last_closed: string | null;
  /** First day the tab (unpaid use) is charged: the day after the feature first ran. */
  tab_from?: string;
}

export interface LedgerRow {
  id: number; at: number; amount: number; kind: string; reason: string; card_id: number | null; source: Source; rule_version: number; dedupe: string | null;
}

const EARN_KINDS = ['earn', 'bonus', 'clawback'];
const PENALTY_KINDS = ['forfeit', 'penalty'];
const CREDIT_KINDS = ['earn', 'bonus', 'study', 'mastery', 'allowance', 'grant', 'pause', 'back'];
/** Earnings: they share the daily cap and repay debt at repay_mult. */
const EARNINGS = ['earn', 'bonus', 'study', 'mastery'];
const EARNINGS_SQL = EARNINGS.map((k) => `'${k}'`).join(',');

export class Wallet {
  private board: Board;
  constructor(board: Board) {
    this.board = board;
    board.afterCommit.push((b) => this.onBatch(b));
  }

  private get db() { return this.board.db; }
  private get tz() { return this.board.tz; }

  // ------------------------------------------------------------------ state & rules

  private state(): State {
    const s = this.board.meta<State | null>('wallet', null);
    return s ?? { rules: DEFAULT_RULES, pending: null, started: null, baseline_until: null, last_closed: null };
  }

  private save(s: State) {
    this.board.setMeta('wallet', s);
  }

  /** Current rules; a pending change is promoted once its effective day arrives. */
  rules(now = Date.now()): Rules {
    const s = this.state();
    if (s.pending && s.pending.effective <= localDay(now, this.tz)) {
      s.rules = s.pending.rules;
      s.pending = null;
      this.save(s);
    }
    return { ...DEFAULT_RULES, ...s.rules };
  }

  phase(now = Date.now()): Phase {
    const s = this.state();
    if (!s.started) return 'off';
    return s.baseline_until && localDay(now, this.tz) < s.baseline_until ? 'baseline' : 'active';
  }

  start(opts: { baseline?: boolean } = {}, now = Date.now()) {
    const s = this.state();
    if (s.started) throw new BoardError('the wallet is already running', 409);
    const today = localDay(now, this.tz);
    s.started = today;
    s.baseline_until = opts.baseline === false ? null : addDays(today, this.rules(now).baseline_days);
    s.last_closed = addDays(today, -1);
    this.save(s);
    this.tick(now);
    return this.summary(now);
  }

  /**
   * End the baseline week early: the wall goes up at the start of `day` (today or later, default tomorrow). The phone
   * usage already reported is the baseline. Can only move the date earlier, never push the wall back.
   */
  endBaseline(day?: string, now = Date.now()) {
    const s = this.state();
    if (this.phase(now) !== 'baseline' || !s.baseline_until) throw new BoardError('the wallet is not in its baseline week', 409);
    const today = localDay(now, this.tz);
    const target = day ?? addDays(today, 1);
    if (target < today) throw new BoardError('the wall can start today at the earliest');
    if (target >= s.baseline_until) throw new BoardError(`the baseline already ends ${s.baseline_until}; this can only bring it forward`);
    s.baseline_until = target;
    this.save(s);
    this.tick(now);
    return this.summary(now);
  }

  /**
   * Change rules. While off or in the baseline week: immediate. Once active: loosening waits until next Monday
   * (no impulsive escape hatch); walling more apps applies at once.
   */
  setRules(patch: Partial<Rules>, now = Date.now()): { effective: string; rules: Rules } {
    const cur = this.rules(now);
    const next: Rules = { ...(this.state().pending?.rules ?? cur) };
    for (const [k, v] of Object.entries(patch) as [keyof Rules, any][]) {
      if (k === 'version') continue;
      if (k === 'walled_apps') {
        if (!Array.isArray(v) || v.some((p) => typeof p !== 'string' || !/^[a-zA-Z][\w]*(\.[\w]+)+$/.test(p))) throw new BoardError('walled_apps must be Android package names like com.instagram.android');
        next.walled_apps = [...new Set(v as string[])];
        continue;
      }
      if (k === 'priority_mult') {
        if (!Array.isArray(v) || v.length !== 4 || v.some((x) => typeof x !== 'number' || x < 0 || x > 3)) throw new BoardError('priority_mult must be four numbers 0-3');
        next.priority_mult = v as Rules['priority_mult'];
        continue;
      }
      if (k === 'plan_deadline') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw new BoardError('plan_deadline must be HH:MM');
        next.plan_deadline = v;
        continue;
      }
      const b = BOUNDS[k];
      if (!b) throw new BoardError(`unknown rule "${k}"`);
      if (typeof v !== 'number' || Number.isNaN(v) || v < b[0] || v > b[1]) throw new BoardError(`${k} must be between ${b[0]} and ${b[1]}`);
      (next as any)[k] = v;
    }
    next.version = cur.version + 1;
    const s = this.state();
    const today = localDay(now, this.tz);
    if (this.phase(now) !== 'active') {
      s.rules = next;
      s.pending = null;
      this.save(s);
      return { effective: today, rules: next };
    }
    // Walling extra apps is stricter: apply it now, keep everything else pending.
    const added = next.walled_apps.filter((a) => !cur.walled_apps.includes(a));
    if (added.length) s.rules = { ...cur, walled_apps: [...cur.walled_apps, ...added] };
    const effective = addDays(startOfWeek(today, 1), 7);
    s.pending = { rules: next, effective };
    this.save(s);
    return { effective, rules: next };
  }

  /**
   * Wall or unwall apps right away, skipping the Monday wait (Ann's call, made on the owner's behalf).
   * Any pending rule change keeps the same app list so it doesn't undo this when it lands.
   * Logged as a zero-minute ledger row so the owner sees who changed what and why.
   */
  setWalled(change: { wall?: string[]; unwall?: string[] }, reason: string, by: Source = 'ann', now = Date.now()): { walled: string[]; added: string[]; removed: string[] } {
    const pkg = /^[a-zA-Z][\w]*(\.[\w]+)+$/;
    const wall = [...new Set(change.wall ?? [])], unwall = [...new Set(change.unwall ?? [])];
    const bad = [...wall, ...unwall].find((p) => !pkg.test(p));
    if (bad) throw new BoardError(`"${bad}" is not an Android package name (like com.instagram.android)`);
    if (wall.some((p) => unwall.includes(p))) throw new BoardError('an app cannot be walled and unwalled at once');
    const cur = this.rules(now).walled_apps;
    const added = wall.filter((p) => !cur.includes(p));
    const removed = unwall.filter((p) => cur.includes(p));
    if (!added.length && !removed.length) return { walled: cur, added, removed };
    const walled = [...cur.filter((p) => !removed.includes(p)), ...added];
    const s = this.state();
    s.rules = { ...DEFAULT_RULES, ...s.rules, walled_apps: walled };
    if (s.pending) s.pending.rules = { ...s.pending.rules, walled_apps: walled };
    this.save(s);
    const what = [added.length ? `walled ${added.join(', ')}` : '', removed.length ? `unwalled ${removed.join(', ')}` : ''].filter(Boolean).join('; ');
    this.insert(0, 'wall', `${what[0].toUpperCase()}${what.slice(1)}: ${reason.trim().slice(0, 200)}`, { source: by, now });
    return { walled, added, removed };
  }

  // ------------------------------------------------------------------ ledger primitives

  balance(): number {
    return (this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM ledger').get() as { b: number }).b;
  }

  private sum(where: string, ...params: any[]): number {
    return (this.db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE ${where}`).get(...params) as { s: number }).s;
  }

  private insert(amount: number, kind: string, reason: string, opts: { card?: number | null; source?: Source; dedupe?: string; now?: number } = {}): LedgerRow | null {
    if (opts.dedupe && this.db.prepare('SELECT 1 FROM ledger WHERE dedupe = ?').get(opts.dedupe)) return null;
    const at = opts.now ?? Date.now();
    const r = this.db.prepare('INSERT INTO ledger(at, amount, kind, reason, card_id, source, rule_version, dedupe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(at, Math.round(amount), kind, reason.slice(0, 300), opts.card ?? null, opts.source ?? 'system', this.rules(at).version, opts.dedupe ?? null);
    const row = this.db.prepare('SELECT * FROM ledger WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as LedgerRow;
    queueMicrotask(() => this.board.events.emit('wallet', { type: 'wallet', entry: row, balance: this.balance() }));
    return row;
  }

  private dayBounds(now: number) {
    const today = localDay(now, this.tz);
    return { today, start: startOfDay(today, this.tz), end: endOfDay(today, this.tz) };
  }

  /**
   * Add screen minutes. Earnings (earn/bonus) count toward the daily cap and repay debt at repay_mult.
   * Nothing lifts the balance above balance_cap. Returns what was actually credited.
   */
  private credit(amount: number, kind: string, reason: string, opts: { card?: number | null; source?: Source; dedupe?: string; now?: number } = {}): number {
    if (amount <= 0) return 0;
    const now = opts.now ?? Date.now();
    const r = this.rules(now);
    let a = amount;
    if (EARNINGS.includes(kind)) {
      const { start } = this.dayBounds(now);
      const earnedToday = this.sum(`kind IN (${EARNINGS_SQL}) AND amount > 0 AND at >= ?`, start);
      a = Math.min(a, Math.max(r.daily_earn_cap - earnedToday, 0));
      const bal = this.balance();
      if (bal < 0 && a > 0) {
        // Debt is repaid faster: each earned minute counts repay_mult until the debt is cleared.
        const boosted = a * r.repay_mult;
        a = boosted <= -bal ? boosted : -bal + (a - -bal / r.repay_mult);
      }
    }
    a = Math.min(Math.round(a), Math.max(r.balance_cap - this.balance(), 0));
    if (a <= 0) return 0;
    return this.insert(a, kind, reason, opts) ? a : 0;
  }

  /** Card bonuses and Socrates mastery awards share one daily limit (bonus_per_day). */
  private bonusesToday(start: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind IN ('bonus','mastery') AND amount > 0 AND at >= ?").get(start) as { n: number }).n;
  }

  /**
   * Apply a study event Socrates pushed (signature already checked by the caller), exactly once per event_id.
   * Every accepted event leaves a ledger row, even when it pays 0, so the dedupe is permanent and the owner sees why.
   *
   * study_minutes: minutes overlapping a focus timer or a phone session are voided (by the voided share of its
   * intervals), then the day's study is priced as a whole: floor(rate x minutes) up to study_day_cap per Socrates day,
   * minus what earlier events of that day already used. The daily earn cap, debt repayment and the balance cap then
   * apply as for focus earnings.
   * mastery_up: +bonus, within the shared bonus_per_day limit.
   */
  applyStudyEvent(e: StudyEventIn, now = Date.now()): { status: 'applied' | 'duplicate'; credited: number; note: string } {
    if (this.db.prepare('SELECT 1 FROM ledger WHERE dedupe = ?').get(e.event_id)) return { status: 'duplicate', credited: 0, note: 'already applied' };
    const r = this.rules(now);
    let minutes = 0, base = 0, note = '';
    if (e.kind === 'study_minutes') {
      const total = e.intervals.reduce((n, [a, b]) => n + (b - a), 0);
      const kept = total ? total - this.overlapMs(e.intervals, now) : 0;
      minutes = total ? e.minutes * (kept / total) : 0;
      if (kept < total) note = `${Math.round((total - kept) / 60000)} min overlapped focus or phone use`;
      const day = this.db.prepare("SELECT COALESCE(SUM(minutes), 0) AS m, COALESCE(SUM(base), 0) AS b FROM study_events WHERE kind = 'study_minutes' AND day = ?").get(e.day) as { m: number; b: number };
      const target = Math.min(r.study_day_cap, Math.floor((day.m + minutes) * r.rate + 1e-9));
      base = Math.max(target - day.b, 0);
      if (!base && day.b >= r.study_day_cap) note ||= `study limit (${r.study_day_cap}/day) reached`;
    } else {
      const { start } = this.dayBounds(now);
      if (this.bonusesToday(start) < r.bonus_per_day) base = r.bonus;
      else note = `bonus limit (${r.bonus_per_day}/day) reached`;
    }
    if (e.baseline) { base = 0; minutes = 0; note = 'reached before rewards started'; }
    if (this.phase(now) === 'off') { base = 0; minutes = 0; note = 'wallet off'; }
    const kind = e.kind === 'study_minutes' ? 'study' : 'mastery';
    const what = e.kind === 'study_minutes'
      ? `${Math.round(e.minutes * 10) / 10} min of study in Socrates (${e.day}${e.supplement ? ', late grading' : ''})`
      : `Mastery ${e.threshold}% in ${e.tag.title}`;
    let credited = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (base > 0) credited = this.credit(base, kind, what, { source: 'socrates', dedupe: e.event_id, now });
      if (!credited) {
        if (base > 0) note ||= 'daily earn cap or balance cap reached';
        this.insert(0, kind, `${what}: ${note || 'nothing to pay'}`, { source: 'socrates', dedupe: e.event_id, now });
      }
      this.db.prepare('INSERT INTO study_events(event_id, kind, day, received_at, minutes, base, credited, note, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(e.event_id, e.kind, e.day, now, minutes, base, credited, note || null, JSON.stringify(e));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { status: 'applied', credited, note };
  }

  /** Milliseconds of these intervals covered by focus timers (logged or running) or phone sessions. */
  private overlapMs(intervals: [number, number][], now: number): number {
    const lo = Math.min(...intervals.map((i) => i[0])), hi = Math.max(...intervals.map((i) => i[1]));
    const busy = [
      ...(this.db.prepare('SELECT started_at AS a, ended_at AS b FROM focus_log WHERE ended_at > ? AND started_at < ?').all(lo, hi) as { a: number; b: number }[]),
      ...(this.db.prepare('SELECT focus_started_at AS a, ? AS b FROM cards WHERE focus_started_at IS NOT NULL AND focus_started_at < ?').all(now, hi) as { a: number; b: number }[]),
      ...(this.db.prepare('SELECT started_at AS a, COALESCE(stopped_at, ends_at) AS b FROM phone_sessions WHERE COALESCE(stopped_at, ends_at) > ? AND started_at < ?').all(lo, hi) as { a: number; b: number }[]),
    ].sort((x, y) => x.a - y.a);
    const merged: [number, number][] = [];
    for (const { a, b } of busy) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    let ms = 0;
    for (const [s, t] of intervals) for (const [a, b] of merged) ms += Math.max(0, Math.min(t, b) - Math.max(s, a));
    return ms;
  }

  /**
   * The tab: every minute in a walled app that no paid session covered is charged, from the phone's own usage
   * reports. Pausing protection, switching off Tailscale or the accessibility service doesn't make use free; it only
   * delays the bill until the phone reports again (it sends its last 7 days). Spending, not a penalty: no penalty caps,
   * but never below tab_floor. Charged as the difference against what this day already paid, so re-reports are safe.
   * Starts the day after it first runs (nothing retroactive), and only on active days.
   */
  billTab(day: string, now = Date.now()): number {
    const s = this.state();
    if (this.phase(now) !== 'active') return 0;
    const today = localDay(now, this.tz);
    if (!s.tab_from) { this.save({ ...s, tab_from: addDays(today, 1) }); return 0; }
    if (day < s.tab_from || day > today || (s.baseline_until && day < s.baseline_until)) return 0;
    const r = this.rules(now);
    if (!r.walled_apps.length) return 0;
    const used = this.db.prepare(`SELECT app, minutes FROM phone_usage WHERE day = ? AND app IN (${r.walled_apps.map(() => '?').join(',')}) AND minutes > 0 ORDER BY minutes DESC`)
      .all(day, ...r.walled_apps) as { app: string; minutes: number }[];
    const total = used.reduce((n, u) => n + u.minutes, 0);
    const from = startOfDay(day, this.tz), to = endOfDay(day, this.tz);
    const paidMs = (this.db.prepare(`SELECT COALESCE(SUM(MAX(0, MIN(COALESCE(MIN(stopped_at, ends_at), ends_at), ?) - MAX(started_at, ?))), 0) AS ms
      FROM phone_sessions WHERE started_at < ? AND COALESCE(stopped_at, ends_at) > ?`).get(to, from, to, from) as { ms: number }).ms;
    const unpaid = Math.max(0, total - Math.ceil(paidMs / 60000) - r.tab_grace_min);
    const charged = -this.sum("kind = 'tab' AND dedupe LIKE ?", `tab:${day}:%`);
    const due = Math.min(unpaid - charged, this.balance() - r.tab_floor);
    if (due <= 0) return 0;
    const apps = used.slice(0, 3).map((u) => u.app).join(', ');
    const row = this.insert(-due, 'tab', `${unpaid} min in walled apps without a session on ${day} (${apps})`, { source: 'phone', dedupe: `tab:${day}:${charged + due}`, now });
    return row ? -due : 0;
  }

  /** A paired phone with no usage report for silent_hours (offline, Usage access revoked, uninstalled): one lapse a day until it reports. */
  private checkSilence(now: number) {
    const r = this.rules(now);
    const today = localDay(now, this.tz);
    const devices = this.db.prepare('SELECT id, name, COALESCE(last_usage, last_seen) AS at FROM devices WHERE revoked_at IS NULL AND COALESCE(last_usage, last_seen) IS NOT NULL').all() as { id: number; name: string; at: number }[];
    for (const d of devices) {
      const h = (now - d.at) / 3600_000;
      if (h >= r.silent_hours)
        this.penalize(r.silent_penalty, 'penalty', `${d.name} hasn't sent a usage report for ${Math.floor(h)} h`, { dedupe: `silent:${d.id}:${today}`, now });
    }
  }

  /** Days in a row (ending yesterday) that closed in debt. */
  private debtStreak(now: number): number {
    const rows = this.db.prepare('SELECT day, closing FROM wallet_days WHERE day < ? ORDER BY day DESC LIMIT 14').all(localDay(now, this.tz)) as { day: string; closing: number }[];
    let n = 0;
    for (const r of rows) { if (r.closing < 0) n++; else break; }
    return n;
  }

  isPaused(day: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM pause_days WHERE day = ?').get(day);
  }

  /**
   * A rule penalty (forfeit/penalty). Skipped outside the active phase, on pause days, and while a debt streak has
   * paused penalties. Capped per day and week, and never below the debt floor. Returns the amount taken (≤ 0).
   */
  private penalize(amount: number, kind: 'forfeit' | 'penalty', reason: string, opts: { card?: number | null; dedupe?: string; now?: number; day?: string } = {}): number {
    const now = opts.now ?? Date.now();
    const r = this.rules(now);
    const day = opts.day ?? localDay(now, this.tz);
    if (this.phase(now) !== 'active' || this.isPaused(day)) return 0;
    const bal = this.balance();
    if (bal < 0 && this.debtStreak(now) >= r.debt_pause_days) return 0;
    const dayStart = startOfDay(day, this.tz);
    const today = -this.sum(`kind IN ('forfeit','penalty') AND at >= ? AND at <= ?`, dayStart, endOfDay(day, this.tz));
    const week = -this.sum(`kind IN ('forfeit','penalty') AND at >= ?`, startOfDay(startOfWeek(day, 1), this.tz));
    let a = Math.min(amount, r.penalty_day_cap - today, r.penalty_week_cap - week, bal - r.debt_floor);
    a = Math.round(a);
    if (a <= 0) return 0;
    return this.insert(-a, kind, reason, { ...opts, now }) ? -a : 0;
  }

  // ------------------------------------------------------------------ earning

  /** Focus minutes on a card that count: per-session cap, minus any overlap with phone sessions. */
  focusMinutes(cardId: number): number {
    const r = this.rules();
    const logs = this.db.prepare('SELECT started_at, ended_at, minutes FROM focus_log WHERE card_id = ?').all(cardId) as { started_at: number; ended_at: number; minutes: number }[];
    if (!logs.length) return 0;
    const lo = Math.min(...logs.map((l) => l.started_at)), hi = Math.max(...logs.map((l) => l.ended_at));
    const phone = this.db.prepare('SELECT started_at, MIN(ends_at, COALESCE(stopped_at, ends_at)) AS e FROM phone_sessions WHERE started_at < ? AND ends_at > ?').all(hi, lo) as { started_at: number; e: number }[];
    let total = 0;
    for (const l of logs) {
      let overlap = 0;
      for (const p of phone) overlap += Math.max(0, Math.min(l.ended_at, p.e) - Math.max(l.started_at, p.started_at));
      total += Math.max(0, Math.min(l.minutes, r.session_cap_min) - Math.round(overlap / 60000));
    }
    return total;
  }

  /** When the card's current due date was set (the batch that last changed it, else creation). */
  private dueSetAt(card: Card): number {
    const rows = this.db.prepare(`SELECT b.at, c.before, c.after FROM changes c JOIN batches b ON b.id = c.batch_id
      WHERE c.entity = 'card' AND c.entity_id = ? ORDER BY c.id DESC LIMIT 200`).all(String(card.id)) as { at: number; before: string | null; after: string | null }[];
    for (const r of rows) {
      const b = r.before ? JSON.parse(r.before).due_at : undefined;
      const a = r.after ? JSON.parse(r.after).due_at : undefined;
      if (b !== a) return r.at;
    }
    return card.created_at;
  }

  /** What a card should have earned, nominally (before daily caps). */
  expected(card: Card, now = Date.now()): { base: number; bonus: number; focus: number } {
    const r = this.rules(now);
    const done = !card.archived_at && this.board.kindOf(card.column_id) === 'done' && !card.credit_pending;
    if (!done || this.phase(now) === 'off') return { base: 0, bonus: 0, focus: 0 };
    const focus = this.focusMinutes(card.id);
    const p = r.priority_mult[card.credit_priority ?? card.priority] ?? 1;
    const onTime = card.due_at !== null && card.completed_at !== null && card.completed_at <= card.due_at
      && card.completed_at - this.dueSetAt(card) >= r.on_time_notice_h * 3600_000;
    const base = Math.round(focus * r.rate * p * (onTime ? r.on_time_mult : 1));
    let bonus = 0;
    if (focus >= r.bonus_min_focus) {
      const prior = this.db.prepare('SELECT bonus FROM card_credit WHERE card_id = ?').get(card.id) as { bonus: number } | undefined;
      if (prior && prior.bonus > 0) bonus = prior.bonus;
      else {
        const { start } = this.dayBounds(now);
        if (this.bonusesToday(start) < r.bonus_per_day) bonus = r.bonus;
      }
    }
    return { base, bonus, focus };
  }

  /** Bring a card's credit in line with its current state: pay the difference, or claw it back. */
  reconcile(cardId: number, now = Date.now()) {
    const card = this.board.card(cardId);
    const acc = (this.db.prepare('SELECT base, bonus FROM card_credit WHERE card_id = ?').get(cardId) as { base: number; bonus: number } | undefined) ?? { base: 0, bonus: 0 };
    const exp = card ? this.expected(card, now) : { base: 0, bonus: 0, focus: 0 };
    if (exp.base === acc.base && exp.bonus === acc.bonus) return;
    const title = card ? `"${card.title}"` : `#${cardId}`;
    const paid = this.sum('card_id = ? AND kind IN (\'earn\',\'bonus\',\'clawback\')', cardId);
    const dBase = exp.base - acc.base, dBonus = exp.bonus - acc.bonus;
    if (dBase > 0) this.credit(dBase, 'earn', `${exp.focus} focus min on ${title}`, { card: cardId, now });
    if (dBonus > 0) this.credit(dBonus, 'bonus', `Finished ${title}`, { card: cardId, now });
    const down = -(Math.min(dBase, 0) + Math.min(dBonus, 0));
    if (down > 0) {
      // Never claw back more than the card actually paid (caps may have trimmed it).
      const take = Math.min(down, Math.max(paid, 0));
      if (take > 0) this.insert(-take, 'clawback', `${title} is no longer done (or lost focus time)`, { card: cardId, now });
    }
    this.db.prepare('INSERT INTO card_credit(card_id, base, bonus) VALUES (?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET base = excluded.base, bonus = excluded.bonus').run(cardId, exp.base, exp.bonus);
  }

  /** After every board change: reconcile touched cards; charge for snoozing overdue P0/P1 work. */
  private onBatch(batch: Batch) {
    if (this.phase(batch.at) === 'off') return;
    const r = this.rules(batch.at);
    const ids = new Set<number>();
    for (const c of batch.changes) {
      if (c.entity !== 'card') continue;
      ids.add(Number(c.entity_id));
      const b = c.before as Card | null, a = c.after as Card | null;
      if (batch.undoes || !b || !a || b.due_at === null || a.due_at === null) continue;
      if (b.due_at < batch.at && a.due_at > b.due_at && (a.credit_priority ?? a.priority) <= 1 && this.board.kindOf(a.column_id) !== 'done')
        this.penalize(r.snooze_penalty, 'penalty', `Pushed back overdue "${a.title}"`, { card: a.id, dedupe: `snooze:${a.id}:${batch.id}`, now: batch.at });
    }
    for (const id of ids) this.reconcile(id, batch.at);
  }

  /** The owner confirms (or declines) credit for a card Ann completed. */
  confirmCredit(cardId: number, accept: boolean) {
    const card = this.board.mustCard(cardId);
    if (!card.credit_pending) throw new BoardError(`"${card.title}" has no pending credit`, 409);
    this.db.prepare('UPDATE cards SET credit_pending = ? WHERE id = ?').run(accept ? 0 : 2, cardId);
    if (accept) this.reconcile(cardId);
    return this.board.mustCard(cardId);
  }

  pendingCards(): Card[] {
    return this.board.openCards().filter((c) => c.credit_pending && this.board.kindOf(c.column_id) === 'done');
  }

  // ------------------------------------------------------------------ the daily clock

  /** Idempotent: post today's allowance and the no-plan forfeit, and close every finished day. Call often. */
  tick(now = Date.now()) {
    if (this.phase(now) === 'off') return;
    const s = this.state();
    const r = this.rules(now);
    const today = localDay(now, this.tz);
    let day = s.last_closed ? addDays(s.last_closed, 1) : s.started!;
    if (daysBetween(day, today) > 14) day = addDays(today, -14);
    for (; day < today; day = addDays(day, 1)) this.closeDay(day, now);
    s.last_closed = addDays(today, -1);
    this.save({ ...this.state(), last_closed: s.last_closed });

    if (this.phase(now) !== 'active') return;
    this.checkSilence(now);
    if (!this.state().tab_from) this.billTab(today, now);
    const paused = this.isPaused(today);
    if (paused) this.credit(r.pause_allowance, 'pause', 'Pause day allowance', { dedupe: `allow:${today}`, now });
    else this.credit(r.allowance, 'allowance', 'Daily allowance (yours to lose)', { dedupe: `allow:${today}`, now });
    const wd = weekday(today);
    const [h, m] = r.plan_deadline.split(':').map(Number);
    const deadline = startOfDay(today, this.tz) + (h * 60 + m) * 60000;
    // The day the wall goes up is a grace day for planning.
    const firstActive = (this.state().baseline_until ?? this.state().started) === today;
    if (!paused && !firstActive && wd >= 1 && wd <= 5 && now >= deadline && !this.plannedFor(today).length && this.got(`allow:${today}`))
      this.penalize(r.allowance, 'forfeit', `No plan for today by ${r.plan_deadline}`, { dedupe: `noplan:${today}`, now });
  }

  private got(dedupe: string) {
    return !!this.db.prepare('SELECT 1 FROM ledger WHERE dedupe = ?').get(dedupe);
  }

  private plannedFor(day: string): Card[] {
    return this.board.openCards().filter((c) => c.planned_for === day);
  }

  private closeDay(day: string, now: number) {
    const r = this.rules(now);
    const s = this.state();
    if (s.started && day < s.started) return;
    const start = startOfDay(day, this.tz), end = endOfDay(day, this.tz);
    const wd = weekday(day);
    const weekday_ = wd >= 1 && wd <= 5;
    // Missed plan (weekdays): planned something, finished none of it, and focused less than the threshold.
    const planned = this.plannedFor(day);
    if (weekday_ && planned.length && !this.got(`noplan:${day}`)) {
      const finished = planned.some((c) => c.completed_at !== null && c.completed_at >= start && c.completed_at <= end);
      const focus = (this.db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM focus_log WHERE ended_at BETWEEN ? AND ?').get(start, end) as { m: number }).m;
      if (!finished && focus < r.missed_plan_focus_min) {
        if (this.got(`allow:${day}`)) this.penalize(r.allowance, 'forfeit', `Missed plan on ${day}: allowance lost`, { dedupe: `missed-forfeit:${day}`, now, day });
        this.penalize(r.missed_plan_penalty, 'penalty', `Missed plan on ${day}`, { dedupe: `missed:${day}`, now, day });
      }
    }
    // Overdue urgent/high cards (weekdays only), capped per card.
    if (weekday_) {
      for (const c of this.board.openCards()) {
        if (c.due_at === null || c.due_at >= end || (c.credit_priority ?? c.priority) > 1 || this.board.kindOf(c.column_id) === 'done') continue;
        if (c.completed_at !== null) continue;
        const taken = -this.sum("card_id = ? AND kind = 'penalty' AND dedupe LIKE 'overdue:%'", c.id);
        const amt = Math.min(r.overdue_per_day, r.overdue_card_cap - taken);
        if (amt > 0) this.penalize(amt, 'penalty', `"${c.title}" overdue`, { card: c.id, dedupe: `overdue:${c.id}:${day}`, now, day });
      }
    }
    // Expiry: anything above what was credited in the last N days has gone stale (oldest minutes go first).
    const recent = this.sum(`kind IN (${CREDIT_KINDS.map(() => '?').join(',')}) AND amount > 0 AND at > ?`, ...CREDIT_KINDS, end - r.expiry_days * 864e5);
    const bal = this.balance();
    if (bal > recent) this.insert(recent - bal, 'expire', `Minutes older than ${r.expiry_days} days expired`, { dedupe: `expire:${day}`, now });
    this.db.prepare('INSERT INTO wallet_days(day, closing) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET closing = excluded.closing').run(day, this.balance());
  }

  // ------------------------------------------------------------------ Ann's discretion & the owner's veto

  adjust(amount: number, reason: string, source: Source, now = Date.now()): LedgerRow | null {
    if (!Number.isInteger(amount) || amount === 0) throw new BoardError('amount must be a non-zero whole number of minutes');
    const why = reason?.trim();
    if (!why || why.length < 8) throw new BoardError('give a real reason (it is shown in the ledger)');
    if (this.phase(now) === 'off') throw new BoardError('the wallet is not running yet');
    const r = this.rules(now);
    const { start } = this.dayBounds(now);
    if (amount > 0) {
      const used = this.sum("kind = 'grant' AND source = ? AND at >= ?", source, start);
      const room = r.ann_grant_day - used;
      if (source === 'ann' && room <= 0) throw new BoardError(`Ann's grant limit for today (${r.ann_grant_day}) is used up`);
      const a = source === 'ann' ? Math.min(amount, room) : amount;
      const got = this.credit(a, 'grant', why, { source, now });
      return got ? (this.db.prepare('SELECT * FROM ledger ORDER BY id DESC LIMIT 1').get() as unknown as LedgerRow) : null;
    }
    const used = -this.sum("kind = 'fine' AND source = ? AND at >= ?", source, start);
    const room = r.ann_fine_day - used;
    if (source === 'ann' && room <= 0) throw new BoardError(`Ann's fine limit for today (${r.ann_fine_day}) is used up`);
    const a = Math.min(-amount, source === 'ann' ? room : -amount, this.balance() - r.debt_floor);
    if (a <= 0) throw new BoardError('the balance is already at the debt floor');
    return this.insert(-a, 'fine', why, { source, now });
  }

  /** Reverse an Ann grant/fine within the veto window. */
  veto(ledgerId: number, now = Date.now()) {
    const r = this.rules(now);
    const row = this.db.prepare('SELECT * FROM ledger WHERE id = ?').get(ledgerId) as unknown as LedgerRow | undefined;
    if (!row || row.source !== 'ann' || !['grant', 'fine'].includes(row.kind)) throw new BoardError('only Ann\'s grants and fines can be vetoed', 400);
    if (now - row.at > r.veto_hours * 3600_000) throw new BoardError(`the ${r.veto_hours}h veto window has passed`, 409);
    const v = this.insert(-row.amount, 'veto', `Vetoed: ${row.reason}`, { source: 'web', dedupe: `veto:${row.id}`, now });
    if (!v) throw new BoardError('already vetoed', 409);
    return v;
  }

  /** Sick, travel or emergency day: no penalties, a flat allowance instead. Today, tomorrow+, or yesterday at most. */
  pauseDay(day: string, reason: string, source: Source, now = Date.now()) {
    const r = this.rules(now);
    const today = localDay(now, this.tz);
    if (daysBetween(today, day) < -1) throw new BoardError('pause days can be declared at most one day late');
    if (daysBetween(today, day) > 60) throw new BoardError('too far ahead');
    if (!reason?.trim()) throw new BoardError('give a reason');
    if (this.isPaused(day)) throw new BoardError(`${day} is already a pause day`, 409);
    const month = day.slice(0, 7);
    const used = (this.db.prepare('SELECT COUNT(*) AS n FROM pause_days WHERE day LIKE ?').get(`${month}-%`) as { n: number }).n;
    if (used >= r.pause_per_month) throw new BoardError(`all ${r.pause_per_month} pause days for ${month} are used`);
    this.db.prepare('INSERT INTO pause_days(day, reason, source, created_at) VALUES (?, ?, ?, ?)').run(day, reason.trim().slice(0, 200), source, now);
    // Refund penalties already charged for that day, and top the allowance up to the pause allowance.
    const charged = this.db.prepare("SELECT id, amount, reason FROM ledger WHERE amount < 0 AND kind IN ('forfeit','penalty') AND dedupe LIKE ?").all(`%:${day}`) as { id: number; amount: number; reason: string }[];
    for (const c of charged) this.insert(-c.amount, 'refund', `Pause day: ${c.reason}`, { source, dedupe: `pause-refund:${c.id}`, now });
    if (day <= today && this.got(`allow:${day}`)) this.credit(Math.max(r.pause_allowance - r.allowance, 0), 'pause', `Pause day (${reason.trim().slice(0, 60)})`, { dedupe: `pause-top:${day}`, now, source });
    return { day, used: used + 1, left: r.pause_per_month - used - 1 };
  }

  // ------------------------------------------------------------------ phone

  activeSession(now = Date.now()) {
    return (this.db.prepare('SELECT * FROM phone_sessions WHERE stopped_at IS NULL AND ends_at > ? ORDER BY id DESC LIMIT 1').get(now) as any) ?? null;
  }

  /** Prepay a session in walled apps. Baseline/off: free and unmetered. */
  spend(deviceId: number, app: string, minutes: number, now = Date.now()) {
    const r = this.rules(now);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > r.unlock_max) throw new BoardError(`minutes must be 1-${r.unlock_max}`);
    const cur = this.activeSession(now);
    if (cur) throw new BoardError('a session is already running', 409);
    const phase = this.phase(now);
    if (phase === 'active') {
      const bal = this.balance();
      if (bal < minutes) throw new BoardError(bal <= 0 ? 'no screen minutes left' : `only ${bal} minutes left`, 402);
      this.insert(-minutes, 'spend', `${minutes} min on ${app}`, { source: 'phone', now });
    }
    const id = Number(this.db.prepare("INSERT INTO phone_sessions(device_id, app, kind, started_at, ends_at) VALUES (?, ?, 'spend', ?, ?)").run(deviceId, app.slice(0, 120), now, now + minutes * 60000).lastInsertRowid);
    return this.db.prepare('SELECT * FROM phone_sessions WHERE id = ?').get(id);
  }

  /** End a session early: unused whole minutes come back. */
  stopSession(id: number, now = Date.now(), deviceId?: number) {
    const s = this.db.prepare('SELECT * FROM phone_sessions WHERE id = ?').get(id) as any;
    if (!s || (deviceId !== undefined && s.device_id !== deviceId)) throw new BoardError('session not found', 404);
    if (s.stopped_at) return { refunded: 0 };
    this.db.prepare('UPDATE phone_sessions SET stopped_at = ? WHERE id = ?').run(Math.min(now, s.ends_at), id);
    const unused = Math.floor((s.ends_at - now) / 60000);
    if (s.kind === 'spend' && unused > 0 && this.phase(s.started_at) === 'active') {
      this.insert(unused, 'refund', `Ended early: ${unused} min back`, { source: 'phone', dedupe: `stop:${id}`, now });
      return { refunded: unused };
    }
    return { refunded: 0 };
  }

  /** The blocked screen's "go back": a small reward for not opening the app. */
  back(now = Date.now()) {
    const r = this.rules(now);
    if (this.phase(now) !== 'active') return 0;
    const { today, start } = this.dayBounds(now);
    const n = (this.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'back' AND at >= ?").get(start) as { n: number }).n;
    if (n >= r.back_per_day) return 0;
    return this.credit(r.back_reward, 'back', 'Went back instead of opening a walled app', { source: 'phone', dedupe: `back:${today}:${n}`, now });
  }

  emergency(deviceId: number, reason: string, now = Date.now()) {
    const r = this.rules(now);
    if (!reason?.trim() || reason.trim().length < 5) throw new BoardError('type why you need it');
    if (this.activeSession(now)) throw new BoardError('a session is already running', 409);
    const today = localDay(now, this.tz);
    const used = (this.db.prepare("SELECT COUNT(*) AS n FROM phone_sessions WHERE kind = 'emergency' AND started_at >= ?").get(startOfDay(startOfWeek(today, 1), this.tz)) as { n: number }).n;
    if (used >= r.emergency_per_week) throw new BoardError(`no emergency unlocks left this week (${r.emergency_per_week})`, 429);
    if (this.phase(now) === 'active') {
      const bal = this.balance();
      if (bal - r.emergency_cost < r.debt_floor) throw new BoardError('an emergency unlock would go past the debt floor', 402);
      this.insert(-r.emergency_cost, 'emergency', `Emergency unlock: ${reason.trim().slice(0, 150)}`, { source: 'phone', now });
    }
    const id = Number(this.db.prepare("INSERT INTO phone_sessions(device_id, app, kind, started_at, ends_at) VALUES (?, '*', 'emergency', ?, ?)").run(deviceId, now, now + r.emergency_minutes * 60000).lastInsertRowid);
    return { session: this.db.prepare('SELECT * FROM phone_sessions WHERE id = ?').get(id), left: r.emergency_per_week - used - 1 };
  }

  /** The phone's protection was off for a while (it reports this when it comes back). */
  protectionGap(deviceId: number, minutes: number, now = Date.now()) {
    const r = this.rules(now);
    if (!Number.isFinite(minutes) || minutes < r.tamper_gap_min) return 0;
    return this.penalize(r.tamper_penalty, 'penalty', `Phone protection was off for ${Math.round(minutes)} min`, { dedupe: `gap:${deviceId}:${Math.floor(now / 600000)}`, now });
  }

  recordUsage(day: string, apps: Record<string, number>, now = Date.now()) {
    const up = this.db.prepare('INSERT INTO phone_usage(day, app, minutes) VALUES (?, ?, ?) ON CONFLICT(day, app) DO UPDATE SET minutes = excluded.minutes');
    for (const [app, m] of Object.entries(apps).slice(0, 200)) if (Number.isFinite(m) && m >= 0) up.run(day, app.slice(0, 120), Math.round(m));
    this.billTab(day, now);
  }

  /** What the phone needs to enforce the wall. */
  phoneState(now = Date.now()) {
    const r = this.rules(now);
    const phase = this.phase(now);
    const today = localDay(now, this.tz);
    const emUsed = (this.db.prepare("SELECT COUNT(*) AS n FROM phone_sessions WHERE kind = 'emergency' AND started_at >= ?").get(startOfDay(startOfWeek(today, 1), this.tz)) as { n: number }).n;
    const s = this.activeSession(now);
    return {
      phase, enforce: phase === 'active', balance: this.balance(), walled_apps: r.walled_apps, unlock_max: r.unlock_max,
      session: s ? { id: s.id, app: s.app, kind: s.kind, ends_at: s.ends_at } : null,
      emergency: { cost: r.emergency_cost, minutes: r.emergency_minutes, left: Math.max(r.emergency_per_week - emUsed, 0) },
      back_reward: r.back_reward, tamper: { gap_min: r.tamper_gap_min, penalty: r.tamper_penalty }, server_time: now,
    };
  }

  // ------------------------------------------------------------------ reading

  ledger(opts: { limit?: number; before?: number } = {}): LedgerRow[] {
    return this.db.prepare(`SELECT * FROM ledger ${opts.before ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?`)
      .all(...(opts.before ? [opts.before] : []), Math.min(opts.limit ?? 50, 500)) as unknown as LedgerRow[];
  }

  summary(now = Date.now()) {
    this.tick(now);
    const r = this.rules(now);
    const { today, start } = this.dayBounds(now);
    const kinds = (ks: string[]) => this.sum(`kind IN (${ks.map(() => '?').join(',')}) AND at >= ?`, ...ks, start);
    const s = this.state();
    const vetoable = (this.db.prepare("SELECT * FROM ledger WHERE source = 'ann' AND kind IN ('grant','fine') AND ABS(amount) > ? AND at > ? AND id NOT IN (SELECT CAST(substr(dedupe, 6) AS INTEGER) FROM ledger WHERE dedupe LIKE 'veto:%') ORDER BY id DESC")
      .all(r.veto_threshold, now - r.veto_hours * 3600_000)) as unknown as LedgerRow[];
    return {
      phase: this.phase(now), started: s.started, baseline_until: s.baseline_until, balance: this.balance(),
      today: {
        day: today, earned: kinds(EARNINGS), allowance: kinds(['allowance', 'pause']), penalties: kinds(PENALTY_KINDS),
        spent: -kinds(['spend', 'emergency', 'tab']), tab: -kinds(['tab']), refunded: kinds(['refund']), ann: this.sum("kind IN ('grant','fine') AND source = 'ann' AND at >= ?", start),
        earn_cap: r.daily_earn_cap, paused: this.isPaused(today),
      },
      debt: Math.min(this.balance(), 0), debt_floor: r.debt_floor, balance_cap: r.balance_cap,
      pending_credit: this.pendingCards().map((c) => ({ card: c, expected: this.expected({ ...c, credit_pending: false }, now) })),
      vetoable, phone: this.phoneState(now), rules: r, pending_rules: s.pending,
      pause_days: this.db.prepare('SELECT day, reason, source FROM pause_days WHERE day >= ? ORDER BY day').all(addDays(today, -31)),
    };
  }

  /** One line for chat. */
  line(now = Date.now()): string {
    const p = this.phase(now);
    if (p === 'off') return 'Wallet: off';
    const sm = this.summary(now);
    const t = sm.today;
    const parts = [`Wallet: ${sm.balance} min`, `+${t.earned} earned today (cap ${t.earn_cap})`];
    if (t.penalties) parts.push(`${t.penalties} in penalties`);
    if (sm.pending_credit.length) parts.push(`${sm.pending_credit.length} completion${sm.pending_credit.length > 1 ? 's' : ''} awaiting your confirmation`);
    if (p === 'baseline') parts.push(`baseline week until ${sm.baseline_until} (nothing blocked yet)`);
    if (t.paused) parts.push('pause day');
    return parts.join(' · ');
  }
}

export { EARN_KINDS };

const wallets = new WeakMap<Board, Wallet>();
/** The board's wallet (one per board, so the after-commit hook is registered once). */
export function getWallet(board: Board): Wallet {
  let w = wallets.get(board);
  if (!w) { w = new Wallet(board); wallets.set(board, w); }
  return w;
}
