# Hey Ann HTTP API

This is the API the web UI uses. Every route is under `/api`. Types are in [`src/core/types.ts`](../src/core/types.ts).

- **Writes** (`POST`, `PATCH`, `PUT`, `DELETE`) must send `Content-Type: application/json` (a `{}` body is fine).
- **Errors** come back as `{ error: string, details? }`, with status 400, 401, 404, 409 or 500.
- **Sign-in:** a 401 with `code: "signin"` means the UI should show the sign-in screen.
- **Undo:** every write response includes `batch` (a `Batch`), so the UI can show a toast with an Undo button.

## Session

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/session` | | `{ signedIn, loginRequired }` (local dev: `loginRequired: false`) |
| POST | `/session` | `{ password, remember?: boolean }` | `{ signedIn: true }`. With `remember`, the cookie lasts 30 days (sliding); without it, it's a browser-session cookie |
| DELETE | `/session` | | `{ signedIn: false }` |

## Board and cards

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/board` | | `BoardSnapshot` |
| GET | `/cards` | `q` (full-text), `column` (id), `project` (id), `tag`, `priority` (0–3), `due` (`overdue\|today\|week\|none`), `blocked=1`, `archived=1` (archived only), `limit`, `offset` | `{ items: Card[], total }` |
| GET | `/cards/:id` | | `{ card: Card, activity: Batch[] }` (the batches that touched it, newest first) |
| POST | `/cards` | `CardInput` or `{ items: CardInput[] }` | `{ cards: Card[], batch }` |
| PATCH | `/cards/:id` | `CardPatch` | `{ card, batch }` |
| POST | `/cards/:id/move` | `{ column_id, before_id?: number \| null, after_id?: number \| null }`: the neighbours it was dropped between | `{ card, batch, wip_warning?: string }` |
| POST | `/cards/archive` | `{ ids: number[] }` | `{ cards, batch }` |
| POST | `/cards/restore` | `{ ids: number[] }` | `{ cards, batch }` |
| DELETE | `/cards/:id` | | `{ ok, batch }`. Permanent delete, **archived cards only** |
| POST | `/cards/:id/focus` | `{ action: 'start' \| 'stop' }` | `{ card, batch, logged_min? }`. Starting moves the card to the first `doing` column if it's in backlog or todo, and stops any other running focus |
| POST | `/cards/:id/log` | `{ minutes }` | `{ card, batch }`. Manual time log |
| POST | `/cards/:id/duplicate` | | `{ card, batch }` |

**`CardInput`** (only `title` is required):
- `title`, `notes`, `column_id` (default: the first `todo` column), `priority`
- `due`: a natural-language phrase like `"next friday 5pm"`, or ISO
- `due_at` (ms), `planned_for` (`YYYY-MM-DD`, or `"today"`), `estimate_min`
- `project` (name; created if new), `project_id`, `tags` (names)
- `checklist` (array of strings), `links`, `blocked_reason`
- `recurrence`: a phrase like `"every weekday"`, or a `Recurrence` object

**`CardPatch`** takes any `CardInput` field (`null` clears it), plus:
- `version`: optimistic concurrency, returns 409 on mismatch
- `checklist_ops`: `[{ op: 'add', text } | { op: 'toggle' | 'remove', id } | { op: 'edit', id, text }]`
- `append_note` (string)

## Natural language

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/parse` | `{ text }` | `ParsedInput` (a live preview while typing) |
| POST | `/quick-add` | `{ text, column_id? }` | `{ cards: Card[], batch }` |

Quick-add syntax:
- `!p0`–`!p3` or `!urgent`, `!high`, `!low`: priority
- `#tag`: tag
- `@project`: project
- `~2h` or `~30m`: estimate
- `*today`: plan it for today
- `every …`: recurrence
- Any date phrase: due date

`/quick-add` splits lines (and `;`) into separate cards.

## Planning, summaries, insights

| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/next` | `minutes?`, `context?` | `{ items: RankedCard[] }` (top 5) |
| GET | `/plan` | `date?` | `DayPlan` (a proposal) |
| POST | `/plan` | `{ ids: number[], date? }` | `{ cards, batch }`. Sets `planned_for` and clears it on cards not in `ids` that were planned for that date |
| GET | `/summary` | `kind=standup\|daily\|weekly` | `Summary` |
| GET | `/insights` | `days=30` | `Insights` |
| GET | `/triage` | | `{ overdue: Card[], stale: Card[], blocked: Card[], unplanned_urgent: Card[], suggestions: { card_id, action, reason }[] }` |

## Activity and undo

| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/activity` | `limit=50`, `before?` (batch `at`), `actor?` | `{ items: Batch[] }` |
| POST | `/activity/:id/undo` | `{}` | `{ batch, conflicts: string[] }`. `batch` is the new undo batch |
| GET | `/events` | | **SSE.** `event: board` with `data: BoardEvent` on every change, from any source including Ann over MCP. Heartbeat comments every 25 s |

