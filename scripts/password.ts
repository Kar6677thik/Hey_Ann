// Create the owner password file for a deployed Hey Ann.
//   node --no-warnings scripts/password.ts ./.owner
// Writes <dir>/verifier (ASP.NET Core Identity V3 format, the same as orbit-cloud's Orbit.Credentials).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { makeVerifier } from '../src/server/owner.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node --no-warnings scripts/password.ts <output-dir>');
  process.exit(2);
}

async function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Don't echo the password.
  (rl as any)._writeToOutput = (s: string) => { if (s.includes(q)) process.stdout.write(s); };
  const a = await new Promise<string>((r) => rl.question(q, r));
  rl.close();
  process.stdout.write('\n');
  return a;
}

const pw = await ask('New Hey Ann password (16+ characters): ');
if (pw.length < 16) {
  console.error('Use at least 16 characters: there is no second factor.');
  process.exit(1);
}
if ((await ask('Again: ')) !== pw) {
  console.error('The passwords do not match.');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'verifier'), await makeVerifier(pw), { mode: 0o600 });
console.log(`Wrote ${join(dir, 'verifier')}. Create the Secret from it, then delete the file.`);
