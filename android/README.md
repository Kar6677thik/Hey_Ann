# Hey Ann wall (Android)

The phone side of the screen-time wallet (`docs/REWARDS.md` §6). When your balance is empty, the apps you walled in Hey Ann send you to your home screen and show a Hey Ann screen instead. Everything else on the phone works as usual.

## What it does

- **Watches which app comes to the front.** It uses an Accessibility service that receives only "window changed" events. It cannot read what's on screen (`canRetrieveWindowContent="false"`).
- **Bounces walled apps.** If the app in front is on the server's `walled_apps` list, the wallet is **active** and no session is running, the service:
  1. presses Home;
  2. opens the block screen, which shows:
     - your balance;
     - **Go back** (+1 SM);
     - **Spend 5 / 10 / 15 / 20 min** (paid now from your balance, then an **Open** button);
     - **Emergency** (a 60-second wait and a typed reason, costs −30).
- **Shows status.** The app's main screen shows your balance and phase, any running session with a countdown, **End session now** (unused minutes come back) and **Pause protection**.
- **Reports usage.** About every 3 hours while the screen is on, it sends per-app minutes for yesterday and today (from Usage access) to Hey Ann. During the baseline week this is all it does.
- **Reports protection gaps.** If the service was off for more than 15 minutes during the active phase, it tells Hey Ann when it comes back. Hey Ann charges the protection-gap penalty. A reboot or a dead battery is not a gap.

## Safety guarantees

These hold by construction (`Policy.shouldBlock` in `app/src/main/java/gg/heyann/wall/Policy.kt`, unit-tested):

- **It only ever acts on packages in the server's `walled_apps` list.** Any app not on that list is never touched.
- **Some apps are never blocked, even if the list names them:**
  - this app;
  - Settings, the system UI and the permission screens;
  - any launcher;
  - any keyboard;
  - the dialer, phone, contacts and emergency apps;
  - the default SMS app and the common messaging apps;
  - any camera.
- **It never blocks in the baseline or off phase**, nor before it has synced with the server even once.
- **If the app crashes or the service is off, nothing is blocked.**
- **It never loops.** A bounce goes Home and then shows its own screen. It never relaunches the walled app; only your tap on **Open** does.
- **It needs only two ordinary permissions,** both of which you can revoke in Settings:
  - **Accessibility:** to see which app is in front.
  - **Usage access:** for daily minutes.

  It also uses INTERNET.
- **It does nothing at the OS level:**
  - no device admin, no Device Owner, no root, no adb;
  - no writes to system or secure settings, no grayscale changes;
  - no overlay permission, no foreground service, no notifications;
  - no Google Play services, Firebase or analytics.
- **It keeps your token on the phone.** The device token is encrypted with an AES key held in the Android Keystore.

**Offline:** sessions are paid for on the server, so with no connection nothing new can be bought and walled apps stay walled (from the last saved state). A session that's already running still ends on its local timer, measured on the phone's monotonic clock against the server's time, so changing the phone's clock doesn't extend it. Calls, messages and every app you haven't walled keep working.

## Install (no adb)

1. **Build** (on the PC): `android\gradlew.bat assembleDebug`. The APK is `android/app/build/outputs/apk/debug/app-debug.apk`.
2. **Copy it to the phone:** use a USB cable in file-transfer mode, Google Drive, or Tailscale's **Taildrop** (Share → Tailscale → your phone).
3. **Install it:** on the phone, open the file in **Files** and tap **Install**. If asked, allow "Install unknown apps" for the Files app (Settings → Apps → Special app access → Install unknown apps). You can switch that back off afterwards.

Updating works the same way: install the new APK over the old one. Your pairing is kept.

## Setup

1. **Pair.** In Hey Ann on the web, go to **Settings → Wallet → Pair phone**. Copy the token; it's shown only once.
2. **Connect.** Open **Hey Ann wall** on the phone:
   - Check the server URL (default `https://heyann.tailf67d61.ts.net`). Tailscale must be connected on the phone.
   - Paste the token and tap **Save and test**. You should see "Connected".
3. **Usage access.** Tap **Open Usage access settings**, pick **Hey Ann wall** and allow it.
4. **Accessibility.** Tap **Open Accessibility settings**. Find **Hey Ann wall** (often under *Downloaded apps* or *Installed apps*) and switch it on.

