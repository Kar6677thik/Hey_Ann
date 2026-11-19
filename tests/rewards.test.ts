import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT, type JWK } from 'jose';
import { Board } from '../src/core/board.ts';
import { getWallet, type StudyEventIn } from '../src/core/wallet.ts';
import { parseRewardsJwks, rewardVerifier, rewardsServer } from '../src/server/rewards.ts';
import { loadConfig } from '../src/server/config.ts';

const web = { actor: 'web' as const, action: 'web:test' };
const T0 = Date.UTC(2026, 10, 19, 6, 0); // 11:30 in Kolkata
const MIN = 60000;

async function key() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);
  return { privateKey, jwk: { ...jwk, kid, use: 'sig', alg: 'ES256' } as JWK, kid };
}

function setup(opts: { start?: boolean } = {}) {
  const b = new Board(':memory:');
  b.batch(web, (tx) => tx.updateSettings({ timezone: 'Asia/Kolkata' }));
  const w = getWallet(b);
  if (opts.start !== false) w.start({ baseline: false });
  return { b, w };
}

const study = (n: number, minutes: number, start = T0 - 3 * 3600_000, extra: Partial<StudyEventIn> = {}) => ({
  event_id: `socrates:study:${n}`, kind: 'study_minutes', day: '2026-11-19', occurred_at: start + minutes * MIN,
  minutes, intervals: [[start, start + minutes * MIN]], session_id: n, attempts_credited: 4, pending: 0, ...extra,
});
const mastery = (tag: number, threshold = 70) => ({
  event_id: `socrates:mastery:${tag}:${threshold}`, kind: 'mastery_up', day: '2026-11-19', occurred_at: T0,
  tag: { id: tag, path: `math/t${tag}`, title: `topic ${tag}` }, threshold,
});
/** Ledger rows Socrates caused, oldest first. */
const rows = (w: ReturnType<typeof getWallet>) => w.ledger({ limit: 100 }).filter((r) => r.source === 'socrates').map((r) => `${r.kind}:${r.amount}`).reverse();

test('rewards pricing: x0.25 per study day, 30/day study cap, mastery +3, exactly once', () => {
  const { w } = setup();
  const bal = w.balance();
  assert.deepEqual(w.applyStudyEvent(study(1, 6) as StudyEventIn, T0), { status: 'applied', credited: 1, note: '' });
  // 6 + 6 = 12 study minutes that day: floor(3) = 3 in all, 2 more.
  assert.equal(w.applyStudyEvent(study(2, 6, T0 - 2 * 3600_000) as StudyEventIn, T0).credited, 2);
  assert.equal(w.applyStudyEvent(study(2, 6, T0 - 2 * 3600_000) as StudyEventIn, T0).status, 'duplicate');
  // A big day: capped at 30 for the study day, whatever else comes.
  assert.equal(w.applyStudyEvent(study(3, 170, T0 - 9 * 3600_000) as StudyEventIn, T0).credited, 27);
  const capped = w.applyStudyEvent(study(4, 40, T0 - 1 * 3600_000) as StudyEventIn, T0);
  assert.equal(capped.credited, 0);
  assert.match(capped.note, /study limit/);
  // Another study day has its own sub-cap.
  assert.equal(w.applyStudyEvent({ ...study(5, 8), day: '2026-11-18' } as StudyEventIn, T0).credited, 2);
  assert.equal(w.applyStudyEvent(mastery(37) as StudyEventIn, T0).credited, 3);
  assert.deepEqual(rows(w), ['study:1', 'study:2', 'study:27', 'study:0', 'study:2', 'mastery:3']);
  assert.equal(w.balance(), bal + 35);
  assert.equal(w.summary(T0).today.earned, 35);
});

test('rewards: study overlapping a focus timer or a phone session is voided; baseline and wallet-off pay 0', () => {
  const { b, w } = setup();
  const s = T0 - 4 * 3600_000;
  b.db.prepare('INSERT INTO focus_log(card_id, started_at, ended_at, minutes) VALUES (1, ?, ?, 20)').run(s, s + 20 * MIN);
  b.db.prepare("INSERT INTO phone_sessions(device_id, app, kind, started_at, ends_at, stopped_at) VALUES (1, 'x', 'spend', ?, ?, NULL)").run(s + 30 * MIN, s + 40 * MIN);
  // 40 min of study: 20 under focus, 10 under the phone session -> 10 min left -> floor(2.5) = 2.
  const r = w.applyStudyEvent(study(1, 40, s) as StudyEventIn, T0);
  assert.equal(r.credited, 2);
  assert.match(r.note, /30 min overlapped/);
  assert.equal(w.applyStudyEvent({ ...mastery(5), baseline: true } as StudyEventIn, T0).credited, 0);

  const off = setup({ start: false }).w;
  const o = off.applyStudyEvent(study(9, 20) as StudyEventIn, T0);
  assert.deepEqual([o.status, o.credited, o.note], ['applied', 0, 'wallet off']);
  assert.equal(off.applyStudyEvent(study(9, 20) as StudyEventIn, T0).status, 'duplicate');
});

