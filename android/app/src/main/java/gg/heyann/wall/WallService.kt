package gg.heyann.wall

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Telephony
import android.telecom.TelecomManager
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.InputMethodManager

/**
 * The wall. It only watches which app comes to the front (TYPE_WINDOW_STATE_CHANGED, plus usage events every 1.5 s
 * for apps that come back from Recents without a window event; package names only, never window content),
 * and for a walled app in the active phase with no running session it presses HOME and opens BlockScreen.
 * If this service is off or crashes, nothing is blocked. It never relaunches the walled app.
 */
class WallService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private var essentials: Set<String> = emptySet()
    private var essentialsAt = 0L
    private var current: String? = null       // package last seen in front
    private var lastBounce = 0L
    private var lastBouncePkg: String? = null
    private var aliveAt = 0L

    private val tick = object : Runnable {
        override fun run() {
            onTick()
            main.postDelayed(this, 60_000)
        }
    }

    /**
     * Window events don't fire when an app comes back from Recents (or split screen), so while the screen is on and
     * the wall is up, also ask usage events which app is in front every 1.5 s. Package names only; cheap query.
     */
    private val watch = object : Runnable {
        override fun run() {
            runCatching {
                val st = Store.snapshot
                if (st?.enforce == true && !Store.paused && getSystemService(PowerManager::class.java).isInteractive) {
                    Usage.foregroundNow(this@WallService)?.let { if (it != packageName) { current = it; seen(it); maybeBounce(it) } }
                }
                trackSession()
                autoStop()
            }
            main.postDelayed(this, 1_500)
        }
    }

    override fun onServiceConnected() {
        Store.init(this)
        running = true
        ReportJob.schedule(this)
        checkGap()
        Store.markAlive(this)
        Store.onState = { onSessionState(); scheduleSessionEnd() }
        scheduleSessionEnd()
        refresh()
        main.removeCallbacks(tick)
        main.postDelayed(tick, 60_000)
        main.removeCallbacks(watch)
        main.postDelayed(watch, 1_500)
    }

    override fun onDestroy() {
        running = false
        Store.onState = null
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (e?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString() ?: return
        current = pkg
        // Any failure here must leave the phone untouched.
        runCatching {
            val now = SystemClock.elapsedRealtime()
            if (now - aliveAt > 30_000 && !Store.paused) { aliveAt = now; Store.markAlive(this) }
            seen(pkg)
            maybeGuard(pkg, (e.text.joinToString(" ") + " " + (e.contentDescription ?: "")))
            maybeBounce(pkg)
        }
    }

    private var lastGuard = 0L

    // ---- pay as you go: a session ends by itself a minute after you leave every walled app
    private var lastInWalled = 0L          // elapsed time a walled app was last seen in front
    private var sessionSeen: Long? = null   // the session these timestamps belong to
    private var stopping: Long? = null
    private var tracked: Fg? = null          // activity in front per usage events, replayed incrementally
    private var trackedAt = 0L               // wall clock of the last replay

    /** While a session runs, follow the app in front; a walled app there (screen on) keeps the session alive. */
    private fun trackSession() {
        if (Store.snapshot?.session == null) { trackedAt = 0L; return }
        val now = System.currentTimeMillis()
        tracked = Usage.trackForeground(this, if (trackedAt == 0L) now - 10 * 60_000 else trackedAt - 2_000, if (trackedAt == 0L) null else tracked)
        trackedAt = now
        tracked?.let { seen(it.pkg) }
        // Belt and braces: any other sign that a walled app is in front also keeps the session alive.
        current?.let { seen(it) }
        Usage.foregroundNow(this)?.let { seen(it) }
    }

    private fun seen(pkg: String) {
        if (Store.snapshot?.walledApps?.contains(pkg) == true && getSystemService(PowerManager::class.java).isInteractive)
            lastInWalled = SystemClock.elapsedRealtime()
    }

    /** A new session starts the clock (the app is still opening); no session clears it. */
    private fun onSessionState() {
        val id = Store.snapshot?.session?.id
        if (id != sessionSeen) { sessionSeen = id; lastInWalled = if (id != null) SystemClock.elapsedRealtime() else 0L; stopping = null }
    }

    private fun autoStop() {
        val s = Store.snapshot ?: return
        val id = s.session?.id ?: return
        if (id != sessionSeen) onSessionState()
        val now = SystemClock.elapsedRealtime()
        val left = Policy.sessionRemainingMs(s, now, Store.bootCount(this))
        if (stopping == id || !Policy.shouldAutoStop(s, left, now, lastInWalled)) return
        stopping = id
        Api.stopSession(this, id) { r ->
            r.onSuccess {
                val back = it.optInt("refunded")
                runCatching { android.widget.Toast.makeText(this, "Hey Ann: session ended" + (if (back > 0) ", $back min back" else ""), android.widget.Toast.LENGTH_SHORT).show() }
            }
            r.onFailure { stopping = null } // offline: try again on the next check
        }
    }


    /** Friction, not a lock: a 30 s screen over this app's own Settings pages while the wall is up. */
    private fun maybeGuard(pkg: String, text: String) {
        val label = getString(R.string.app_name)
        if (!Policy.shouldGuard(pkg, text, label, Store.snapshot, Store.paused || Store.demo, System.currentTimeMillis(), Store.guardQuietUntil)) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastGuard < 3_000) return
        lastGuard = now
        startActivity(Intent(this, GuardActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION))
    }

    private fun maybeBounce(pkg: String) {
        if (!wouldBlock(pkg)) return
        val now = SystemClock.elapsedRealtime()
        // One bounce per app per 2 s: a walled app emits several window events while it opens.
        if (pkg == lastBouncePkg && now - lastBounce < 2_000) return
        lastBounce = now
        lastBouncePkg = pkg
        performGlobalAction(GLOBAL_ACTION_HOME)
        // Once it's in the background, ask Android to stop the walled app (allowed for background apps, a normal
        // permission) so reopening it from Recents is a fresh launch, which the wall always sees.
        main.postDelayed({
            runCatching { getSystemService(android.app.ActivityManager::class.java).killBackgroundProcesses(pkg) }
        }, 800)
        main.postDelayed({
            runCatching {
                startActivity(
                    Intent(this, BlockActivity::class.java)
                        .putExtra(BlockActivity.EXTRA_APP, pkg)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
                )
            }
        }, 350)
    }

    private fun wouldBlock(pkg: String): Boolean = Policy.shouldBlock(
        pkg = pkg,
        state = Store.snapshot,
        ownPackage = packageName,
        essentials = essentials(),
        paused = Store.paused || Store.demo,
        nowElapsed = SystemClock.elapsedRealtime(),
        bootNow = Store.bootCount(this),
    )

    private fun onTick() {
        runCatching {
            if (!Store.paused) Store.markAlive(this)
            autoStop()
            if (Store.paused && Policy.pauseExpired(System.currentTimeMillis(), Store.pausedAt)) {
                Store.resume(this)
                Usage.reportIfDue(this, force = true) // bill the paused minutes soon
            }
            if (getSystemService(PowerManager::class.java).isInteractive) {
                refresh()
                Usage.reportIfDue(this)
            }
        }
    }

    /** Refresh the cached state; afterwards (or right away if offline) re-check the app in front. */
    private fun refresh() {
        if (!Store.configured) return
        Api.state(this) { r ->
            if (r.isSuccess) sendPendingGap()
            current?.let { runCatching { maybeBounce(it) } }
        }
    }

    /** When a session runs out while its app is open, bounce once (the user isn't waiting for a new event). */
    private fun scheduleSessionEnd() {
        main.removeCallbacks(sessionEnd)
        val left = Policy.sessionRemainingMs(Store.snapshot, SystemClock.elapsedRealtime(), Store.bootCount(this))
        if (left > 0) main.postDelayed(sessionEnd, left + 1_000)
    }

    private val sessionEnd = Runnable {
        if (getSystemService(PowerManager::class.java).isInteractive) current?.let { runCatching { maybeBounce(it) } }
    }

    // ---- protection gaps

    private fun checkGap() {
        val now = System.currentTimeMillis()
        val gap = Policy.gapMinutes(
            nowWall = now,
            lastAliveWall = Store.lastAliveWall,
            lastAliveBoot = Store.lastAliveBoot,
            bootNow = Store.bootCount(this),
            bootWallNow = now - SystemClock.elapsedRealtime(),
            enforce = Store.snapshot?.enforce == true && !Store.paused, // a pause is reported on its own
        )
        if (gap != null) Store.pendingGap = gap
    }

    private fun sendPendingGap() {
        val m = Store.pendingGap
        if (m <= 0) return
        if (Store.snapshot?.enforce != true) { Store.pendingGap = 0; return } // baseline: the server ignores gaps
        Api.gap(this, m) { r -> if (r.isSuccess) Store.pendingGap = 0 }
    }

    // ---- essentials, found at runtime (on top of Policy.NEVER_BLOCK)

    private fun essentials(): Set<String> {
        val now = SystemClock.elapsedRealtime()
        if (essentials.isNotEmpty() && now - essentialsAt < 10 * 60_000) return essentials
        val pm = packageManager
        val set = HashSet<String>()
        fun resolvers(i: Intent) = runCatching {
            pm.queryIntentActivities(i, PackageManager.MATCH_ALL).forEach { set += it.activityInfo.packageName }
        }
        resolvers(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))
        resolvers(Intent(MediaStore.ACTION_IMAGE_CAPTURE))
        resolvers(Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))
        resolvers(Intent(Intent.ACTION_DIAL))
        runCatching { getSystemService(InputMethodManager::class.java).enabledInputMethodList.forEach { set += it.packageName } }
        runCatching { getSystemService(TelecomManager::class.java).defaultDialerPackage?.let { set += it } }
        runCatching { Telephony.Sms.getDefaultSmsPackage(this)?.let { set += it } }
        essentials = set
        essentialsAt = now
        return set
    }

    companion object {
        /** True while the service is connected (for the status screen). */
        @Volatile var running = false
            private set
    }
}
