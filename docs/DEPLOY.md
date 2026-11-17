# Deploying Hey Ann on Megatron

Hey Ann runs in k3s on Megatron as a hand-reviewed namespace, set up the same way as Socrates.

| | Address | Who can reach it | Auth |
|---|---|---|---|
| UI + API | `https://heyann.tailf67d61.ts.net` | your devices on the tailnet (`tailscale serve`, tailnet policy grant) | password, remembered 30 days per device |
| MCP | `https://heyann-mcp.karthiksurkanti.in/mcp` | the internet, through the Cloudflare tunnel, **only** `/mcp` and `/.well-known/oauth-protected-resource[/mcp]` | Orbit Identity OAuth, owner only |

Both run in one process on two listeners (`:8080` UI, `:8081` MCP). The MCP listener answers 404 to every other path, so a wrong tunnel rule can't expose the UI.

## Security model

- **Pod:** Pod Security `restricted`, read-only root filesystem, no capabilities, non-root `1654`, no service-account token, default-deny NetworkPolicy, and **no egress at all**. Identity's public keys are a mounted ConfigMap, and Hey Ann never calls out.
- **UI listener:**
  - Exact Host allow-list.
  - HTTPS required, judged by `X-Forwarded-Proto` and trusted only from the node (`10.42.0.1`).
  - **Password only; there is no authenticator code.** The UI is reachable only on your tailnet, so tailnet membership is the first factor. Use a long password (`npm run password` insists on 16+ characters).
  - Sessions:
    - "Remember this device" (the default) gives a sliding 30-day cookie, capped at 180 days. Without it, the cookie lasts for the browser session and expires after 12 hours idle.
    - The cookie is `__Host-`, HttpOnly, Secure and SameSite=Strict.
    - Sessions are stored as SHA-256 hashes in SQLite, so restarts don't sign you out.
  - Sign-in is throttled to 8 failures per 15 minutes. Settings → *Sign out everywhere* revokes every device.
  - Writes need a JSON body (which forces a CORS preflight), a matching `Origin`, and no cross-site fetch metadata.
- **MCP listener:**
  - Accepts RFC 9068 access tokens (`typ: at+jwt`), ES256 only, with exact issuer and audience, `exp` required and 60 s of clock skew. Only the owner's `sub` is accepted, and client-credentials tokens are refused.
  - Scopes: `heyann.read` covers the read tools and `heyann.write` covers every tool that changes something. Tools outside the token's scopes are not even listed.
  - A browser `Origin` must be `https://claude.ai` or absent. Bodies are capped at 1 MiB, and requests at 90 per minute.
- **Nothing is hard-deleted over MCP.** Archiving is reversible, every change is recorded with before/after snapshots, and any batch can be undone from Activity.

## What you need

- A PC with Docker, for building the image.
- SSH to Megatron with `sudo`, and `kubectl` there.
- Access to the Tailscale admin console (policy file).
- Optional: a restic backend (Backblaze B2 or S3) for off-node backups.

## 1. Build and import the image

On the PC, in the repository:

```bash
docker build --platform linux/amd64 -t ghcr.io/kar6677thik/hey-ann:candidate .
docker save ghcr.io/kar6677thik/hey-ann:candidate -o hey-ann.tar
scp hey-ann.tar deploy/import-image.sh megatron:/tmp/
```

The build runs the typecheck and the full test suite, and fails if either fails.

On Megatron:

```bash
sudo sh /tmp/import-image.sh ghcr.io/kar6677thik/hey-ann /tmp/hey-ann.tar   # prints the digest (hex)
rm /tmp/hey-ann.tar
```

## 2. Secrets and the key set

Pick a password **separate from Orbit's, Sprawl's and Socrates'**. On the PC:

```bash
npm run password -- ./.owner      # asks twice; writes ./.owner/verifier
```

Copy the file to Megatron, create the Secret, then delete the local copies:

