package gg.heyann.wall

// Pure decision logic: no Android imports, so it runs under plain JUnit.
// Every rule here leans towards "don't block": the wall acts ONLY on packages the server lists
// in walled_apps, only in the active phase, and never on anything in the never-block set.

/** The last /api/phone/state, plus where we were on our own clocks when it arrived. */
data class Snapshot(
    val phase: String,            // "off" | "baseline" | "active"
    val enforce: Boolean,         // server: phase == "active"
    val balance: Int,
    val walledApps: Set<String>,
    val unlockMax: Int,
    val session: Session?,
    val emergencyCost: Int,
    val emergencyMinutes: Int,
    val emergencyLeft: Int,
    val backReward: Int,
    val serverTime: Long,         // server wall clock (ms) when it built the state
    val fetchedElapsed: Long,     // SystemClock.elapsedRealtime() when the reply arrived
    val fetchedBoot: Int,         // boot id (Settings.Global.BOOT_COUNT) when the reply arrived
)

data class Session(val id: Long, val app: String, val kind: String, val endsAt: Long)

object Policy {
    /** Gaps shorter than this are never reported (the server's tamper_gap_min default). */
    const val GAP_MIN = 15
    /** A pause ends by itself after this long. Paused use is billed from usage reports anyway (the server's tab). */
    const val PAUSE_MAX_MIN = 60

    /**
     * Packages that are never blocked, whatever the server says. Launchers, keyboards and the
     * default dialer/SMS app are added at runtime (see WallService.essentials()).
     */
    val NEVER_BLOCK: Set<String> = setOf(
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.google.android.settings.intelligence",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        // phone / calls / emergency
        "com.android.phone",
        "com.android.server.telecom",
        "com.android.dialer",
        "com.google.android.dialer",
        "com.samsung.android.dialer",
        "com.samsung.android.incallui",
        "com.android.emergency",
        "com.google.android.apps.safetyhub",
        "com.android.contacts",
        "com.google.android.contacts",
        "com.samsung.android.app.contacts",
        // messaging
        "com.android.mms",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        // camera
        "com.android.camera",
        "com.android.camera2",
        "com.google.android.GoogleCamera",
        "com.sec.android.app.camera",
        // keyboards
        "com.google.android.inputmethod.latin",
        "com.samsung.android.honeyboard",
        "com.touchtype.swiftkey",
        // launchers
        "com.google.android.apps.nexuslauncher",
        "com.android.launcher3",
        "com.sec.android.app.launcher",
    )

    /** Session end on the elapsedRealtime clock, or null if there is none / it can't be trusted. */
    fun sessionEndElapsed(s: Snapshot?, bootNow: Int): Long? {
        val session = s?.session ?: return null
        if (s.fetchedBoot != bootNow) return null // rebooted since: elapsed clock restarted, treat as ended
        // Use the server's own clock difference, so a wrong (or changed) phone clock can't stretch a session.
        return s.fetchedElapsed + (session.endsAt - s.serverTime)
    }

    fun sessionRemainingMs(s: Snapshot?, nowElapsed: Long, bootNow: Int): Long {
        val end = sessionEndElapsed(s, bootNow) ?: return 0
        return (end - nowElapsed).coerceAtLeast(0)
    }

    /**
     * The one question the wall asks. True only if ALL hold:
     * protection on, a package we know, not ours, not essential, phase active, listed as walled,
     * and no session running.
     */
    fun shouldBlock(
        pkg: String?,
        state: Snapshot?,
        ownPackage: String,
        essentials: Set<String>,
        paused: Boolean,
        nowElapsed: Long,
        bootNow: Int,
    ): Boolean {
        if (paused) return false
        if (pkg.isNullOrBlank()) return false
        if (pkg == ownPackage) return false
        if (pkg in NEVER_BLOCK || pkg in essentials) return false
        if (state == null) return false               // never synced: we know nothing, so block nothing
        if (!state.enforce || state.phase != "active") return false
        if (pkg !in state.walledApps) return false
        if (sessionRemainingMs(state, nowElapsed, bootNow) > 0) return false
        return true
    }

    /**
     * Minutes of protection gap to report when the service starts, or null if none.
     * A reboot (or dead battery) since lastAlive is not a gap; neither is baseline.
     * bootWallNow = System.currentTimeMillis() - SystemClock.elapsedRealtime().
     */
    fun gapMinutes(
        nowWall: Long,
        lastAliveWall: Long,
        lastAliveBoot: Int,
        bootNow: Int,
        bootWallNow: Long,
        enforce: Boolean,
    ): Int? {
        if (!enforce) return null
        if (lastAliveWall <= 0 || lastAliveWall > nowWall) return null
        if (bootNow != lastAliveBoot) return null       // boot counter moved: rebooted
        if (bootWallNow > lastAliveWall) return null    // booted after we were last alive: rebooted
        val minutes = ((nowWall - lastAliveWall) / 60_000).toInt()
        return if (minutes > GAP_MIN) minutes else null
    }

