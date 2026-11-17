// Find a card from what a person (or a model) calls it: "#12", "12", "the migration", "raj's pr".
import type { Board } from './board.ts';
import type { Card } from './types.ts';

export type Resolution =
  | { ok: true; card: Card; score: number }
  | { ok: false; reason: 'ambiguous' | 'none'; ref: string; candidates: Card[] };

const STOP = new Set(['the', 'a', 'an', 'my', 'card', 'task', 'ticket', 'one', 'that', 'this', 'to', 'for', 'of', 'on', 'and']);

export function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]s\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const tokens = (s: string) => norm(s).split(' ').filter((t) => t && !STOP.has(t));

function trigrams(s: string): Set<string> {
  const t = `  ${norm(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

function trigramSim(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  let n = 0;
  for (const g of A) if (B.has(g)) n++;
  return n / Math.max(1, Math.min(A.size, B.size) + Math.abs(A.size - B.size) * 0.25);
}

/** 0..1: how well `ref` names `title`. */
export function matchScore(ref: string, title: string): number {
  const r = norm(ref), t = norm(title);
  if (!r) return 0;
  if (r === t) return 1;
  if (t.startsWith(r)) return 0.92;
  if (t.includes(r)) return 0.85;
  const rt = tokens(ref), tt = tokens(title);
  if (!rt.length) return 0;
  // Every query word appears (as a word prefix) in the title: "migration db" -> "Finish DB migration".
  const hits = rt.filter((w) => tt.some((x) => x.startsWith(w) || (w.length >= 4 && x.startsWith(w.slice(0, -1))))).length;
  const coverage = hits / rt.length;
  const sim = trigramSim(r, t);
  return Math.max(coverage * 0.82, sim * 0.75, coverage * 0.6 + sim * 0.3);
}

const THRESHOLD = 0.5;

/**
 * Resolve a reference to one card. Open (not done, not archived) cards win ties. With includeArchived, archived
 * cards are candidates too (for restore).
 */
export function resolveCard(board: Board, ref: string | number, opts: { includeArchived?: boolean; pool?: Card[] } = {}): Resolution {
  const raw = String(ref).trim();
  const idm = /^#?(\d+)$/.exec(raw);
  if (idm) {
    const c = board.card(Number(idm[1]));
    if (c && (opts.includeArchived || !c.archived_at)) return { ok: true, card: c, score: 1 };
    return { ok: false, reason: 'none', ref: raw, candidates: [] };
  }
  const pool = opts.pool ?? (opts.includeArchived ? [...board.openCards(), ...board.archivedCards(300)] : board.openCards());
  const doneCols = new Set(board.columns().filter((c) => c.kind === 'done').map((c) => c.id));
  const scored = pool
    .map((card) => {
      let s = matchScore(raw, card.title);
      if (s >= THRESHOLD) {
        if (!doneCols.has(card.column_id) && !card.archived_at) s += 0.04;
        if (card.archived_at) s -= 0.05;
      }
      return { card, s };
    })
    .filter((x) => x.s >= THRESHOLD)
    .sort((a, b) => b.s - a.s || b.card.updated_at - a.card.updated_at);
  if (!scored.length) {
    const near = pool.map((card) => ({ card, s: matchScore(raw, card.title) })).filter((x) => x.s > 0.25).sort((a, b) => b.s - a.s).slice(0, 5);
    return { ok: false, reason: 'none', ref: raw, candidates: near.map((x) => x.card) };
  }
  const [top, second] = scored;
  const exact = norm(top.card.title) === norm(raw);
  if (!exact && second && top.s - second.s < 0.08) return { ok: false, reason: 'ambiguous', ref: raw, candidates: scored.slice(0, 6).map((x) => x.card) };
  return { ok: true, card: top.card, score: top.s };
}

/** Similar open cards for a new title (duplicate check). */
export function similarCards(board: Board, title: string, pool: Card[], recentDoneSince: number): Card[] {
  const doneCols = new Set(board.columns().filter((c) => c.kind === 'done').map((c) => c.id));
  const n = norm(title);
  return pool
    .filter((c) => !c.archived_at && (!doneCols.has(c.column_id) || (c.completed_at ?? 0) >= recentDoneSince))
    .map((c) => ({ c, s: norm(c.title) === n ? 1 : Math.max(trigramSim(title, c.title), Math.min(matchScore(title, c.title), matchScore(c.title, title))) }))
    // A finished card only blocks a near-identical title ("Groceries" done yesterday shouldn't block "Buy groceries").
    .filter((x) => x.s >= (doneCols.has(x.c.column_id) ? 0.95 : 0.8))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.c);
}
