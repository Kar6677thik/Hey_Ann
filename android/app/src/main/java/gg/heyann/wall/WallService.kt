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
 * The wall. It only watches which app comes to the front (TYPE_WINDOW_STATE_CHANGED, no window content),
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

    override fun onServiceConnected() {
        Store.init(this)
        running = true
        checkGap()
        Store.markAlive(this)
        Store.onState = { scheduleSessionEnd() }
        scheduleSessionEnd()
        refresh()
        main.removeCallbacks(tick)
        main.postDelayed(tick, 60_000)
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
            maybeBounce(pkg)
        }
    }

    private fun maybeBounce(pkg: String) {
        if (!wouldBlock(pkg)) return
        val now = SystemClock.elapsedRealtime()
        // One bounce per app per 2 s: a walled app emits several window events while it opens.
        if (pkg == lastBouncePkg && now - lastBounce < 2_000) return
        lastBounce = now
        lastBouncePkg = pkg
        performGlobalAction(GLOBAL_ACTION_HOME)
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
            reportPauseGap()
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

    private fun reportPauseGap() {
        val m = Policy.pauseGapMinutes(System.currentTimeMillis(), Store.pausedAt, Store.pauseGapReported, Store.snapshot?.enforce == true)
            ?: return
        Store.pauseGapReported = true
        Store.pendingGap = maxOf(Store.pendingGap, m)
        sendPendingGap()
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