```bash
kubectl create namespace heyann      # step 3's apply adds the Pod Security labels
kubectl -n heyann create secret generic heyann-owner --from-file=verifier=./.owner/verifier
shred -u ./.owner/verifier
```

Orbit Identity's public keys:

```bash
curl -fsS https://auth.karthiksurkanti.in/.well-known/jwks -o jwks.json
kubectl -n heyann create configmap heyann-jwks --from-file=jwks.json
```

Hey Ann refuses to start if the file has no P-256 key, or if it contains a private key.

## 3. Apply

`deploy/heyann.yaml` sets these, so check them first:
- `HEYANN_TIMEZONE`: Asia/Kolkata. It's only the starting value; Settings can change it.
- The owner subject: the same Orbit Identity owner as Socrates.
- ClusterIP `10.43.0.106`.

```bash
kubectl get svc -A -o wide | grep '10.43.0.10'        # 10.43.0.106 must be free
sed "s/IMAGE_DIGEST/<digest from step 1>/" deploy/heyann.yaml > /tmp/heyann.yaml
kubectl apply --dry-run=server -f /tmp/heyann.yaml
kubectl apply -f /tmp/heyann.yaml
kubectl -n heyann rollout status deploy/heyann
```

## 4. Tailnet access (UI)

1. In the Tailscale admin console, go to Access controls. Add these next to `svc:socrates`, without touching anything else:
   - in `grants`: `{ "src": ["<your login>"], "dst": ["svc:heyann"], "ip": ["tcp:443"] }`
   - in `autoApprovers.services`: `"svc:heyann": ["tag:megatron"]`
2. On Megatron:
   ```bash
   sudo tailscale serve --service=svc:heyann --https=443 http://10.43.0.106:8080
   tailscale funnel status        # heyann must NOT be listed
   ```
3. Open `https://heyann.tailf67d61.ts.net`, sign in, and keep "Remember this device" ticked. On your phone, use the browser's "Add to Home Screen".

Never use `tailscale funnel` for Hey Ann.

## 5. Public MCP (Orbit Identity)

The Orbit Cloud thread does these, with your OK, in this order:

1. **Identity resource:** add it to `deploy/identity/identity.yaml` in orbit-cloud, using the next free index (Socrates is `2`), then release Identity:
   ```yaml
   - { name: Identity__Resources__3__Uri, value: "https://heyann-mcp.karthiksurkanti.in/mcp" }
   - { name: Identity__Resources__3__Name, value: "Hey Ann" }
   - { name: Identity__Resources__3__Scopes__0, value: heyann.read }
   - { name: Identity__Resources__3__Scopes__1, value: heyann.write }
   ```
   There's no `heyann.admin` scope, because no tool hard-deletes anything.
2. **Tunnel route:** add this to Megatron's `~/.cloudflared/config.yml`, above the catch-all:
   ```yaml
   - hostname: heyann-mcp.karthiksurkanti.in
     path: ^/(mcp|\.well-known/oauth-protected-resource(/mcp)?)$
     service: http://10.43.0.106:8081
   - hostname: heyann-mcp.karthiksurkanti.in
     service: http_status:404
   ```
   Then:
   - run `cloudflared tunnel route dns main heyann-mcp.karthiksurkanti.in`;
   - restart the tunnel service;
   - add the `deploy/routes.json` entry, the uptime probe on the protected-resource URL, and the Orbit console namespace.
3. **Connect:** see [SETUP-CLIENTS.md](SETUP-CLIENTS.md). Check that the consent screen offers only `heyann.*`, and that revoking the grant in Orbit → Identity cuts access.

## 6. Backups

Once a day, shortly after 00:00 UTC, the app writes a verified copy to `/data/backups` (`VACUUM INTO` + `PRAGMA integrity_check`). It keeps 14 and records the result in `backup-status.json`. It also takes a copy before every schema upgrade. Settings → Data → *Back up now* makes one on demand.

**Off-node:** create the restic Secret, then apply the CronJob (runs 02:30 UTC daily):

