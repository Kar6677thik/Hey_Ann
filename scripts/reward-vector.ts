// A live end-to-end check of the rewards intake that cannot pay anything.
//
//   npm run reward-vector -- --key ./test-key.json     (creates the key file if it doesn't exist)
//
// Prints:
//   1. the PUBLIC test key: add it as a second entry in ConfigMap heyann-rewards-jwks (up to 3 keys are accepted;
//      Hey Ann picks the change up without a restart once the mounted file updates);
//   2. a signed test event, valid for 5 minutes: a mastery_up marked "baseline", which Hey Ann records with 0 minutes.
//      Posting it twice returns {"status":"applied"} then {"status":"duplicate"}.
// Remove the test key from the ConfigMap afterwards and delete the key file. Never commit it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose';

const i = process.argv.indexOf('--key');
const file = i > 0 ? process.argv[i + 1] : null;
if (!file) {
  console.error('Usage: npm run reward-vector -- --key <path to a private key file; created if missing>');
  process.exit(2);
}

let priv: JWK;
if (existsSync(file)) priv = JSON.parse(readFileSync(file, 'utf8'));
else {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  priv = await exportJWK(privateKey);
  writeFileSync(file, JSON.stringify(priv), { mode: 0o600 });
  console.error(`Created ${file} (private; delete it when done).`);
}
const pub: JWK = { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y };
const kid = await calculateJwkThumbprint(pub);
const now = Math.floor(Date.now() / 1000);
const event = {
  event_id: `socrates:test:${now}`, kind: 'mastery_up', day: new Date().toISOString().slice(0, 10), occurred_at: Date.now(),
  tag: { id: 0, path: 'test/intake', title: 'intake check' }, threshold: 50, baseline: true,
};
const jws = await new SignJWT({ event })
  .setProtectedHeader({ alg: 'ES256', typ: 'reward+jwt', kid })
  .setIssuer('socrates').setAudience('heyann-rewards').setJti(event.event_id).setIssuedAt(now).setExpirationTime(now + 300)
  .sign(await importJWK(priv, 'ES256'));

console.log('Public key (add to heyann-rewards-jwks "keys"):');
console.log(JSON.stringify({ ...pub, kid, use: 'sig', alg: 'ES256' }));
console.log(`\nSigned test event ${event.event_id} (expires in 5 min):`);
console.log(jws);
console.log('\nFrom the Socrates pod:');
console.log(`node -e "fetch('http://heyann.heyann.svc:8082/internal/rewards',{method:'POST',headers:{'content-type':'application/jose'},body:process.argv[1]}).then(async r=>console.log(r.status,await r.text()))" '${jws}'`);
