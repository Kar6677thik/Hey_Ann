// The study-rewards intake (Orbit Hub M4, docs/REWARDS.md §10): Socrates pushes each study event as a compact JWS
// signed with its own ES256 key. Its own listener, never routed or tunnelled; NetworkPolicy admits only the Socrates pod.
//
//   POST /internal/rewards   Content-Type: application/jose   body: one compact JWS (≤ 16 KB)
//   200 {"status":"applied"|"duplicate"}   401 signature/claims   422 schema   503 transient (Socrates retries)
//
// The model never carries an award: only a signature from a key in HEYANN_REWARDS_JWKS_FILE pays anything.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync, statSync } from 'node:fs';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { z } from 'zod';
import type { Board } from '../core/board.ts';
import { getWallet, type StudyEventIn } from '../core/wallet.ts';

export const REWARDS_ISSUER = 'socrates';
export const REWARDS_AUDIENCE = 'heyann-rewards';
export const REWARDS_TYP = 'reward+jwt';
const MAX_KEYS = 3;
const SKEW_S = 60;
const MAX_LIFETIME_S = 300;

/** Socrates' public keys: at most 3 (rotation overlap), ES256 public keys with a kid, never a private key. */
export function parseRewardsJwks(text: string): JSONWebKeySet {
  const jwks = JSON.parse(text) as JSONWebKeySet;
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  if (keys.length === 0 || keys.length > MAX_KEYS) throw new Error(`The rewards JWKS must hold 1 to ${MAX_KEYS} keys.`);
  for (const k of keys) {
    if ('d' in k) throw new Error('The rewards JWKS contains a private key. Mount the public key set only.');
    if (k.kty !== 'EC' || k.crv !== 'P-256' || (k.alg !== undefined && k.alg !== 'ES256') || (k.use !== undefined && k.use !== 'sig'))
      throw new Error('Every rewards key must be an ES256 (EC P-256) signing key.');
    if (typeof k.kid !== 'string' || !k.kid) throw new Error('Every rewards key needs a kid.');
  }
  return { keys };
}

/** Reads the key file, re-reading it when the mounted ConfigMap changes (key rotation without a restart). */
export function fileKeys(path: string): () => JSONWebKeySet {
  let cached: { mtime: number; jwks: JSONWebKeySet } | null = null;
  const load = () => {
    const mtime = statSync(path).mtimeMs;
    if (!cached || cached.mtime !== mtime) cached = { mtime, jwks: parseRewardsJwks(readFileSync(path, 'utf8')) };
    return cached.jwks;
  };
  load(); // fail fast at startup
  return load;
}

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MS = z.number().int().min(1e12).max(1e14);
const COMMON = {
  event_id: z.string().regex(/^socrates:[A-Za-z0-9:._-]{1,180}$/),
  day: DAY,
  occurred_at: MS,
  baseline: z.boolean().optional(),
};
const STUDY = z.object({
  ...COMMON,
  kind: z.literal('study_minutes'),
  minutes: z.number().min(0).max(180),
  intervals: z.array(z.tuple([MS, MS]).refine(([a, b]) => a < b, 'interval start must be before its end')).max(1000),
  session_id: z.number().int().nonnegative(),
  attempts_credited: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  supplement: z.boolean().optional(),
}).refine((e) => e.minutes * 60000 <= e.intervals.reduce((n, [a, b]) => n + (b - a), 0) + 1000, 'minutes exceed the credited intervals');
const MASTERY = z.object({
  ...COMMON,
  kind: z.literal('mastery_up'),
  tag: z.object({ id: z.number().int().nonnegative(), path: z.string().min(1).max(500), title: z.string().min(1).max(200) }),
  threshold: z.union([z.literal(50), z.literal(70), z.literal(85)]),
});
export const STUDY_EVENT = z.discriminatedUnion('kind', [STUDY as any, MASTERY]);

type Check = { ok: true; event: StudyEventIn } | { ok: false; status: 401 | 422; reason: string };

/** Signature → typ → iss → aud → exp (60 s skew) → iat not in the future → jti = event.event_id → event schema. */
export function rewardVerifier(keys: () => JSONWebKeySet) {
  return async (jws: string, now = Date.now()): Promise<Check> => {
    let payload: JWTPayload;
    try {
      const h = decodeProtectedHeader(jws);
      if (h.alg !== 'ES256' || typeof h.kid !== 'string' || !h.kid) return { ok: false, status: 401, reason: 'header needs alg ES256 and a kid' };
      const set = keys();
      if (!set.keys.some((k) => k.kid === h.kid)) return { ok: false, status: 401, reason: 'unknown kid' };
      ({ payload } = await jwtVerify(jws, createLocalJWKSet(set), {
        algorithms: ['ES256'],
        typ: REWARDS_TYP,
        issuer: REWARDS_ISSUER,
        audience: REWARDS_AUDIENCE,
        clockTolerance: SKEW_S,
        currentDate: new Date(now),
        requiredClaims: ['iss', 'aud', 'exp', 'iat', 'jti'],
      }));
    } catch (e: any) {
      return { ok: false, status: 401, reason: e.code ?? e.message ?? 'invalid token' };
    }
    const nowS = now / 1000;
    if (payload.iat! > nowS + SKEW_S) return { ok: false, status: 401, reason: 'iat is in the future' };
    if (payload.exp! - payload.iat! > MAX_LIFETIME_S) return { ok: false, status: 401, reason: `lifetime over ${MAX_LIFETIME_S} s` };
    const ev = (payload as { event?: unknown }).event;
    const id = ev && typeof ev === 'object' ? (ev as { event_id?: unknown }).event_id : undefined;
    if (payload.jti !== id) return { ok: false, status: 401, reason: 'jti does not match event.event_id' };
    const parsed = STUDY_EVENT.safeParse(ev);
    if (!parsed.success) return { ok: false, status: 422, reason: parsed.error.issues.map((i) => `${i.path.join('.') || 'event'}: ${i.message}`).join('; ') };
    return { ok: true, event: parsed.data as StudyEventIn };
  };
}

export function rewardsServer(board: Board, verify: ReturnType<typeof rewardVerifier>): Hono {
  const wallet = getWallet(board);
  const app = new Hono();
  app.post(
    '/internal/rewards',
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }),
    async (c) => {
      const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/jose') return c.json({ error: 'Content-Type must be application/jose.' }, 415);
      const jws = (await c.req.text()).trim();
      const r = await verify(jws);
      if (!r.ok) {
        console.warn(`[rewards] refused (${r.status}): ${r.reason}`);
        return c.json({ error: r.status === 401 ? 'Signature or claims rejected.' : 'Invalid event.', reason: r.reason }, r.status);
      }
      try {
        const out = wallet.applyStudyEvent(r.event);
        console.log(`[rewards] ${r.event.event_id}: ${out.status}${out.status === 'applied' ? `, +${out.credited} min${out.note ? ` (${out.note})` : ''}` : ''}`);
        return c.json({ status: out.status });
      } catch (e: any) {
        console.error(`[rewards] ${r.event.event_id} failed:`, e);
        return c.json({ error: 'Temporary failure; retry.' }, 503);
      }
    },
  );
  app.all('*', (c) => c.json({ error: 'Not found' }, 404));
  return app;
}
