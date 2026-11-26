package gg.heyann.wall

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.TextView

/**
 * A beat of friction, never a lock. Shown over Settings when it opens one of Hey Ann wall's own pages (its
 * Accessibility switch, App info, uninstall) while the wall is up. After a 30 s wait "Continue" returns to that
 * page, and the guard stays quiet for 10 min. Home and Recents always work; Back counts as "keep it on".
 */
class GuardActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private var readyAt = 0L
    private lateinit var countdown: TextView
    private lateinit var bar: Bar
    private lateinit var go: TextView

    private val tick = object : Runnable {
        override fun run() {
            val wait = (readyAt - SystemClock.elapsedRealtime()).coerceAtLeast(0)
            countdown.text = mmss(wait)
            bar.fraction = 1f - wait.toFloat() / WAIT_MS
            go.enable(wait <= 0)
            if (wait > 0) main.postDelayed(this, 250)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        readyAt = SystemClock.elapsedRealtime() + WAIT_MS
        val balance = Store.snapshot?.balance
        setContentView(page {
            space()
            text("Turning off the wall?", T.Display, top = 24)
            text(
                "It won't make anything free. Every minute in walled apps is still billed from the usage report" +
                    (if (balance != null) " (balance now ${signed(balance)} min)" else "") +
                    ". Protection off for more than 15 min is a lapse, and a phone that stops reporting loses minutes every day.",
                T.Muted, top = 8,
            )
            text("Need an app with people or in an emergency? Pause in Hey Ann instead: an hour, billed by the minute.", T.Small, top = 12)
            card(top = 24) {
                text("Wait it out", T.Small)
                countdown = mono("", 48f, bold = true, top = 6)
                bar = bar(top = 14)
            }
            button("Keep protection on", Btn.Primary, top = 24) { home() }
            go = button("Continue to Settings", Btn.Quiet, top = 4) { proceed() }
            space()
        })
        main.post(tick)
    }

    private fun proceed() {
        if (SystemClock.elapsedRealtime() < readyAt) return
        Store.guardQuietUntil = System.currentTimeMillis() + QUIET_MS
        finish() // back to the Settings page underneath
    }

    private fun home() {
        runCatching { startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        finish()
    }

    @Deprecated("Back means keep it on")
    override fun onBackPressed() = home()

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        const val WAIT_MS = 30_000L
        const val QUIET_MS = 10 * 60_000L
    }
}
