import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Board } from '../src/core/board.ts';
import { buildMcpServer } from '../src/mcp/server.ts';
import { createServers } from '../src/server/http.ts';
import { loadConfig } from '../src/server/config.ts';
import { Owner, makeVerifier } from '../src/server/owner.ts';
import { tokenVerifier } from '../src/server/oauth.ts';

async function mcp(board: Board, scopes?: Set<string>) {
  const server = buildMcpServer(board, { client: 'Test', scopes });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as any;
    return { error: !!r.isError, text: r.content[0].text as string };
  };
  return { client, call };
}

test('MCP: tools are listed with annotations, and a Hey Ann session works end to end', async () => {
  const board = new Board(':memory:');
  const { client, call } = await mcp(board);
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 15);
  for (const t of tools) {
    assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', t.name);
    assert.equal(typeof t.annotations?.destructiveHint, 'boolean', t.name);
  }
  assert.equal(tools.find((t) => t.name === 'archive_cards')!.annotations!.destructiveHint, true);
  assert.equal(tools.find((t) => t.name === 'get_board')!.annotations!.readOnlyHint, true);

  const add = await call('add_cards', { cards: [{ title: 'Finish migration', due: 'friday', priority: 'P1' }, { title: 'Review PR' }], utterance: 'Hey Ann ...' });
  assert.match(add.text, /Added 2 cards/);
  const upd = await call('update_cards', { updates: [{ card: 'migration', move_to: 'in progress' }, { card: 'review pr', move_to: 'done' }] });
  assert.match(upd.text, /completed 1/i);
  assert.match(upd.text, /moved 1 to In Progress/i);
  const board1 = await call('get_board');
  assert.match(board1.text, /## In Progress \(1\)/);
  const undo = await call('undo');
  assert.match(undo.text, /Undid/);
  assert.equal(board.openCards().filter((c) => board.kindOf(c.column_id) === 'todo').length, 2);
  const bad = await call('update_cards', { updates: [{ card: 'nonexistent thing', move_to: 'done' }] });
  assert.match(bad.text, /Nothing changed/);
  const date = await call('add_cards', { cards: [{ title: 'X', due: 'the twelfth of never' }] });
  assert.ok(date.error);
  assert.match(date.text, /could not understand the date/);
  // The handshake's client name wins over the transport-level fallback.
  assert.equal(board.activity({ actor: 'ann' })[0].client, 'test');
});

test('MCP: read-only token cannot see or call write tools', async () => {
  const board = new Board(':memory:');
  const { client, call } = await mcp(board, new Set(['heyann.read']));
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes('get_board'));
  assert.ok(!names.includes('add_cards'));
  const r = await call('add_cards', { cards: [{ title: 'nope' }] });
  assert.ok(r.error);
  assert.equal(board.openCards().length, 0);
});

const req = (app: any, path: string, init: RequestInit & { remote?: string } = {}) =>
  app.fetch(new Request(`http://localhost${path}`, { ...init, headers: { host: 'localhost:4321', ...(init.headers as any) } }), { remoteAddress: init.remote ?? '127.0.0.1' });

