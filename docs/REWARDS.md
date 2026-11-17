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

## 7. Ann's discretion: the unusual cases

Fixed rules can't foresee everything ("I spent the day at the hospital", "I used a loophole", "my laptop died mid-focus"). Ann gets **one** wallet tool:

- `adjust_wallet(amount, reason)`. Ann can grant **up to +15 SM a day** or fine **up to −20 SM a day**, and only for a reason she states. The reason is written to the ledger and shown in the web app.
- Ann can also **declare a pause day** (sick, travel, emergency): no earning, no penalties, a flat 30 SM. Max 7 per month, and it can't be backdated more than 1 day.
- Ann **cannot** change rules, the caps, the essentials list or the phone settings, and can't undo spending.
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

## Sources

Allcott, Gentzkow & Song, "Digital Addiction", *AER* 2022 · contingency-management meta-analyses (PMC4203362, PMC5385000, PMC8034391) · Deci, Koestner & Ryan 1999 · Blanken et al. 2015 (moral licensing) · Marlatt's relapse model (PMC3296289) · Silverman & Barasch 2023 (streaks) · Patel et al. 2016 (loss-framed incentives) · Giné, Karlan & Zinman (CARES) · John 2020 (commitment contracts) · Grüning et al., *PNAS* 2023 (one sec) · Haliburton et al., CHI 2024 · Beeminder blog (akrasia horizon, pledge caps) · Android: AccessibilityService, `setPackagesSuspended` (Device Owner), Curbox/DigiPaws (open-source blockers) · Android 13+ restricted settings for sideloaded apps.
