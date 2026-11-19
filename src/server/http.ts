// HTTP surface. Two Hono apps:
//   ui   UI + JSON API + live events + owner login + health. Local: also /mcp with the local bearer token.
//   mcp  (only with OAuth configured) /mcp with Orbit Identity tokens, its discovery documents and health.
//        Nothing else: a misrouted public request can never reach the UI or the API.
import { Hono, type Context } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Board, BoardError, type BatchMeta, type CardInput, type CardPatch } from '../core/board.ts';
import type { BoardEvent, ColumnKind, Settings } from '../core/types.ts';
import { backup, listBackups } from '../core/db.ts';
import { addCards, quickAdd } from '../core/ops.ts';
import { parseQuickAdd } from '../core/nlp.ts';
import { insights, planDay, rank, summary, triage } from '../core/insights.ts';
import { setPlan } from '../core/plan.ts';
import { exportJson, importJson } from '../core/transfer.ts';
import { buildMcpServer, prettyClient, SERVER_INSTRUCTIONS } from '../mcp/server.ts';
import { addDays, isDay } from '../core/time.ts';
import { getWallet } from '../core/wallet.ts';
import { addressMatcher, type Config } from './config.ts';
import { SESSION_COOKIE, REMEMBER_IDLE_MS, type Owner } from './owner.ts';
import { challenge, resourceMetadata, type TokenCheck } from './oauth.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = process.env.HEYANN_UI_DIR ?? join(ROOT, 'web', 'dist');
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const INSTRUCTIONS_SNIPPET = `"Hey Ann" means: use my Hey Ann connector (my Kanban board). Any message beginning with "Hey Ann" is a board command (add, move, update, list, plan or summarize cards), so call the Hey Ann tools rather than replying conversationally. If unsure which card I mean, show the matches and ask.`;

export interface Deps {
  owner: Owner | null;
  verifyToken: ((token: string | undefined) => Promise<TokenCheck>) | null;
}

/** The TCP peer. @hono/node-server passes the Node request as env.incoming; tests pass env.remoteAddress. */
function peer(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } }; remoteAddress?: string } | undefined;
  return (env?.incoming?.socket?.remoteAddress ?? env?.remoteAddress ?? '').replace(/^::ffff:/, '');
}

