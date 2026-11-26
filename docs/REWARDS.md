# Hey Ann rewards: screen time as a currency (design, for review)

**Status:** approved 17 Nov 2026 with one owner constraint: **nothing risky on the phone**, so no reset, no Device Owner, no device-admin, nothing at OS level. The server side is built (`src/core/wallet.ts`); the web page and the Android app follow.

**Goal:** an Android phone walled off by default. Screen minutes are earned by real, finished work and lost through lapses. Earning is hard, it can't be gamed cheaply, and it never spirals into "I give up".

**Principle:** keep it lean. One currency, one ledger, a handful of rules. Ann (the AI) handles unusual cases inside hard limits.

## 1. What the research says (and how it shaped this)

| Finding | Design consequence |
|---|---|
| Paid incentives plus hard-to-override limits cut target-app use by about 39% and partly stuck (Allcott, Gentzkow & Song, *AER* 2022) | Earn minutes, and enforce the wall on the phone itself, not by honor |
| Rewards work when they are **immediate** and meaningful (contingency-management meta-analyses) | Credit lands the moment a card is Done |
| Rewards for *showing up* crowd out motivation; rewards for *performance* hurt less (Deci, Koestner & Ryan 1999) | Pay per **focused minute on finished work**, not per card |
| Splitting tasks to farm rewards (Goodhart's law) | Card count earns almost nothing; time does |
| "Earned it, so binge" (licensing effect) | Daily earn cap, balance cap, 7-day expiry |
| One lapse turns into quitting (abstinence-violation effect, Marlatt) | No game over: lapses create limited **debt** with a way back, and penalties are capped |
| Loss-framed incentives beat gain-framed ones (45% vs ~33% goal attainment, Patel et al. 2016) | A small daily allowance you can **lose** |
| Friction with an option to back out cut app opens 57% (one sec, PNAS 2023), but use rebounds when friction stops (CHI 2024) | The wall is permanent. A blocked screen offers "go back" (rewarded) |
| People set self-defeating terms and loosen rules on impulse (John 2020; Beeminder's "akrasia horizon") | Rule changes take effect **next Monday**, never immediately |

## 2. The currency

- **Screen minute (SM):** one minute in a *walled* app. Calls, messages, maps, banking/2FA, camera, music and the authenticator are **essentials**: never walled, never metered.
- **Ledger:** append-only `ledger(id, at, amount, kind, reason, card_id, source, rule_version)`.
  - The balance is the sum of the rows. A correction is a new row; rows are never edited.
  - The ledger sits **outside** board undo, so undoing a card can't refund or erase spending. Undo instead triggers a recalculation (§4).
- **Balance:** capped at **180**. Earned minutes **expire after 7 days**, oldest first. The floor is **−60** (debt), with no interest.

## 3. Earning: hard on purpose

**Only one thing earns: focused minutes on a card that reaches Done.** Minutes vest when the card is completed.

```
earned = round(focus_min × 0.25 × P × T)  + bonus
  P (priority locked when the first focus starts):  P0 1.5 · P1 1.25 · P2 1.0 · P3 0.75
  T: 1.2 if finished on/before a due date that was set ≥48h earlier, else 1.0
  bonus: +3 if the card has ≥25 focus min (max 3 bonuses/day)
cap: 60 SM per day
```

**Daily allowance:** each morning **+10 SM**, framed as yours to lose: it is forfeited if you miss your plan (§5).

**What that means in practice:**
- 4 hours of deep work on P2 cards earns about 60 SM: one hour of phone, but only after real effort.
- A normal 2-hour day earns about 30 + 10 = 40 SM.

## 4. Anti-gaming: every exploit and its answer

| Exploit | Rule |
|---|---|
| Split a task into many cards | Credit follows minutes, not cards. Bonuses are capped at 3/day and need ≥25 focus min |
| Create a card and complete it instantly | It earns 0, because there are no focus minutes |
| Leave the focus timer running while on the phone | Focus minutes that **overlap a phone spend session are voided**. A single focus session counts 90 minutes at most |
| Log time manually or backdate | Manual time logs earn 0. Focus timestamps are set by the server |
| Raise priority just before finishing | Priority is locked when the first focus session starts |
| Move a due date to fake "on time" | T counts only a due date that was set ≥48h before completion |
| Done → back → Done | A card pays once. Reopening claws back its credit. Re-completing pays only new minutes, with no second bonus |
| Undo after being paid | After any undo, `reconcile(card)` posts `what it should have earned − what it was paid` |
| Ann (AI) completes or creates cards | Allowed, but **no credit vests until you confirm** the completion in the web app ("Ann said it's done": one tap). Focus timers Ann starts count like any other, because the phone-overlap rule below still voids minutes spent on the phone |
| Edit SQLite or the config | Out of scope: it's your server. Rule changes wait until next Monday, and every ledger row records its `rule_version` |
| Disable the phone app | See §6. The wall fails **closed**, and tampering is a penalty |

## 5. Penalties: they sting, but they're capped

| Lapse | Penalty |
|---|---|
| **Missed plan:** you planned today (≥1 card) but finished none of them *and* logged under 60 focus minutes | Lose the day's +10 allowance, and **−10** |
| No plan by 11:00 on a weekday | Allowance forfeited |
| **Overdue P0/P1** card | −5 per day per card, max −15 per card. P2/P3 are never penalized, so you're not punished for setting dates |
| Pushing back an already-overdue P0/P1 | −5 once (snoozing isn't free) |
| **Emergency unlock** (§6) | −30, which can go into debt |
| **Tampering:** phone stops checking in without being offline, or accessibility/admin disabled | −30, and the wall stays shut |
| **Unpaid use** (paused, offline or wall off): minutes in walled apps no session covered (§6a) | Charged by the minute from the usage report, down to −300 at most |
| **Silent phone:** no usage report for 48 h | −30 a day until it reports |
| **Overspend** (the phone ran past the balance, e.g. offline) | Becomes debt |

**Guard rails against giving up:**
- Penalties are capped at **−30 per day** and **−100 per week**.
- Debt has a floor of **−60**. Every new earning repays debt first, at **1.5×**, so focus pays back faster than it sank.
- After **3 days in a row in debt**, penalties pause until you're back to zero.
- Streak breaks cost nothing. They just reset the streak.

## 6. The wall (Android)

**A small companion app** (Kotlin, sideloaded) is the only enforcement that holds up against someone motivated to cheat. Automation apps like Tasker can be switched off in five seconds.

- **Detect:** an AccessibilityService sees which app is in front instantly.
- **Block:** walled apps get bounced to a "Hey Ann" screen showing your balance, plus three buttons:
  - **"Go back"** refunds 1 SM. Backing out is rewarded.
  - **"Spend"** opens a session of 5/10/15 minutes, at most 20 per unlock.
  - **"Emergency (−30)"** gives a 15-minute unlock, after a 60-second wait and a typed reason. Max 2 per week.
- **Meter:** sessions are prepaid on the server (unused whole minutes are refunded when you end early), and the phone enforces the end time with its uptime clock, so changing the phone clock does not help. A running session unlocks all walled apps until it ends. The server owns the balance.
- **Offline:** sessions are **prepaid** on the server, so with no connection nothing new can be bought and walled apps stay walled. A session already running ends on time. Turning off Tailscale or Wi-Fi therefore doesn't unlock anything. Essentials are never affected.
- **Grayscale** stays on outside essentials. It's free friction.
- **Safety first (owner's rule):** only a normal Accessibility permission, which you can switch off in Settings at any time. The app never touches the launcher, Settings, system UI, essentials or itself, and if it crashes, nothing is blocked. No device-admin, no Device Owner, no reset.
- **Protection gaps:** when the app's service comes back after being off for more than 15 minutes, it reports the gap and the tampering penalty applies. This is an honesty nudge, not a lock.

**Server side:** a small phone API on the tailnet-only listener, authenticated with a per-device token:
- `GET /api/phone/state`: phase, whether to enforce, balance, walled apps, the running session, emergency unlocks left.
- `POST /api/phone/back`, `POST /api/phone/gap`, `POST /api/phone/usage` (daily per-app minutes, for the baseline).
- `POST /api/phone/session` (start/stop).
- `POST /api/phone/emergency`.

### 6a. Pausing isn't free (added 26 Nov 2026)

**The loophole:** Pause protection, or switching off Tailscale, then using walled apps freely cost only a flat −30, however long it lasted.

**The fix:** use is billed by the minute from the phone's own usage report. There's still no lock: the phone always opens what you need with people or in an emergency.

- **The tab:**
  - Every minute in a walled app that no paid session covered is charged to the wallet (ledger kind `tab`, "Unpaid use").
  - The figure comes from Android's usage stats, which keep counting while paused, offline or with the wall switched off.
  - 3 minutes a day are forgiven (bounces, accidental opens).
  - It's spending, not a penalty: the penalty caps don't apply, but it never goes below **−300**. Debt is repaid by real work at 1.5×, and while you're in debt nothing can be bought.
  - It applies to active days only, starting the day after this shipped.
- **Pause:**
  - It still opens everything, but asks first: a 5-second confirm that states the cost.
  - It ends by itself after **60 min**.
  - The flat pause penalty is gone; the tab replaces it.
- **Reporting doesn't depend on the wall:**
  - An hourly background job sends the usage report whenever there's a network, even with the accessibility service off.
  - Going offline only delays the bill: the report covers the last 7 days.
- **Silence:**
  - A paired phone with no usage report for **48 h** (Tailscale off for days, Usage access revoked, uninstalled) costs −30 a day until it reports again.
  - Reaching Hey Ann without a usage report doesn't count.
  - Revoking the device in the web app stops this.
- **Turning the wall off:**
  - Opening Hey Ann wall's own pages in Settings (its Accessibility switch, App info, uninstall) shows a 30-second "won't make anything free" screen first.
  - It's friction, never a lock: Home works, "Continue" opens the page after the wait, and it stays quiet for 10 minutes afterwards.
  - It reads window titles only, never screen content.
- **Not covered:** apps inside Secure Folder (a separate Android user). Hey Ann can't see or bill those without OS-level access, which is ruled out.

## 7. Ann's discretion: the unusual cases

Fixed rules can't foresee everything ("I spent the day at the hospital", "I used a loophole", "my laptop died mid-focus"). Ann gets a few wallet tools:

- `adjust_wallet(amount, reason)`. Ann can grant **up to +15 SM a day** or fine **up to −20 SM a day**, and only for a reason she states. The reason is written to the ledger and shown in the web app.
- Ann can also **declare a pause day** (sick, travel, emergency): no earning, no penalties, a flat 30 SM. Max 7 per month, and it can't be backdated more than 1 day.
- Ann has **full authority over which apps are walled** (`wall_apps`, owner's decision of 18 Nov 2026). Walling and unwalling both apply at once, skipping the Monday wait, and each change is a zero-minute ledger row with her reason. She unwalls only for real needs (an app needed for work, study or travel, or one walled by mistake), never because you want to scroll or are bargaining. Essentials stay unwalled whatever the list says.
- Ann **cannot** change the other rules, the caps, the essentials list or the phone settings, and can't undo spending.
- Any adjustment of more than 5 SM shows in the web app, where you can veto it within 24h. A veto reverses it.
- Ann is told to be **strict**: she grants nothing for "I deserve it", and she fines you when you admit to cheating.
- New read tools: `wallet` (balance, today's earnings and penalties, debt, streak). Plus a line added to `summary` and `get_board`, e.g. "Wallet: 34 SM · +18 today".

## 8. Scenarios checklist

| Scenario | What happens |
|---|---|
| Great deep-work day | Earns up to the 60 SM cap. Anything beyond still counts toward the stats and streak |
| Lazy day, nothing done | You keep only minutes earned earlier (they expire after 7 days). If you'd planned, you lose the allowance and −10 |
| Weekend | Allowance still granted. The plan is optional (no forfeit), overdue penalties pause, earning works normally |
| Sick or travelling | Ann or the web app declares a pause day |
| Server down | Nothing new can be bought, so walled apps stay walled. Essentials always work |
| Phone offline | Same as above. Usage is counted on the phone and synced later. Overspend becomes debt |
| Real emergency | Essentials are never walled. For anything else, the emergency unlock (−30) |
| You cheated and confess | Tell Ann; she fines you, up to −20/day |
| You reopened a card that was done | Its credit is clawed back, and only new minutes count when you finish it again |
| You disagree with Ann's ruling | Veto it within 24h in the web app |
| The rules feel too tight or too loose | Change them in Settings. The change takes effect next Monday. A weekly review card in Insights shows earned vs spent, penalties and overrides, and suggests one tweak |
| You drop the habit for a week | No compounding. Debt stays at most −60 with no interest, and focus repays it at 1.5× |

## 9. Rollout

1. **Baseline week:** the app only measures phone use; no wall. This gives a real "before" number.
2. **Wall on**, with the numbers above.
3. **Tune after 2 weeks**, one setting at a time, using these targets:
   - phone time at least 30% below baseline;
   - earned:spent ratio of 0.8–1.0;
   - the daily cap hit on 10–50% of days;
   - penalties no more than 20% of earnings;
   - at most 1 override a week.

**Build order:**
1. Server: ledger, earning, penalties, phone API, and Ann's tools.
2. Web: wallet page, confirm-Ann-completions, veto, rules settings.
3. The Android app, as a separate repo.

## 10. Study in Socrates earns minutes (approved)

**Status:** agreed with the Socrates thread and **approved by the owner on 18 Nov 2026**. Socrates documents the emitting side in its own `docs/REWARDS.md`. Hey Ann builds the intake once the Orbit thread defines the app-to-app transport (a signed call or an event outbox, using Orbit Identity client credentials).

**The principle:** real study should pay like focused work, but only on the Socrates server's say-so. Claude reporting "they studied" earns nothing. That keeps the core rule from §3: minutes come from verified work, never from a claim.

### What Socrates measures (server clocks only)

- **Credited time per attempt:** the server-side gap since the previous answer in the same session (or since the session started).
  - Capped at 3 min per attempt, or 6 min for written and code answers.
  - Gaps over 10 min count 0.
  - The browser's own timer can only lower the figure, never raise it. Browser timings can be edited, so they are never trusted to add time.
- **Which attempts count:**
  - **Count:** due reviews, never-seen questions, and questions answered wrong in the last 24 h.
  - **Never count:** re-answering something answered correctly in the last 24 h; questions created less than 24 h ago (this blocks "write easy questions, then answer them"); undone attempts.
- **Weighting by how the answer was graded:**
  - Graded by the server (choices, numbers, cloze, code with tests): 100%.
  - Flashcards and self-graded written answers: 50%.
  - Written answers graded through `submit_grades`: 100%.
  - Ungraded: 0, unless graded within 48 h.
- **Events are emitted per session, after it closes:** when you end it, or 30 minutes after the last answer, so undo and grading have settled.
  - `study_minutes`: `{event_id, day, minutes, intervals: [[start, end]…], session_id, attempts_credited}`.
  - A `…:late` supplement carries extra minutes if grading finishes later.
  - `mastery_up`: when a leaf tag first crosses 50%, 70% or 85% mastery. It needs at least 10 counted attempts on at least 2 study days, and each threshold pays once per tag, ever.
  - Socrates never emits more than 180 study minutes a day.
  - Event ids are stable, so delivering an event twice changes nothing.

### How Hey Ann prices it

| | Rule |
|---|---|
| Study minutes | × **0.25**, the same rate as card focus. Priority and on-time multipliers don't apply; there's no card. |
| Mastery thresholds | **+3** each, at most **3 a day**. These count toward the existing 3-bonuses-a-day limit. |
| Daily caps | Study earnings count toward the existing **60/day** cap, with a **30/day sub-cap** from study, so finishing real cards stays the main way to earn. |
| No double counting | Study intervals that overlap a running Hey Ann focus timer are voided, because that time is already paid as focus. Intervals that overlap a phone spend session are voided, the same rule as §4. |
| Day | Socrates' `day` (the owner's date, rolling over at 04:00) decides which day's sub-cap an event uses. The ledger time is when the event arrives. |
| Ledger | New kinds `study` and `mastery`, `source: socrates`, with `dedupe = event_id`. They sit outside board undo, like all wallet rows. |
| Pause days, baseline, debt | They behave like focus earnings: they earn during the baseline and on pause days, and repay debt at 1.5×. |

**In practice:** a 40-minute real review session is worth about **10 minutes** of phone. With the 30/day sub-cap, at most **2 hours** of study a day can earn, and the rest of the 60 must come from cards.

### How events arrive (built)

Orbit fixed the transport (orbit-cloud `docs/17-orbit-hub.md` §7): a **signed push**, so an AI never carries an award.

- **Where:** Socrates posts each event to `POST /internal/rewards` on Hey Ann's own listener (`:8082`).
  - Nothing routes or tunnels to that listener. Its NetworkPolicy admits only the Socrates pod.
- **What:** the body is a compact JWS (`Content-Type: application/jose`, at most 16 KB).
  - Header: ES256, `typ: reward+jwt`, `kid`.
  - Claims: `iss: socrates`, `aud: heyann-rewards`, `jti` = the event id, `iat`, `exp` at most 5 minutes later, and `event`.
- **Checks, in order:**
  1. the signature, against Socrates' public keys (`HEYANN_REWARDS_JWKS_FILE`; 1 to 3 keys, re-read when the ConfigMap changes);
  2. `typ`, `iss` and `aud`;
  3. `exp`, with 60 s of skew;
  4. `iat`, no more than 60 s in the future;
  5. `jti` equals `event.event_id`;
  6. the event's schema.
- **Answers:**
  - 200 `applied` or `duplicate`;
  - 401 for a bad signature or claims;
  - 422 for a bad event;
  - 503 for a temporary failure, which Socrates retries.
- **Exactly once:** the event id is the ledger's permanent dedupe key. A re-signed retry gets `duplicate` and pays nothing.
- **Every accepted event leaves a ledger row, even one that pays 0** (wallet off, a baseline event, a limit reached), with the reason. Refusals are logged by the server.
- **Code:** `src/server/rewards.ts` and `Wallet.applyStudyEvent`.
- **Live check without paying anything:** `npm run reward-vector -- --key <file>` prints a test public key and a signed 0-minute event.

## Sources

Allcott, Gentzkow & Song, "Digital Addiction", *AER* 2022 · contingency-management meta-analyses (PMC4203362, PMC5385000, PMC8034391) · Deci, Koestner & Ryan 1999 · Blanken et al. 2015 (moral licensing) · Marlatt's relapse model (PMC3296289) · Silverman & Barasch 2023 (streaks) · Patel et al. 2016 (loss-framed incentives) · Giné, Karlan & Zinman (CARES) · John 2020 (commitment contracts) · Grüning et al., *PNAS* 2023 (one sec) · Haliburton et al., CHI 2024 · Beeminder blog (akrasia horizon, pledge caps) · Android: AccessibilityService, `setPackagesSuspended` (Device Owner), Curbox/DigiPaws (open-source blockers) · Android 13+ restricted settings for sideloaded apps.