test('HTTP local: API, writes need JSON, cross-site writes refused', async () => {
  const board = new Board(':memory:');
  const { ui } = createServers(board, loadConfig({}), { owner: null, verifyToken: null });
  const r = await req(ui, '/api/quick-add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Buy milk tomorrow #errand' }) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.cards[0].title, 'Buy milk');
  assert.ok(j.batch.id);
  assert.equal((await req(ui, '/api/board')).status, 200);
  const form = await req(ui, '/api/quick-add', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(form.status, 415);
  const xs = await req(ui, '/api/quick-add', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"text":"x"}' });
  assert.equal(xs.status, 403);
  const host = await app404(ui);
  assert.equal(host, 403);
  const undo = await req(ui, `/api/activity/${j.batch.id}/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(undo.status, 200);
  assert.equal(board.openCards().length, 0);
});

async function app404(ui: any) {
  const r = await ui.fetch(new Request('http://evil.example/api/board', { headers: { host: 'evil.example' } }), { remoteAddress: '127.0.0.1' });
  return r.status;
}

test('HTTP deployed: password login, remembered session survives a new Owner (restart)', async () => {
  const board = new Board(':memory:');
  const cfg = loadConfig({ HEYANN_PUBLIC_ORIGIN: 'https://heyann.example.ts.net', HEYANN_CREDENTIAL_FILE: '/dev/null', HEYANN_TRUSTED_PROXY: '10.42.0.1' });
  const verifier = await makeVerifier('correct horse battery staple', 100_000);
  const owner = new Owner({ verifier, board });
  const { ui } = createServers(board, cfg, { owner, verifyToken: null });
  const h = { host: 'heyann.example.ts.net', 'x-forwarded-proto': 'https', 'content-type': 'application/json' };
  const call = (path: string, init: RequestInit = {}) => ui.fetch(new Request(`https://heyann.example.ts.net${path}`, { ...init, headers: { ...h, ...(init.headers as any) } }), { remoteAddress: '10.42.0.1' });

  assert.equal((await call('/api/board')).status, 401);
  assert.equal((await ui.fetch(new Request('https://heyann.example.ts.net/api/session', { headers: h }), { remoteAddress: '10.9.9.9' })).status, 403, 'HTTPS only via the trusted proxy');
  const bad = await call('/api/session', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(bad.status, 401);
  const ok = await call('/api/session', { method: 'POST', body: JSON.stringify({ password: 'correct horse battery staple', remember: true }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie')!;
  assert.match(cookie, /__Host-heyann_session=/);
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /HttpOnly/);
  const session = cookie.split(';')[0];
  assert.equal((await call('/api/board', { headers: { cookie: session } })).status, 200);

  // A "restart": new Owner over the same database still accepts the session.
  const owner2 = new Owner({ verifier, board });
  const { ui: ui2 } = createServers(board, cfg, { owner: owner2, verifyToken: null });
  const r2 = await ui2.fetch(new Request('https://heyann.example.ts.net/api/board', { headers: { ...h, cookie: session } }), { remoteAddress: '10.42.0.1' });
  assert.equal(r2.status, 200);
});

test('HTTP MCP listener: OAuth token checks (audience, subject, scope)', async () => {
  const board = new Board(':memory:');
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', use: 'sig', alg: 'ES256' };
  const env = {
    HEYANN_MCP_PORT: '8081', HEYANN_OAUTH_ISSUER: 'https://auth.example/', HEYANN_OAUTH_RESOURCE: 'https://ann-mcp.example/mcp',
    HEYANN_OAUTH_ALLOWED_SUBJECTS: 'owner-1', HEYANN_OAUTH_JWKS_FILE: 'unused', HEYANN_MCP_PUBLIC_ORIGIN: 'https://ann-mcp.example', HEYANN_TRUSTED_PROXY: '127.0.0.1',
  };
  const cfg = loadConfig(env);
  const verify = tokenVerifier(cfg.oauth!, { keys: [jwk as any] });
  const { mcp: app } = createServers(board, cfg, { owner: null, verifyToken: verify });
  const token = (claims: Record<string, unknown>, aud = 'https://ann-mcp.example/mcp') => new SignJWT({ scope: 'heyann.read heyann.write', client_id: 'https://chatgpt.com/oauth/client.json', ...claims })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'k1' }).setIssuer('https://auth.example/').setAudience(aud).setSubject((claims.sub as string) ?? 'owner-1')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const init = { method: 'POST', headers: { host: 'ann-mcp.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } };
  const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const send = async (t?: string) => app!.fetch(new Request('https://ann-mcp.example/mcp', { ...init, body: rpc, headers: { ...init.headers, ...(t ? { authorization: `Bearer ${t}` } : {}) } }), { remoteAddress: '127.0.0.1' });

  const none = await send();
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate')!, /resource_metadata="https:\/\/ann-mcp.example\/.well-known\/oauth-protected-resource"/);
  assert.equal((await send(await token({}, 'https://other/mcp'))).status, 401, 'wrong audience');
  assert.equal((await send(await token({ sub: 'intruder' }))).status, 401, 'wrong subject');
  assert.equal((await send(await token({ scope: 'other.read' }))).status, 403, 'no Hey Ann scope');
  const ok = await send(await token({}));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(body.result.tools.length >= 15);
  const meta = await app!.fetch(new Request('https://ann-mcp.example/.well-known/oauth-protected-resource', { headers: init.headers }), { remoteAddress: '127.0.0.1' });
  assert.deepEqual((await meta.json()).authorization_servers, ['https://auth.example/']);
  const ui = await app!.fetch(new Request('https://ann-mcp.example/api/board', { headers: init.headers }), { remoteAddress: '127.0.0.1' });
  assert.equal(ui.status, 404, 'the MCP listener never serves the API');
});
