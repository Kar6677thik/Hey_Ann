package gg.heyann.wall

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock

/**
 * Debug-only preview of the screens without a server, for screenshots:
 *   adb -s emulator-5554 shell am start -n gg.heyann.wall/.DemoActivity --es screen block --ei balance 12
 * Extras: screen (status|block), balance, phase (active|baseline|off), session (minutes left, 0 = none),
 * kind (spend|emergency), app (package shown on the block screen), paused (boolean).
 */
class DemoActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        if (intent.getStringExtra("screen") == "icon") { showIcon(); return }
        val now = System.currentTimeMillis()
        val phase = intent.getStringExtra("phase") ?: "active"
        val session = intent.getIntExtra("session", 0)
        Store.startDemo(
            Snapshot(
                phase = phase, enforce = phase == "active", balance = intent.getIntExtra("balance", 25),
                walledApps = setOf("com.google.android.youtube", "com.instagram.android"), unlockMax = 20,
                session = if (session > 0) Session(1, "com.google.android.youtube", intent.getStringExtra("kind") ?: "spend", now + session * 60_000L) else null,
                emergencyCost = 30, emergencyMinutes = 15, emergencyLeft = 2, backReward = 1,
                serverTime = now, fetchedElapsed = SystemClock.elapsedRealtime(), fetchedBoot = Store.bootCount(this),
            )
        )
        if (intent.hasExtra("paused")) { if (intent.getBooleanExtra("paused", false)) Store.pause() else Store.resume(this) }
        val target = if (intent.getStringExtra("screen") == "block")
            Intent(this, BlockActivity::class.java).putExtra(BlockActivity.EXTRA_APP, intent.getStringExtra("app") ?: "com.google.android.youtube")
        else Intent(this, MainActivity::class.java)
        startActivity(target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    /** The launcher icon as the system masks it, on the page background and on a light wallpaper. */
    private fun showIcon() {
        setContentView(page {
            space()
            for (bg in listOf(C.ground, 0xFFDDE3F0.toInt())) row(top = 24, gravity = android.view.Gravity.CENTER) {
                setBackgroundColor(bg); setPadding(0, dp(24), 0, dp(24))
                for (size in listOf(96, 64, 48)) addView(android.widget.ImageView(context).apply {
                    setImageDrawable(packageManager.getApplicationIcon(packageName))
                }, android.widget.LinearLayout.LayoutParams(dp(size), dp(size)).apply { marginStart = dp(12); marginEnd = dp(12) })
            }
            space()
        })
    }
}