```bash
kubectl -n heyann create secret generic heyann-backup \
  --from-literal=RESTIC_REPOSITORY='s3:https://<endpoint>/<bucket>/heyann' \
  --from-literal=RESTIC_PASSWORD='<long random; keep it in your password manager>' \
  --from-literal=AWS_ACCESS_KEY_ID='…' --from-literal=AWS_SECRET_ACCESS_KEY='…'
kubectl apply -f deploy/backup.yaml
kubectl -n heyann create job --from=cronjob/heyann-backup heyann-backup-first
kubectl -n heyann logs -f job/heyann-backup-first
```

### Restore

Test this once before relying on it. The steps are at the top of `deploy/restore.yaml`: scale to zero, run the job, scale back. The current database is moved to `/data/pre-restore/`, never deleted.

## 7. Checks after install

- **From your laptop:**
  - The UI without a session shows the sign-in screen.
  - `curl https://heyann.tailf67d61.ts.net/api/board` returns 401.
  - A different Host is refused: `curl -k -H 'Host: x' https://heyann.tailf67d61.ts.net/api/board` returns 403.
- **Service account:** `kubectl auth can-i --list --as=system:serviceaccount:heyann:heyann -n heyann` shows nothing beyond the defaults.
- **No egress from the pod:** `kubectl -n heyann exec deploy/heyann -- node -e "fetch('https://example.com').then(()=>console.log('OPEN'),()=>console.log('blocked'))"` prints `blocked`.
- **After step 5:**
  - `curl -s https://heyann-mcp.karthiksurkanti.in/.well-known/oauth-protected-resource` shows the metadata.
  - `curl -si https://heyann-mcp.karthiksurkanti.in/mcp` returns 401 with `WWW-Authenticate`.
  - `https://heyann-mcp.karthiksurkanti.in/` returns 404.

## Updating

Build, import and apply with the new digest (steps 1 and 3). `Recreate` stops the old pod before the new one opens the database, and schema upgrades take a backup first. Open browser tabs reconnect their live-update stream on their own.

## Rotating Identity's signing key

1. Add the new key to Identity as a secondary key. It's published but doesn't sign yet.
2. Refresh the ConfigMap and restart Hey Ann:
   ```bash
   curl -fsS https://auth.karthiksurkanti.in/.well-known/jwks -o jwks.json
   kubectl -n heyann create configmap heyann-jwks --from-file=jwks.json --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n heyann rollout restart deploy/heyann
   ```
3. Only then make the new key the signer in Identity.

## Environment reference

| Variable | Meaning |
|---|---|
| `HEYANN_PUBLIC_ORIGIN` | UI origin. Turns on deployed mode: login required, HTTPS required, no local-token MCP. |
| `HEYANN_ALLOWED_HOSTS` | Extra exact Host values for the UI (comma-separated). localhost is always allowed (probes). |
| `HEYANN_TRUSTED_PROXY` | Addresses whose `X-Forwarded-Proto` is believed. |
| `HEYANN_CREDENTIAL_FILE` | Owner password verifier (Identity V3 format). |
| `HEYANN_MCP_PORT`, `HEYANN_MCP_PUBLIC_ORIGIN`, `HEYANN_MCP_ALLOWED_ORIGINS` | The OAuth MCP listener. |
| `HEYANN_OAUTH_ISSUER`, `HEYANN_OAUTH_RESOURCE`, `HEYANN_OAUTH_ALLOWED_SUBJECTS`, `HEYANN_OAUTH_JWKS_FILE` | Token checks. `HEYANN_OAUTH_ALLOWED_CLIENTS` can also limit which client ids are accepted. |
| `HEYANN_DATA` | Data directory (database and backups). |
| `HEYANN_TIMEZONE` | Initial timezone for date phrases; Settings overrides it. |

Startup refuses incomplete or unsafe combinations, for example a deployed origin without the password file, a non-https origin, or OAuth without the owner subject.
