# Connecting Claude and ChatGPT to Hey Ann

Hey Ann is an MCP server. Once it's connected, start a message with **"Hey Ann, …"** and the assistant manages your board.

## How "Hey Ann" works

An MCP server can't listen for a wake word, so "Hey Ann" works as a phrase the assistant learns from three places:

1. **The server's instructions** (sent automatically). ChatGPT reads these.
2. **Every tool description** (sent automatically). Each one says when to use the tool.
3. **Your custom instructions:** a short snippet you paste once, below. This step makes the trigger reliable in both apps.

Voice mode is unreliable with custom connectors in both apps. Dictating into the text box works fine.

## Step 1: Add the connector

The URL is `https://heyann-mcp.karthiksurkanti.in/mcp`. Settings → Connect AI in the web app shows it too.

**Claude (claude.ai, Desktop, mobile)**
1. Go to Settings → Connectors → **Add custom connector**.
2. Name it `Hey Ann` and paste the URL. Leave the OAuth client fields empty: Claude identifies itself to Orbit Identity on its own.
3. Click **Connect**. Sign in and consent on Orbit Identity from a device on your tailnet.
4. After connecting, it works on the web, Desktop and mobile apps. In a chat, make sure the connector is enabled in the tools menu.

**ChatGPT**
1. Go to Settings → Apps & Connectors → Advanced → turn on **Developer mode**.
2. Choose **Create**, name it `Hey Ann`, paste the URL, and pick OAuth authentication.
3. Sign in and consent on Orbit Identity.
4. In a chat, enable Hey Ann from the tools menu (+ → More → Hey Ann). ChatGPT asks you to confirm write actions. Read tools like `get_board` and `whats_next` run without asking.

**Claude Code** (on the PC):
```bash
claude mcp add --transport http hey-ann https://heyann-mcp.karthiksurkanti.in/mcp
```
For a local, unauthenticated copy while developing, use `npm run mcp` over stdio instead:
```bash
claude mcp add hey-ann -s user -- node --no-warnings "<repo>/src/mcp/stdio.ts"
```

## Step 2: Paste the trigger snippet

- **Claude:** Settings → Profile → "What personal preferences should Claude consider in responses?" Or put it in a Project's instructions.
- **ChatGPT:** Settings → Personalization → Custom instructions. Or tell it to remember this.

```
"Hey Ann" means: use my Hey Ann connector (my Kanban board). Any message beginning with "Hey Ann" is a board command (add, move, update, list, plan or summarize cards), so call the Hey Ann tools rather than replying conversationally. If unsure which card I mean, show the matches and ask.
```

## Things to say

| You say | What Ann does |
|---|---|
| "Hey Ann, I need to finish the DB migration by Friday, review Raj's PR, and prep slides for Monday" | Adds three cards with due dates, in one batch |
| "Hey Ann, done with Raj's PR, started the slides, migration is blocked on DBA access" | Completes one card, moves one, blocks one, all in one batch |
| "Hey Ann, what should I work on? I have 45 minutes" | Gives ranked picks with reasons |
| "Hey Ann, plan my day" | Proposes a plan sized to your capacity; confirm it to apply |
| "Hey Ann, standup" / "weekly review" | Writes a summary |
| "Hey Ann, I'm drowning. Triage." | Lists overdue, stale and blocked cards with suggested fixes |
| "Hey Ann, starting the migration" / "stop" | Runs a focus timer and logs the time |
| "Hey Ann, gym every Mon, Wed and Fri" | Adds a recurring card; marking it done creates the next one |
| "Hey Ann, add a checklist to the slides: outline, charts, rehearse" | Adds checklist items |
| "Hey Ann, add a Blocked column with a WIP limit of 2" | Changes the board itself |
| "Hey Ann, how am I doing?" | Shows stats, your streak, and the 14-day review |
| "Hey Ann, undo" | Reverts the last thing Ann did, as a whole |

Every change Ann makes appears in the web app straight away, with a toast and an **Undo** button, and stays in **Activity** along with the sentence you said.

## Tools reference

| Tool | Access | Purpose |
|---|---|---|
| `get_board` | read | Board snapshot, today's date in your timezone, highlights |
| `find_cards` | read | Search and filter (also finds archived cards) |
| `get_card` | read | Everything about one card, including its history |
| `add_cards` | write | Batch create, with duplicate detection and `client_ref` idempotency |
| `update_cards` | write | Batch move, edit, block, tag, checklist, plan, restore |
| `archive_cards` | write (destructive) | Soft delete, only with `confirm=true` |
| `focus` | write | Start or stop a focus timer, or log time |
| `whats_next` | read | Ranked picks with reasons |
| `plan_day` | write | Proposes a day plan; `apply=true` sets it |
| `summary` | read | Standup, daily or weekly summary |
| `triage` | read | Overdue, stale and blocked cards, with suggestions |
| `insights` | read | Throughput, cycle time, streak, Ann usage, 14-day review |
| `undo` | write | Reverts the last Ann batch, or a given one |
| `history` | read | Recent activity, with batch ids |
| `configure_board` | write | Columns, WIP limits, projects, tags, settings |
| `ann_guide` | read | How Kanban and Hey Ann work |

Cards can be referred to by `#id` or by any part of their title. If a reference matches more than one card, Ann changes nothing and asks which one you meant.