## Board configuration

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/columns` | `{ name, kind, wip_limit?, color? }` | `{ column, batch }` |
| PATCH | `/columns/:id` | `{ name?, kind?, wip_limit?, color? }` | `{ column, batch }` |
| POST | `/columns/reorder` | `{ ids: number[] }` | `{ columns, batch }` |
| DELETE | `/columns/:id` | | Must be empty: 409 otherwise |
| GET | `/projects` | | `{ items: (Project & { open: number, done: number })[] }` |
| POST | `/projects` | `{ name, color?, icon?, description? }` | `{ project, batch }` |
| PATCH | `/projects/:id` | `{ name?, color?, icon?, description?, archived?: boolean }` | `{ project, batch }` |
| PATCH | `/tags/:id` | `{ name?, color? }` | `{ tag, batch }` |
| POST | `/tags/merge` | `{ source_id, target_id }` | `{ tag, batch }` |
| GET | `/settings` | | `Settings` |
| PATCH | `/settings` | `Partial<Settings>` | `{ settings, batch }` |

## Data and connection

| Method | Path | Returns |
|---|---|---|
| GET | `/mcp-info` | `{ mode: 'local'\|'oauth', url?, stdio_command, claude_code, instructions_snippet, server_instructions }` |
| GET | `/export/json` | Full export download |
| POST | `/import/json` | Body is an export; replaces nothing, adds cards. Returns `{ cards: number, batch }` |
| GET | `/backups` | `{ items: { name, bytes, at }[] }` |
| POST | `/backups` | `{ file }` |
| GET | `/export/db` | SQLite file download |

## Screen-time wallet (docs/REWARDS.md)

**Owner endpoints** (session cookie):

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/wallet` | | Summary: phase, balance, today's figures, debt, `pending_credit`, `vetoable`, `phone`, `rules`, `pending_rules`, `pause_days` |
| GET | `/wallet/ledger` | `limit`, `before` (ledger id) | `{ items }` |
| POST | `/wallet/start` | `{ baseline?: boolean }` (default true: a 7-day measurement week) | Summary |
| PATCH | `/wallet/rules` | `Partial<Rules>` | `{ effective, rules }`. Once active, changes wait until next Monday; walling more apps applies now. Ann's `wall_apps` MCP tool walls or unwalls at once (ledger kind `wall`, 0 min) |
| POST | `/wallet/confirm/:cardId` | `{ accept: boolean }` | Confirms or declines credit for a card Ann completed |
| POST | `/wallet/veto/:id` | | Reverses one of Ann's grants or fines within 24h |
| POST | `/wallet/pause` | `{ day?, reason }` | Declares a pause day |
| POST | `/wallet/fine` | `{ minutes, reason }` | Fines yourself. There is no self-grant |
| GET | `/wallet/usage` | `days` | `{ items: { day, app, minutes }[] }` |
| GET / POST / DELETE | `/devices`, `/devices/:id` | `{ name }` | Pairs a phone (the token is shown once) or revokes it |

**Phone endpoints** (`Authorization: Bearer <device token>`, tailnet only):
- `GET /phone/state`
- `POST /phone/session`: `{ action: 'start', app, minutes }` or `{ action: 'stop', id }`
- `POST /phone/back`
- `POST /phone/emergency` with `{ reason }`
- `POST /phone/gap` with `{ minutes }`
- `POST /phone/usage` with `{ day, apps: { package: minutes } }`

**Live updates:** `/events` also streams `event: wallet` with `{ entry, balance }` on every ledger row.

## Card sources (Orbit Hub)

Cards take an optional `source`, which records where the card came from in another Megatron app:
- **Shape:** `{ app, id, url?, title? }`, e.g. `{ app: "socrates", id: "tag:7", url: "https://socrates…/library?tag=7", title: "Weak area: Integrals" }`.
- **Where it's set:** `POST /cards` and `PATCH /cards/:id` (`null` clears it). It's returned on every card.
- **No duplicates:** while an open card with the same `app` + `id` exists, a create returns that card instead of a new one. Over MCP it's reported as "Already on the board".
- **The `url`:** must be http(s). It's stored exactly as the other app returned it.
- **Socrates defaults:** cards with `app: "socrates"` get the tag `study`, and the project `Study` unless one is given.

**Card addresses:** when `HEYANN_PUBLIC_ORIGIN` is set, MCP results carry each card's address, `{origin}/card/{id}` (the Sprawl/Slate convention). Clients copy it as-is and never build it.

## Study rewards intake (Socrates, port 8082)

`POST /internal/rewards` with `Content-Type: application/jose` and one signed event as a compact JWS. It answers 200 `{"status":"applied"|"duplicate"}`, 401 for a bad signature or claims, 422 for a bad event, and 503 for a temporary failure. Every other path returns 404. It runs on its own listener (`HEYANN_REWARDS_PORT`) that is never routed. The contract and pricing are in `docs/REWARDS.md` §10.
