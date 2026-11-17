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

    /** Pause protection: report once, as soon as a pause runs past GAP_MIN. */
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

    /**
     * Foreground minutes per package within [start, end), from resume/pause events in time order.
     * An activity already in front at `start` (first event a pause) counts from `start`;
     * one still in front at `end` counts up to `end`.
     */
    fun foregroundMinutes(events: List<UsageEvent>, start: Long, end: Long): Map<String, Int> {
        val open = HashMap<String, Long>()     // "pkg/cls" -> resumed at
        val seen = HashSet<String>()
        val ms = HashMap<String, Long>()
        fun add(pkg: String, from: Long, to: Long) {
            val a = from.coerceAtLeast(start); val b = to.coerceAtMost(end)
            if (b > a) ms[pkg] = (ms[pkg] ?: 0) + (b - a)
        }
        for (e in events) {
            if (e.time < start || e.time >= end) continue
            when (e.type) {
                RESUMED -> { val k = "${e.pkg}/${e.cls}"; seen += k; if (k !in open) open[k] = e.time }
                PAUSED -> {
                    val k = "${e.pkg}/${e.cls}"
                    val from = open.remove(k) ?: if (k !in seen) start else null
                    seen += k
                    if (from != null) add(e.pkg, from, e.time)
                }
                SHUTDOWN -> {
                    for ((k, from) in open) add(k.substringBefore('/'), from, e.time)
                    open.clear()
                }
            }
        }
        for ((k, from) in open) add(k.substringBefore('/'), from, end)
        return ms.mapValues { (it.value / 60_000).toInt().coerceAtMost(1440) }.filterValues { it > 0 }
    }
}
