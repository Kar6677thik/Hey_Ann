// Owner login for the UI listener: one password, no authenticator code. The UI is reachable only on the tailnet, so a
// strong password plus a long-lived, per-device session is the right trade: sign in once per device, stay signed in.
// The password file uses the ASP.NET Core Identity V3 format (orbit-cloud's Orbit.Credentials writes the same).
// Sessions live in SQLite as SHA-256 hashes, so they survive restarts and a database leak doesn't leak cookies.
import { openSync, readSync, closeSync } from 'node:fs';
import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Board } from '../core/board.ts';

const pbkdf2Async = promisify(pbkdf2);

/**
 * Read a small secret file. Kubernetes Secret keys are symlinks, so bound what the opened file yields rather than
 * trusting a stat of the path.
 */
export function readBounded(path: string, min: number, max: number, error: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    for (let r; n < buf.length && (r = readSync(fd, buf, n, buf.length - n, null)) > 0;) n += r;
    if (n < min || n > max) throw new Error(error);
    return buf.subarray(0, n).toString('utf8').trim();
  } catch (e: any) {
    throw new Error(e.message === error ? error : `${error} (${e.code ?? e.message})`);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

// ---- Password: ASP.NET Core Identity V3 hash (0x01 | prf u32 | iterations u32 | salt length u32 | salt | subkey)

const PRF: Record<number, string> = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };

export interface Verifier { digest: string; iterations: number; salt: Buffer; subkey: Buffer }

export function parseVerifier(text: string): Verifier {
  const b = Buffer.from(text, 'base64');
  if (b.length < 13 || b[0] !== 1) throw new Error('Owner verifier must use the Identity V3 format.');
  const prf = b.readUInt32BE(1), iterations = b.readUInt32BE(5), saltLen = b.readUInt32BE(9);
  if (!(prf in PRF) || iterations < 100_000 || iterations > 1_000_000 || saltLen < 16 || saltLen > 128 || b.length < 13 + saltLen + 32)
    throw new Error('Owner verifier must use the Identity V3 format and a bounded work factor.');
  return { digest: PRF[prf], iterations, salt: b.subarray(13, 13 + saltLen), subkey: b.subarray(13 + saltLen) };
}

export async function verifyPassword(v: Verifier, password: string): Promise<boolean> {
  const derived = await pbkdf2Async(Buffer.from(password, 'utf8'), v.salt, v.iterations, v.subkey.length, v.digest);
  return timingSafeEqual(derived, v.subkey);
}

/** Make a verifier in the same format (PBKDF2-HMAC-SHA512, 600k iterations, 16-byte salt, 32-byte subkey). */
export async function makeVerifier(password: string, iterations = 600_000): Promise<string> {
  const salt = randomBytes(16);
  const subkey = await pbkdf2Async(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha512');
  const head = Buffer.alloc(13);
  head[0] = 1;
  head.writeUInt32BE(2, 1);
  head.writeUInt32BE(iterations, 5);
  head.writeUInt32BE(16, 9);
  return Buffer.concat([head, salt, subkey]).toString('base64');
}

// ---- The owner

export const SESSION_COOKIE = '__Host-heyann_session';
/** "Remember this device": sliding 30 days, at most 180 days from sign-in. */
export const REMEMBER_IDLE_MS = 30 * 864e5;
const REMEMBER_ABSOLUTE_MS = 180 * 864e5;
/** Otherwise: a browser-session cookie, 12 h idle. */
const SESSION_IDLE_MS = 12 * 3600_000;
const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;

export type LoginResult = { ok: true; session: string; persistent: boolean } | { ok: false; status: 401 | 429; error: string };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class Owner {
  private verifier: Verifier;
  private failures: number[] = [];
  private hashing = 0;
  private board: Board;
  private now: () => number;

  constructor(opts: { verifier: string; board: Board; now?: () => number }) {
    this.verifier = parseVerifier(opts.verifier);
    this.board = opts.board;
    this.now = opts.now ?? Date.now;
  }

  static fromFile(credentialFile: string, board: Board): Owner {
    return new Owner({ verifier: readBounded(credentialFile, 20, 1024, 'Owner verifier file is missing or invalid.'), board });
  }

  private locked(): boolean {
    const cutoff = this.now() - FAIL_WINDOW_MS;
    this.failures = this.failures.filter((t) => t >= cutoff);
    return this.failures.length >= MAX_FAILURES;
  }

  async login(password: unknown, remember: unknown): Promise<LoginResult> {
    if (this.locked()) return { ok: false, status: 429, error: 'Too many failed sign-ins. Wait 15 minutes.' };
    if (typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) {
      this.failures.push(this.now());
      return { ok: false, status: 401, error: 'Wrong password.' };
    }
    if (this.hashing >= 2) return { ok: false, status: 429, error: 'Please wait before signing in again.' };
    this.hashing++;
    let ok: boolean;
    try {
      ok = await verifyPassword(this.verifier, password);
    } finally {
      this.hashing--;
    }
    if (!ok) {
      this.failures.push(this.now());
      return { ok: false, status: 401, error: 'Wrong password.' };
    }
    this.failures = [];
    const session = randomBytes(32).toString('base64url');
    const persistent = remember !== false;
    this.board.sessionCreate(hash(session), persistent, this.now());
    this.board.sessionPrune(this.now() - REMEMBER_IDLE_MS);
    return { ok: true, session, persistent };
  }

  /** The session's persistence if it is live (refreshing its idle timer), else null. */
  check(session: string | undefined): { persistent: boolean } | null {
    if (!session || session.length > 100) return null;
    const h = hash(session);
    const s = this.board.sessionGet(h);
    if (!s) return null;
    const t = this.now();
    const idle = s.persistent ? REMEMBER_IDLE_MS : SESSION_IDLE_MS;
    if (t - s.seen_at > idle || (s.persistent && t - s.created_at > REMEMBER_ABSOLUTE_MS)) {
      this.board.sessionDelete(h);
      return null;
    }
    // Write at most once a minute.
    if (t - s.seen_at > 60_000) this.board.sessionTouch(h, t);
    return { persistent: !!s.persistent };
  }

  logout(session: string | undefined) {
    if (session) this.board.sessionDelete(hash(session));
  }

  /** Sign out every device. */
  logoutAll() {
    this.board.sessionPrune(Number.MAX_SAFE_INTEGER);
  }
}