    /** Settings and package-installer windows whose title mentions this app: its Accessibility switch, App info,
     *  uninstall. Window titles only (event text), never screen content. */
    private val GUARD_PKGS = setOf(
        "com.android.settings", "com.samsung.accessibility", "com.samsung.android.app.settings",
        "com.android.packageinstaller", "com.google.android.packageinstaller", "com.samsung.android.packageinstaller",
    )

    fun isGuardedPage(pkg: String, text: String, appLabel: String): Boolean =
        pkg in GUARD_PKGS && appLabel.isNotBlank() && text.contains(appLabel, ignoreCase = true)

    fun shouldGuard(pkg: String, text: String, appLabel: String, state: Snapshot?, paused: Boolean, nowWall: Long, quietUntil: Long): Boolean =
        state?.enforce == true && state.phase == "active" && !paused && nowWall >= quietUntil && isGuardedPage(pkg, text, appLabel)

    /** A pay-as-you-go session ends by itself after this long outside every walled app (screen off counts as outside). */
    const val AWAY_STOP_MS = 60_000L

    /** Minutes to hold for a pay-as-you-go session: as much as the balance allows, up to the per-session limit. */
    fun holdMinutes(s: Snapshot?): Int {
        if (s == null) return 0
        if (!s.enforce) return s.unlockMax
        return minOf(s.balance, s.unlockMax).coerceAtLeast(0)
    }

    /** End a running spend session once the user has been out of all walled apps for AWAY_STOP_MS. */
    fun shouldAutoStop(s: Snapshot?, remainingMs: Long, nowElapsed: Long, lastInWalledElapsed: Long): Boolean =
        s?.session?.kind == "spend" && remainingMs > 0 && lastInWalledElapsed > 0 && nowElapsed - lastInWalledElapsed >= AWAY_STOP_MS

    /** True once a pause has run PAUSE_MAX_MIN (or the clock went backwards past its start). */
    fun pauseExpired(nowWall: Long, pausedAtWall: Long): Boolean =
        pausedAtWall > 0 && (nowWall < pausedAtWall || nowWall - pausedAtWall >= PAUSE_MAX_MIN * 60_000L)

    /** Pause protection: report once, as soon as a pause runs past GAP_MIN. (Unused since pauses are metered.) */
    fun pauseGapMinutes(nowWall: Long, pausedAtWall: Long, alreadyReported: Boolean, enforce: Boolean): Int? {
        if (!enforce || alreadyReported || pausedAtWall <= 0 || pausedAtWall > nowWall) return null
        val minutes = ((nowWall - pausedAtWall) / 60_000).toInt()
        return if (minutes > GAP_MIN) minutes else null
    }

    /** Usage events, reduced to what the aggregation needs. type: 1 = resumed, 2 = paused/stopped, 3 = shutdown. */
    data class UsageEvent(val time: Long, val pkg: String, val cls: String, val type: Int)

    const val RESUMED = 1
    const val PAUSED = 2
    const val SHUTDOWN = 3
    /** Screen went off or the keyguard came up: nobody is using the phone. */
    const val SCREEN_OFF = 4

    /**
     * Foreground minutes per package within [start, end), from usage events in time order.
     * Only ONE app is in front at a time: a resume hands the slot to that app (closing the previous one), and a pause
     * of the app in front, screen-off/keyguard or shutdown empties it. Android often logs resumes without a matching
     * pause (Settings, launchers), so per-activity bookkeeping over-counts badly; a single slot can't.
     * The app in front at `end` counts up to `end`; nothing is assumed to be in front at `start`.
     * Packages in `ignore` (launchers, system UI, this app) are never counted.
     */
    fun foregroundMinutes(events: List<UsageEvent>, start: Long, end: Long, ignore: Set<String> = emptySet()): Map<String, Int> {
        var cur: String? = null
        var since = 0L
        val ms = HashMap<String, Long>()
        fun close(at: Long) {
            val p = cur ?: return
            val a = since.coerceAtLeast(start); val b = at.coerceAtMost(end)
            if (b > a && p !in ignore) ms[p] = (ms[p] ?: 0) + (b - a)
            cur = null
        }
        for (e in events) {
            if (e.time < start || e.time >= end) continue
            when (e.type) {
                RESUMED -> if (cur != e.pkg) { close(e.time); cur = e.pkg; since = e.time }
                PAUSED -> if (cur == e.pkg) close(e.time)
                SHUTDOWN, SCREEN_OFF -> close(e.time)
            }
        }
        close(end)
        return ms.mapValues { (it.value / 60_000).toInt().coerceAtMost(1440) }.filterValues { it > 0 }
    }
}