/** HTTPS as seen by the client: X-Forwarded-Proto counts only from a trusted proxy. */
function viaHttps(c: Context, trusted: (ip: string) => boolean): boolean {
  if (!trusted(peer(c))) return false;
  return (c.req.header('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase() === 'https';
}

const hostAllowed = (host: string | undefined, allowed: string[]) =>
  !!host && (LOCAL_HOST.test(host) || allowed.some((h) => h.toLowerCase() === host.toLowerCase()));

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function securityHeaders(c: Context) {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
}

function health(r: Hono, board: Board) {
  r.get('/health/live', (c) => c.json({ status: 'Healthy' }));
  r.get('/health/ready', (c) => {
    try {
      board.db.prepare('SELECT 1').get();
      return c.json({ status: 'Ready' });
    } catch {
      return c.json({ status: 'NotReady' }, 503);
    }
  });
}

/** One stateless MCP server per request. scopes undefined = fully trusted local caller. */
async function handleMcp(board: Board, req: Request, opts: { client?: string | null; scopes?: ReadonlySet<string> } = {}) {
  // e.g. "openai-mcp/1.0" -> "openai-mcp", "claude-code/2.1" -> "claude-code"
  const ua = (req.headers.get('user-agent') ?? '').split(/[\s/]/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const server = buildMcpServer(board, { client: prettyClient(opts.client || ua || 'http'), scopes: opts.scopes });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export function createServers(board: Board, cfg: Config, deps: Deps): { ui: Hono; mcp: Hono | null } {
  return { ui: uiServer(board, cfg, deps), mcp: cfg.oauth && deps.verifyToken ? mcpServer(board, cfg, deps.verifyToken) : null };
}

// ======================================================================================= UI listener

function uiServer(board: Board, cfg: Config, deps: Deps): Hono {
  const { owner } = deps;
  const localMcp = !cfg.deployed && !cfg.oauth;
  const uiTrusted = addressMatcher(cfg.trustedProxies);
  const uiOrigins = new Set([...(cfg.publicOrigin ? [cfg.publicOrigin] : []), ...(cfg.deployed ? [] : [`http://localhost:${cfg.port}`, `http://127.0.0.1:${cfg.port}`, 'http://localhost:5173', 'http://127.0.0.1:5173'])]);
  const root = new Hono();

  root.use('*', async (c, next) => {
    await next();
    securityHeaders(c);
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/health/')) c.header('Cache-Control', 'no-store');
  });
  health(root, board);

  // Exact Host only (DNS rebinding, stray tunnels), then HTTPS when deployed.
  root.use('*', async (c, next) => {
    if (!hostAllowed(c.req.header('host'), cfg.allowedHosts)) return c.json({ error: 'Unknown host.' }, 403);
    if (cfg.deployed && !viaHttps(c, uiTrusted)) return c.json({ error: 'HTTPS is required.' }, 403);
    await next();
  });

  // Owner session: required for the API (except the session endpoint). The static UI loads without it and shows
  // the sign-in screen.
  const session = (c: Context) => (owner ? owner.check(getCookie(c, SESSION_COOKIE)) : { persistent: true });
  root.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/session' || c.req.path.startsWith('/api/phone/')) return next();
    if (!session(c)) return c.json({ error: 'Sign in to continue.', code: 'signin' }, 401);
    await next();
  });

  const api = new Hono();

  // Cross-site write protection: unsafe methods need a JSON body (forces a CORS preflight we never grant), an Origin
  // equal to the UI's when one is sent, and no cross-site fetch metadata.
  api.use('*', async (c, next) => {
    if (UNSAFE.has(c.req.method)) {
      const ct = c.req.header('content-type') ?? '';
      if (!ct.includes('application/json')) return c.json({ error: 'Content-Type must be application/json' }, 415);
      const origin = c.req.header('origin');
      const site = c.req.header('sec-fetch-site');
      if ((origin !== undefined && !uiOrigins.has(origin)) || site === 'cross-site' || site === 'same-site')
        return c.json({ error: 'Cross-site request refused.' }, 403);
    }
    await next();
  });
  api.use('*', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }));

  api.onError((e: any, c) => {
    if (e instanceof BoardError) return c.json({ error: e.message, details: e.details }, e.status as 400);
    if (e instanceof SyntaxError) return c.json({ error: 'Invalid JSON body.' }, 400);
    console.error(e);
    return c.json({ error: e.message ?? 'Internal error' }, 500);
  });

  const web = (action: string): BatchMeta => ({ actor: 'web', client: null, action: `web:${action}` });
  const num = (s: string | undefined, what = 'id') => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new BoardError(`invalid ${what}`);
    return n;
  };
  const body = async (c: Context) => (await c.req.json().catch(() => { throw new BoardError('Invalid JSON body.'); })) ?? {};
  const ids = (v: unknown) => {
    if (!Array.isArray(v) || !v.length || v.length > 500 || !v.every((x) => Number.isInteger(x))) throw new BoardError('ids must be a non-empty list of card ids');
    return v as number[];
  };

  // ---- Session
  api.get('/session', (c) => c.json({ signedIn: !!session(c), loginRequired: !!owner }));
  api.post('/session', bodyLimit({ maxSize: 4096 }), async (c) => {
    if (!owner) return c.json({ signedIn: true });
    const b = await c.req.json().catch(() => ({}));
    const r = await owner.login(b.password, b.remember);
    if (!r.ok) return c.json({ error: r.error }, r.status);
    setCookie(c, SESSION_COOKIE, r.session, {
      path: '/', secure: true, httpOnly: true, sameSite: 'Strict', ...(r.persistent ? { maxAge: Math.floor(REMEMBER_IDLE_MS / 1000) } : {}),
    });
    return c.json({ signedIn: true });
  });
  api.delete('/session', (c) => {
    owner?.logout(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.json({ signedIn: false });
  });
  api.post('/session/revoke-all', (c) => {
    owner?.logoutAll();
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.json({ signedIn: false });
  });

  // ---- Board & cards
  api.get('/board', (c) => c.json(board.snapshot()));
  api.get('/cards', (c) => {
    const q = c.req.query();
    return c.json(board.search({
      q: q.q, column: q.column ? num(q.column) : undefined, project: q.project ? num(q.project) : undefined, tag: q.tag || undefined,
      priority: q.priority ? num(q.priority) : undefined, due: (['overdue', 'today', 'week', 'none'] as const).find((d) => d === q.due),
      blocked: q.blocked === '1', archived: q.archived === '1', limit: q.limit ? num(q.limit) : 50, offset: q.offset ? num(q.offset) : 0,
    }));
  });
  api.get('/cards/:id', (c) => {
    const id = num(c.req.param('id'));
    return c.json({ card: board.mustCard(id), activity: board.activity({ card: id, limit: 30 }) });
  });
  api.post('/cards', async (c) => {
    const b = await body(c);
    const items: CardInput[] = Array.isArray(b.items) ? b.items : [b];
    const r = addCards(board, items.map((i) => ({ ...i, allow_duplicate: true })), web('add'));
    return c.json({ cards: [...r.created, ...r.existing], batch: r.batch, notes: r.notes });
  });
  api.patch('/cards/:id', async (c) => {
    const id = num(c.req.param('id'));
    const b = (await body(c)) as CardPatch;
    let notes: string[] = [];
    const { result, batch } = board.batch(web('edit'), (tx) => {
      const card = tx.updateCard(id, b);
      tx.summary = b.column_id !== undefined ? `Moved "${card.title}"` : `Edited "${card.title}"`;
      notes = tx.notes;
      return card;
    });
    return c.json({ card: result, batch, notes });
  });
  api.post('/cards/:id/move', async (c) => {
    const id = num(c.req.param('id'));
    const b = await body(c);
    let notes: string[] = [];
    const { result, batch } = board.batch(web('move'), (tx) => {
      const before = board.mustCard(id);
      const card = tx.moveCard(id, num(String(b.column_id), 'column_id'), b.before_id ?? null, b.after_id ?? null);
      const col = board.column(card.column_id);
      tx.summary = before.column_id === card.column_id ? `Reordered "${card.title}"` : col.kind === 'done' ? `Completed "${card.title}"` : `Moved "${card.title}" to ${col.name}`;
      notes = tx.notes;
      return card;
    });
    return c.json({ card: result, batch, notes, wip_warning: notes.find((n) => n.startsWith('WIP')) });
  });
  api.post('/cards/archive', async (c) => {
    const list = ids((await body(c)).ids);
    const { result, batch } = board.batch(web('archive'), (tx) => {
      const cards = list.map((id) => tx.archiveCard(id));
      tx.summary = cards.length === 1 ? `Archived "${cards[0].title}"` : `Archived ${cards.length} cards`;
      return cards;
    });
    return c.json({ cards: result, batch });
  });
  api.post('/cards/restore', async (c) => {
    const list = ids((await body(c)).ids);
    const { result, batch } = board.batch(web('restore'), (tx) => {
      const cards = list.map((id) => tx.restoreCard(id));
      tx.summary = cards.length === 1 ? `Restored "${cards[0].title}"` : `Restored ${cards.length} cards`;
      return cards;
    });
    return c.json({ cards: result, batch });
  });
  api.delete('/cards/:id', (c) => {
    const id = num(c.req.param('id'));
    const { batch } = board.batch(web('delete'), (tx) => {
      const title = board.mustCard(id).title;
      tx.deleteCard(id);
      tx.summary = `Deleted "${title}" permanently`;
    });
    return c.json({ ok: true, batch });
  });
  api.post('/cards/:id/focus', async (c) => {
    const id = num(c.req.param('id'));
    const action = (await body(c)).action === 'stop' ? 'stop' : 'start';
    let notes: string[] = [];
    const { result, batch } = board.batch(web(`focus:${action}`), (tx) => {
      const card = tx.focus(id, action);
      tx.summary = action === 'start' ? `Started focus on "${card.title}"` : `Stopped focus on "${card.title}"`;
      notes = tx.notes;
      return card;
    });
    const logged = notes.map((n) => /^Logged (\d+) min/.exec(n)?.[1]).find(Boolean);
    return c.json({ card: result, batch, notes, logged_min: logged ? Number(logged) : undefined });
  });
  api.post('/cards/:id/log', async (c) => {
    const id = num(c.req.param('id'));
    const minutes = (await body(c)).minutes;
    const { result, batch } = board.batch(web('log'), (tx) => {
      const card = tx.logTime(id, minutes);
      tx.summary = `Logged ${minutes} min on "${card.title}"`;
      return card;
    });
    return c.json({ card: result, batch });
  });
  api.post('/cards/:id/duplicate', (c) => {
    const src = board.mustCard(num(c.req.param('id')));
    const { result, batch } = board.batch(web('duplicate'), (tx) => {
      const card = tx.createCard({
        title: `${src.title} (copy)`.slice(0, 300), notes: src.notes, column_id: src.column_id, priority: src.priority,
        due_at: src.due_at, due_has_time: src.due_has_time, estimate_min: src.estimate_min, project_id: src.project_id, tags: src.tags,
        checklist: src.checklist.map((i) => ({ text: i.text, done: false })), links: src.links, recurrence: src.recurrence,
      });
      tx.summary = `Duplicated "${src.title}"`;
      return card;
    });
    return c.json({ card: result, batch });
  });

  // ---- Natural language
  api.post('/parse', async (c) => {
    const s = board.settings();
    return c.json(parseQuickAdd(String((await body(c)).text ?? '').slice(0, 2000), s.timezone, Date.now(), s.week_starts_on));
  });
  api.post('/quick-add', async (c) => {
    const b = await body(c);
    const r = quickAdd(board, String(b.text ?? '').slice(0, 20000), web('quick-add'), { columnId: b.column_id ? num(String(b.column_id)) : undefined });
    return c.json({ cards: r.created, batch: r.batch, notes: r.notes });
  });

  // ---- Planning, summaries, insights
  api.get('/next', (c) => c.json({ items: rank(board, { minutes: c.req.query('minutes') ? num(c.req.query('minutes')) : undefined, context: c.req.query('context') }).slice(0, 5) }));
  api.get('/plan', (c) => {
    const d = c.req.query('date');
    return c.json(planDay(board, { date: d && isDay(d) ? d : undefined }));
  });
  api.post('/plan', async (c) => {
    const b = await body(c);
    const day = b.date && isDay(b.date) ? b.date : board.today();
    const list = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => Number.isInteger(x)) : [];
    const { result, batch } = setPlan(board, list, day, web('plan'));
    return c.json({ cards: result, batch });
  });
  api.get('/summary', (c) => {
    const k = c.req.query('kind');
    return c.json(summary(board, k === 'daily' || k === 'weekly' ? k : 'standup'));
  });
  api.get('/insights', (c) => c.json(insights(board, c.req.query('days') ? num(c.req.query('days')) : 30)));
  api.get('/triage', (c) => c.json(triage(board)));

  // ---- Activity & undo
  api.get('/activity', (c) => {
    const actor = c.req.query('actor');
    return c.json({ items: board.activity({
      limit: c.req.query('limit') ? num(c.req.query('limit')) : 50,
      before: c.req.query('before') ? num(c.req.query('before')) : undefined,
      actor: actor === 'web' || actor === 'ann' || actor === 'system' ? actor : undefined,
    }) });
  });
  api.post('/activity/:id/undo', (c) => {
    const r = board.undo(c.req.param('id'), web('undo'));
    return c.json({ batch: r.batch, conflicts: r.conflicts });
  });
  api.post('/undo', (c) => {
    const last = board.lastUndoable();
    if (!last) throw new BoardError('Nothing to undo.', 404);
    const r = board.undo(last.id, web('undo'));
    return c.json({ batch: r.batch, conflicts: r.conflicts });
  });

  // Live updates: every change from any source (the UI, Ann over MCP, the system).
  api.get('/events', (c) => streamSSE(c, async (stream) => {
    const send = (ev: BoardEvent) => { void stream.writeSSE({ event: 'board', data: JSON.stringify(ev) }); };
    const sendWallet = (ev: unknown) => { void stream.writeSSE({ event: 'wallet', data: JSON.stringify(ev) }); };
    board.events.on('board', send);
    board.events.on('wallet', sendWallet);
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ now: Date.now() }) });
    const beat = setInterval(() => { void stream.write(': ping\n\n'); }, 25_000);
    await new Promise<void>((done) => stream.onAbort(() => done()));
    clearInterval(beat);
    board.events.off('board', send);
    board.events.off('wallet', sendWallet);
  }));

  // ---- Screen-time wallet (owner)
  const wallet = getWallet(board);
  api.get('/wallet', (c) => c.json(wallet.summary()));
  api.get('/wallet/ledger', (c) => c.json({ items: wallet.ledger({ limit: c.req.query('limit') ? num(c.req.query('limit')) : 50, before: c.req.query('before') ? num(c.req.query('before')) : undefined }) }));
  api.post('/wallet/start', async (c) => c.json(wallet.start({ baseline: (await body(c)).baseline !== false })));
  api.post('/wallet/end-baseline', async (c) => {
    const b = await body(c);
    return c.json(wallet.endBaseline(b.day && isDay(b.day) ? b.day : undefined));
  });
  api.patch('/wallet/rules', async (c) => c.json(wallet.setRules(await body(c))));
  api.post('/wallet/confirm/:cardId', async (c) => c.json({ card: wallet.confirmCredit(num(c.req.param('cardId')), (await body(c)).accept !== false), balance: wallet.balance() }));
  api.post('/wallet/veto/:id', (c) => c.json({ entry: wallet.veto(num(c.req.param('id'))), balance: wallet.balance() }));
  api.post('/wallet/pause', async (c) => {
    const b = await body(c);
    return c.json(wallet.pauseDay(b.day && isDay(b.day) ? b.day : board.today(), String(b.reason ?? ''), 'web'));
  });
  // The owner can fine themselves (confessions), never grant: self-granting would be a one-click way around the wall.
  api.post('/wallet/fine', async (c) => {
    const b = await body(c);
    return c.json({ entry: wallet.adjust(-Math.abs(num(String(b.minutes), 'minutes')), String(b.reason ?? ''), 'web'), balance: wallet.balance() });
  });
  api.get('/wallet/usage', (c) => {
    const days = Math.min(c.req.query('days') ? num(c.req.query('days')) : 14, 90);
    return c.json({ items: board.db.prepare('SELECT day, app, minutes FROM phone_usage WHERE day >= ? ORDER BY day, minutes DESC').all(addDays(board.today(), -days)) });
  });
  api.get('/devices', (c) => c.json({ items: board.db.prepare('SELECT id, name, created_at, last_seen, revoked_at FROM devices ORDER BY id DESC').all() }));
  api.post('/devices', async (c) => {
    const name = String((await body(c)).name ?? 'Phone').trim().slice(0, 40) || 'Phone';
    const token = randomBytes(32).toString('base64url');
    const id = Number(board.db.prepare('INSERT INTO devices(name, token_hash, created_at) VALUES (?, ?, ?)').run(name, sha256(token), Date.now()).lastInsertRowid);
    // The token is shown once; only its hash is stored.
    return c.json({ id, name, token });
  });
  api.delete('/devices/:id', (c) => {
    board.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), num(c.req.param('id')));
    return c.json({ ok: true });
  });

  // ---- Phone (device token, not the owner session). Tailnet only, like the rest of this listener.
  const phone = new Hono<{ Variables: { device: number } }>();
  phone.use('*', async (c, next) => {
    const m = /^Bearer\s+(\S{20,100})$/i.exec(c.req.header('authorization') ?? '');
    const d = m ? board.db.prepare('SELECT id FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(m[1])) as { id: number } | undefined : undefined;
    if (!d) return c.json({ error: 'Unknown or revoked device token.' }, 401);
    board.db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), d.id);
    c.set('device', d.id);
    await next();
  });
  phone.get('/state', (c) => { wallet.tick(); return c.json(wallet.phoneState()); });
  phone.post('/session', async (c) => {
    const b = await body(c);
    if (b.action === 'stop') return c.json({ ...wallet.stopSession(num(String(b.id)), Date.now(), c.get('device')), state: wallet.phoneState() });
    return c.json({ session: wallet.spend(c.get('device'), String(b.app ?? 'unknown'), num(String(b.minutes), 'minutes')), state: wallet.phoneState() });
  });
  phone.post('/back', (c) => c.json({ rewarded: wallet.back(), state: wallet.phoneState() }));
  phone.post('/emergency', async (c) => c.json({ ...wallet.emergency(c.get('device'), String((await body(c)).reason ?? '')), state: wallet.phoneState() }));
  phone.post('/gap', async (c) => c.json({ penalty: wallet.protectionGap(c.get('device'), Number((await body(c)).minutes)), state: wallet.phoneState() }));
  phone.post('/usage', async (c) => {
    const b = await body(c);
    if (!isDay(b.day) || typeof b.apps !== 'object' || !b.apps) throw new BoardError('usage needs { day: "YYYY-MM-DD", apps: { package: minutes } }');
    wallet.recordUsage(b.day, b.apps);
    return c.json({ ok: true });
  });
  api.route('/phone', phone);

  // ---- Board configuration
  const cfgWrite = <T>(action: string, summary: (r: any) => string, fn: (tx: import('../core/board.ts').Tx) => T) => {
    const { result, batch } = board.batch(web(action), (tx) => {
      const r = fn(tx);
      tx.summary = summary(r);
      return r;
    });
    return { result, batch };
  };
  api.post('/columns', async (c) => {
    const b = await body(c);
    const { result, batch } = cfgWrite('column:add', (col) => `Added column "${col.name}"`, (tx) => tx.createColumn({ name: b.name, kind: b.kind as ColumnKind, wip_limit: b.wip_limit, color: b.color, after_id: b.after_id }));
    return c.json({ column: result, batch });
  });
  api.patch('/columns/:id', async (c) => {
    const id = num(c.req.param('id'));
    const b = await body(c);
    const { result, batch } = cfgWrite('column:edit', (col) => `Updated column "${col.name}"`, (tx) => tx.updateColumn(id, { name: b.name, kind: b.kind, wip_limit: b.wip_limit, color: b.color }));
    return c.json({ column: result, batch });
  });
  api.post('/columns/reorder', async (c) => {
    const list = ids((await body(c)).ids);
    const { result, batch } = cfgWrite('column:reorder', () => 'Reordered columns', (tx) => tx.reorderColumns(list));
    return c.json({ columns: result, batch });
  });
  api.delete('/columns/:id', (c) => {
    const id = num(c.req.param('id'));
    const name = board.column(id).name;
    const { batch } = cfgWrite('column:delete', () => `Deleted column "${name}"`, (tx) => tx.deleteColumn(id));
    return c.json({ ok: true, batch });
  });
  api.get('/projects', (c) => {
    const counts = board.db.prepare(`SELECT c.project_id AS id, SUM(CASE WHEN col.kind = 'done' THEN 0 ELSE 1 END) AS open, SUM(CASE WHEN col.kind = 'done' THEN 1 ELSE 0 END) AS done
      FROM cards c JOIN columns col ON col.id = c.column_id WHERE c.archived_at IS NULL AND c.project_id IS NOT NULL GROUP BY c.project_id`).all() as { id: number; open: number; done: number }[];
    const m = new Map(counts.map((r) => [r.id, r]));
    return c.json({ items: board.projects().map((p) => ({ ...p, open: m.get(p.id)?.open ?? 0, done: m.get(p.id)?.done ?? 0 })) });
  });
  api.post('/projects', async (c) => {
    const b = await body(c);
    const { result, batch } = cfgWrite('project:add', (p) => `Created project "${p.name}"`, (tx) => tx.createProject(b));
    return c.json({ project: result, batch });
  });
  api.patch('/projects/:id', async (c) => {
    const id = num(c.req.param('id'));
    const b = await body(c);
    const { result, batch } = cfgWrite('project:edit', (p) => (b.archived === true ? `Archived project "${p.name}"` : b.archived === false ? `Restored project "${p.name}"` : `Updated project "${p.name}"`), (tx) => tx.updateProject(id, b));
    return c.json({ project: result, batch });
  });
  api.patch('/tags/:id', async (c) => {
    const id = num(c.req.param('id'));
    const b = await body(c);
    const { result, batch } = cfgWrite('tag:edit', (t) => `Updated tag #${t.name}`, (tx) => tx.updateTag(id, b));
    return c.json({ tag: result, batch });
  });
  api.post('/tags/merge', async (c) => {
    const b = await body(c);
    const { result, batch } = cfgWrite('tag:merge', (t) => `Merged a tag into #${t.name}`, (tx) => tx.mergeTags(num(String(b.source_id)), num(String(b.target_id))));
    return c.json({ tag: result, batch });
  });
  api.get('/settings', (c) => c.json(board.settings()));
  api.patch('/settings', async (c) => {
    const b = (await body(c)) as Partial<Settings>;
    const { result, batch } = cfgWrite('settings', () => 'Updated settings', (tx) => tx.updateSettings(b));
    return c.json({ settings: result, batch });
  });

  // ---- Connection & data
  api.get('/mcp-info', (c) => {
    const stdio = join(ROOT, 'src', 'mcp', 'stdio.ts');
    const base = {
      stdio_command: { command: 'node', args: ['--no-warnings', stdio] },
      claude_code: `claude mcp add hey-ann -s user -- node --no-warnings "${stdio}"`,
      instructions_snippet: INSTRUCTIONS_SNIPPET,
      server_instructions: SERVER_INSTRUCTIONS,
    };
    if (cfg.oauth) return c.json({ ...base, mode: 'oauth', url: cfg.oauth.resource, claude_code: `claude mcp add --transport http hey-ann ${cfg.oauth.resource}` });
    if (!localMcp) return c.json({ ...base, mode: 'off' });
    const token = board.mcpToken();
    return c.json({ ...base, mode: 'local', url: `http://localhost:${cfg.port}/mcp`, token, path_token_url: `http://localhost:${cfg.port}/mcp/t/${token}` });
  });
  api.get('/export/json', (c) => {
    const day = board.today();
    return c.body(JSON.stringify(exportJson(board), null, 2), 200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="hey-ann-${day}.json"` });
  });
  api.post('/import/json', async (c) => {
    const r = importJson(board, await body(c), web('import'));
    return c.json(r);
  });
  api.get('/export/db', (c) => {
    const dir = mkdtempSync(join(tmpdir(), 'heyann-export-'));
    const file = join(dir, 'heyann.db');
    try {
      board.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      return c.body(readFileSync(file), 200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': `attachment; filename="hey-ann-${board.today()}.db"` });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  api.get('/backups', (c) => c.json({ items: listBackups(board.dbPath) }));
  api.post('/backups', (c) => c.json({ file: backup(board.db, board.dbPath, 'manual') }));

  root.route('/api', api);

  // ---- MCP with the local token (local mode only). Always requires the token: a tunnel makes remote requests look local.
  if (localMcp) {
    const tokenOk = (given: string | undefined) => !!given && safeEqual(given, board.mcpToken());
    root.all('/mcp', async (c) => {
      const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
      if (!tokenOk(auth)) return c.json({ error: 'Missing or invalid bearer token' }, 401);
      return handleMcp(board, c.req.raw);
    });
    root.all('/mcp/t/:token', async (c) => {
      if (!tokenOk(c.req.param('token'))) return c.json({ error: 'Invalid token' }, 401);
      return handleMcp(board, c.req.raw);
    });
  }
  root.all('/mcp/*', (c) => c.json({ error: 'Not found' }, 404));
  root.all('/mcp', (c) => c.json({ error: 'Not found' }, 404));

  // ---- Static UI (built). In dev, Vite serves the UI and proxies /api here.
  if (existsSync(DIST)) {
    const staticRoot = relative(process.cwd(), DIST).replace(/\\/g, '/') || '.';
    const index = () => readFileSync(join(DIST, 'index.html'), 'utf8');
    root.use('/assets/*', serveStatic({ root: staticRoot, onFound: (_p, c) => { c.header('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    root.use('/*', serveStatic({ root: staticRoot }));
    root.get('*', (c) => c.html(index()));
  } else {
    root.get('/', (c) => c.text('UI not built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173'));
  }
  return root;
}

// ======================================================================================= MCP listener

function mcpServer(board: Board, cfg: Config, verify: (token: string | undefined) => Promise<TokenCheck>): Hono {
  const oauth = cfg.oauth!;
  const origin = cfg.mcpPublicOrigin!;
  const mcpTrusted = addressMatcher(cfg.mcpTrustedProxies);
  const hosts = [new URL(origin).host];
  const browserOrigins = new Set([origin, ...cfg.mcpAllowedOrigins]);
  const root = new Hono();
  const PER_MINUTE = 90;
  const windows = new Map<string, { start: number; n: number }>();
  const limited = (key: string) => {
    const t = Date.now();
    const w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      if (windows.size > 1000) windows.clear();
      windows.set(key, { start: t, n: 1 });
      return false;
    }
    return ++w.n > PER_MINUTE;
  };

  root.use('*', async (c, next) => {
    await next();
    securityHeaders(c);
    c.header('Cache-Control', 'no-store');
  });
  health(root, board);
  root.use('*', async (c, next) => {
    if (!hostAllowed(c.req.header('host'), hosts)) return c.json({ error: 'Unknown host.' }, 403);
    if (!viaHttps(c, mcpTrusted)) return c.json({ error: 'HTTPS is required.' }, 403);
    const o = c.req.header('origin');
    if (o !== undefined && !browserOrigins.has(o)) return c.json({ error: 'The request origin is not allowed.' }, 403);
    await next();
  });

  const metadata = (c: Context) => c.json(resourceMetadata(oauth));
  root.get('/.well-known/oauth-protected-resource', metadata);
  root.get('/.well-known/oauth-protected-resource/mcp', metadata);

  root.all('/mcp', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }), async (c) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    const r = await verify(m?.[1]);
    if (!r.ok) {
      c.header('WWW-Authenticate', challenge(origin));
      return c.json({ error: 'A valid Orbit Identity access token is required.' }, 401);
    }
    if (![...r.scopes].some((s) => s.startsWith('heyann.'))) {
      c.header('WWW-Authenticate', `${challenge(origin)}, error="insufficient_scope"`);
      return c.json({ error: 'The token has no Hey Ann scopes.' }, 403);
    }
    if (limited(r.sub)) return c.json({ error: 'Too many requests.' }, 429);
    return handleMcp(board, c.req.raw, { client: r.client, scopes: r.scopes });
  });

  root.all('*', (c) => c.json({ error: 'Not found' }, 404));
  return root;
}