test('rewards: mastery shares the 3-a-day bonus limit with card bonuses', () => {
  const { w } = setup();
  for (const t of [1, 2, 3]) assert.equal(w.applyStudyEvent(mastery(t) as StudyEventIn, T0).credited, 3);
  const fourth = w.applyStudyEvent(mastery(4) as StudyEventIn, T0);
  assert.equal(fourth.credited, 0);
  assert.match(fourth.note, /bonus limit/);
});

test('rewards listener: verifies the signed push, applies once, refuses everything else', async () => {
  const { b, w } = setup();
  const k = await key();
  const other = await key();
  const verify = rewardVerifier(() => parseRewardsJwks(JSON.stringify({ keys: [k.jwk] })));
  const app = rewardsServer(b, verify);
  const nowS = Math.floor(Date.now() / 1000);
  const sign = (event: Record<string, unknown>, o: { kid?: string; priv?: CryptoKey; aud?: string; iss?: string; typ?: string; jti?: string; iat?: number; exp?: number } = {}) =>
    new SignJWT({ event })
      .setProtectedHeader({ alg: 'ES256', typ: o.typ ?? 'reward+jwt', kid: o.kid ?? k.kid })
      .setIssuer(o.iss ?? 'socrates').setAudience(o.aud ?? 'heyann-rewards').setJti(o.jti ?? (event.event_id as string))
      .setIssuedAt(o.iat ?? nowS).setExpirationTime(o.exp ?? (o.iat ?? nowS) + 300)
      .sign(o.priv ?? k.privateKey);
  const post = (body: string, path = '/internal/rewards', type = 'application/jose') =>
    app.fetch(new Request(`http://heyann:8082${path}`, { method: 'POST', headers: { 'content-type': type }, body }));
  const s = Date.now() - 3 * 3600_000;
  const ev = study(1, 8, s);

  const ok = await post(await sign(ev));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 'applied' });
  // Socrates retries the same event re-signed with a fresh iat/exp: no second payment.
  const again = await post(await sign(ev, { iat: nowS + 1 }));
  assert.deepEqual([again.status, await again.json()], [200, { status: 'duplicate' }]);
  assert.equal(rows(w).length, 1);

  const refused: [string, Promise<string>][] = [
    ['bad signature', sign(ev, { priv: other.privateKey })],
    ['unknown kid', sign(ev, { kid: other.kid, priv: other.privateKey })],
    ['wrong aud', sign(ev, { aud: 'heyann-mcp' })],
    ['wrong iss', sign(ev, { iss: 'slate' })],
    ['wrong typ', sign(ev, { typ: 'JWT' })],
    ['expired', sign(ev, { iat: nowS - 900, exp: nowS - 600 })],
    ['iat in the future', sign(ev, { iat: nowS + 600 })],
    ['lifetime too long', sign(ev, { exp: nowS + 3600 })],
    ['jti mismatch', sign(study(2, 5, s), { jti: 'socrates:study:999' })],
  ];
  for (const [name, jws] of refused) assert.equal((await post(await jws)).status, 401, name);
  assert.equal((await post('not a jws')).status, 401);

  const bad: [string, Record<string, unknown>][] = [
    ['minutes beyond intervals', { ...study(3, 8, s), minutes: 30 }],
    ['unknown kind', { ...study(4, 8, s), kind: 'focus_minutes' }],
    ['bad day', { ...study(5, 8, s), day: '19/11/2026' }],
    ['bad threshold', { ...mastery(7), threshold: 60 }],
  ];
  for (const [name, e] of bad) assert.equal((await post(await sign(e))).status, 422, name);

  assert.equal((await post(await sign(study(6, 8, s)), '/internal/rewards', 'application/json')).status, 415);
  assert.equal((await post('x'.repeat(17 * 1024))).status, 413);
  for (const path of ['/', '/mcp', '/api/board', '/internal/rewards/x', '/health/live']) assert.equal((await post('x', path)).status, 404, path);
  assert.equal((await app.fetch(new Request('http://heyann:8082/internal/rewards'))).status, 404, 'GET');
  assert.deepEqual(rows(w), ['study:2']);
});

test('rewards config: port and key file together; the key file holds public ES256 keys with kids', async () => {
  assert.throws(() => loadConfig({ HEYANN_REWARDS_PORT: '8082' }), /together/);
  assert.equal(loadConfig({ HEYANN_REWARDS_PORT: '8082', HEYANN_REWARDS_JWKS_FILE: '/x' }).rewardsPort, 8082);
  const k = await key();
  assert.equal(parseRewardsJwks(JSON.stringify({ keys: [k.jwk] })).keys.length, 1);
  assert.throws(() => parseRewardsJwks(JSON.stringify({ keys: [k.jwk, k.jwk, k.jwk, k.jwk] })), /1 to 3/);
  assert.throws(() => parseRewardsJwks(JSON.stringify({ keys: [{ ...k.jwk, d: 'secret' }] })), /private key/);
  assert.throws(() => parseRewardsJwks(JSON.stringify({ keys: [{ ...k.jwk, kid: undefined }] })), /kid/);
});