### Android 13+: "Restricted setting"

Android blocks Accessibility for apps installed from a file until you allow it. If the switch is greyed out or you see "Restricted setting":

1. In the app, tap **Open App info** (or go to Settings → Apps → Hey Ann wall).
2. Tap **⋮** (top right), then **Allow restricted settings**, and confirm with your PIN or fingerprint.
3. Go back to Accessibility and switch **Hey Ann wall** on.

The **Allow restricted settings** option only appears after you've tried to switch the service on once and seen the "Restricted setting" message, so try that first.

## Turning it off

You are always in control:

- **One tap:** **Pause protection** on the app's main screen. Walled apps open normally until you tap **Resume protection**.
- **Fully:** Settings → Accessibility → **Hey Ann wall** → off. Nothing is blocked while it's off.
- **Remove:** uninstall it like any other app. To stop the token working, revoke the phone in Hey Ann web (Settings → Wallet).

In the **active** phase, protection that's off or paused for more than 15 minutes is reported to Hey Ann, which charges the protection-gap penalty (once per gap). This is an honesty nudge, not a lock. Reboots and a dead battery don't count.

## Code map

| File | What |
|---|---|
| `app/src/main/java/gg/heyann/wall/Policy.kt` | Pure logic: should block?, session end, gap rule, usage minutes. No Android imports |
| `.../WallService.kt` | The Accessibility service: bounce, 60 s refresh, liveness, gap reports, essentials found at runtime |
| `.../BlockActivity.kt` | The block screen, and its emergency view |
| `.../MainActivity.kt` | Status, setup checklist, pause |
| `.../Ui.kt` | The small design kit: web app colour tokens, cards, pills, buttons, fields, the mono font |
| `.../Api.kt` | `/api/phone/*` client (`Authorization: Bearer <token>`) |
| `.../Store.kt` | Settings, the Keystore-encrypted token, the cached state |
| `.../Usage.kt` | Usage access → `POST /api/phone/usage` |
| `app/src/test/.../PolicyTest.kt` | JUnit tests for the pure logic |
| `app/src/debug/.../DemoActivity.kt` | Debug-only preview for screenshots (see below) |
| `app/src/main/res/font/` | JetBrains Mono 400/500, Latin subset (~49 KB each), [OFL](licenses/JetBrainsMono-OFL.txt) |

**Build and test:**

```
android\gradlew.bat assembleDebug testDebugUnitTest
```

The build needs JDK 17+ (`JAVA_HOME`) and the Android SDK. `local.properties` points at the SDK and is gitignored.

## Look

The app matches the Hey Ann web app:
- **Colours:** the same dark tokens as `web/src/styles.css`.
- **Type:** numbers are in JetBrains Mono, and text uses the system sans.
- **App icon:** an hourglass on near-black, which is also the web app's wallet icon.

Screenshots are in [`docs/`](docs/): `before-*.png` shows the old look, and `after-*.png` shows the current one.

**Preview without a server (debug builds only).** `DemoActivity` loads a made-up wallet state into memory, with no network and no saving.
- While it's loaded, the wall blocks nothing.
- Only `adb shell` can start it, because it requires the `DUMP` permission, which ordinary apps can't hold.
- It isn't in release builds at all.

Always pass `-s` with the emulator's serial:

```
adb -s emulator-5554 shell am start -n gg.heyann.wall/.DemoActivity --es screen status --ei balance 25 --ei session 12
adb -s emulator-5554 shell am start -n gg.heyann.wall/.DemoActivity --es screen block --ei balance -8
```

The extras are `screen` (`status`, `block` or `icon`), `balance`, `phase`, `session` (minutes left), `kind`, `app` and `paused`.

**Pinned versions:**
- Gradle 8.14.3
- Android Gradle Plugin 8.11.1
- Kotlin 2.2.0
- compileSdk/targetSdk 36, minSdk 29
- JUnit 4.13.2, which is the only dependency

## Secure Folder

Samsung Secure Folder runs as a separate user, so the wall (and usage counting) cannot see apps inside it. That is deliberate: reaching into it would need system-level access, which this app never uses. The one honesty rule: **do not install walled apps inside Secure Folder.**
