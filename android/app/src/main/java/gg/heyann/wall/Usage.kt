package gg.heyann.wall

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Process
import java.time.LocalDate
import java.time.ZoneId

/** Daily per-app minutes from Usage access (PACKAGE_USAGE_STATS), posted to /api/phone/usage. */
object Usage {
    private const val EVERY_MS = 3600_000L

    @Suppress("DEPRECATION") // unsafeCheckOpNoThrow is the API 29+ call; its replacement needs API 36
    fun granted(ctx: Context): Boolean {
        val ops = ctx.getSystemService(AppOpsManager::class.java)
        return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName) == AppOpsManager.MODE_ALLOWED
    }

    /** Packages whose time in front is not "using the phone": launchers, system UI and this app. */
    private fun notUsage(ctx: Context): Set<String> {
        val set = hashSetOf(ctx.packageName, "com.android.systemui")
        runCatching {
            ctx.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_ALL)
                .forEach { set += it.activityInfo.packageName }
        }
        return set
    }

    /**
     * The app in front right now according to usage events (the last activity resumed in the past few minutes and not
     * paused since), or null if unknown or Usage access is off. Catches what window events miss, e.g. an app brought
     * back from Recents. Reads package names only.
     */
    fun foregroundNow(ctx: Context): String? {
        if (!granted(ctx)) return null
        val now = System.currentTimeMillis()
        val events = runCatching { ctx.getSystemService(UsageStatsManager::class.java).queryEvents(now - 5 * 60_000, now) }.getOrNull() ?: return null
        var fg: String? = null
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> fg = e.packageName
                UsageEvents.Event.ACTIVITY_PAUSED -> if (e.packageName == fg) fg = null
                UsageEvents.Event.SCREEN_NON_INTERACTIVE, UsageEvents.Event.KEYGUARD_SHOWN -> fg = null
            }
        }
        return fg
    }

    /**
     * The app in front, tracked incrementally: replay usage events since [from] on top of [prev]. Unlike
     * foregroundNow it never forgets an app that has simply stayed in front for a long time (a video, a chat).
     */
    fun trackForeground(ctx: Context, from: Long, prev: Fg?): Fg? {
        if (!granted(ctx)) return prev
        val now = System.currentTimeMillis()
        val events = runCatching { ctx.getSystemService(UsageStatsManager::class.java).queryEvents(from, now) }.getOrNull() ?: return prev
        var fg = prev
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            fg = Policy.nextForeground(fg, e.eventType, e.packageName, e.className)
        }
        return fg
    }

    /** Minutes per package for one local day (up to now, for today). */
    fun minutes(ctx: Context, day: LocalDate): Map<String, Int> {
        val zone = ZoneId.systemDefault()
        val start = day.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = minOf(day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli(), System.currentTimeMillis())
        val usm = ctx.getSystemService(UsageStatsManager::class.java)
        val events = usm.queryEvents(start, end)
        val list = ArrayList<Policy.UsageEvent>()
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            val type = when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> Policy.RESUMED
                UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> Policy.PAUSED
                UsageEvents.Event.DEVICE_SHUTDOWN -> Policy.SHUTDOWN
                UsageEvents.Event.SCREEN_NON_INTERACTIVE, UsageEvents.Event.KEYGUARD_SHOWN -> Policy.SCREEN_OFF
                else -> continue
            }
            list += Policy.UsageEvent(e.timeStamp, e.packageName ?: "", e.className ?: "", type)
        }
        return Policy.foregroundMinutes(list, start, end, notUsage(ctx))
            .entries.sortedByDescending { it.value }.take(150).associate { it.key to it.value }
    }

    /** Called from the service's tick: posts the last 7 days (re-sending is harmless; the server overwrites each day), at most every 3 hours.
     *  So the phone only needs to reach Hey Ann once in a while: days missed while offline are caught up on the next send. */
    fun reportIfDue(ctx: Context, force: Boolean = false, done: (String) -> Unit = {}) {
        if (!Store.configured || !granted(ctx)) return done("Usage access not granted.")
        if (!force && System.currentTimeMillis() - Store.lastUsageReport < EVERY_MS) return done("")
        Store.lastUsageReport = System.currentTimeMillis() // set first, so a failure doesn't retry every minute
        val app = ctx.applicationContext
        Thread {
            val today = LocalDate.now()
            val days = (6L downTo 0L).map { today.minusDays(it) }.map { it to runCatching { minutes(app, it) }.getOrElse { emptyMap() } }
            var left = days.size
            val errors = ArrayList<String>()
            for ((day, apps) in days) {
                Api.usage(app, day.toString(), apps) { r -> // callbacks run on the main thread, one at a time
                    r.onFailure { errors += it.message ?: "error" }
                    if (--left == 0) {
                        if (errors.isNotEmpty()) Store.lastUsageReport = System.currentTimeMillis() - EVERY_MS + 15 * 60_000 // retry in 15 min
                        done(if (errors.isEmpty()) "Usage sent for ${days.first().first} to $today." else errors.first())
                    }
                }
            }
        }.start()
    }
}
