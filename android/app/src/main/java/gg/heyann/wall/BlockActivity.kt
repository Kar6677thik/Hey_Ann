package gg.heyann.wall

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Shown after the wall sent the user HOME from a walled app. A normal activity: Back, Home and Recents
 * all work, and nothing here relaunches the walled app unless the user taps "Open".
 * Two views: the calm main one, and the emergency one (60 s wait + a typed reason).
 */
class BlockActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var app: String
    private lateinit var appName: String

    private lateinit var mainView: LinearLayout
    private lateinit var balance: TextView
    private lateinit var balanceNote: TextView
    private lateinit var goBackBtn: TextView
    private lateinit var payNote: TextView
    private lateinit var status: TextView
    private lateinit var openBtn: TextView
    private lateinit var emergencyLink: TextView

    private lateinit var emergencyView: LinearLayout
    private lateinit var emergencyInfo: TextView
    private lateinit var emCountdown: TextView
    private lateinit var emBar: Bar
    private lateinit var reason: EditText
    private lateinit var confirm: TextView

    private var emergencyReadyAt = 0L
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        app = intent.getStringExtra(EXTRA_APP) ?: ""
        appName = label(app)
        setContentView(page {
            mainView = column {
                space()
                // Who's walled
                addView(ImageView(context).apply {
                    runCatching { setImageDrawable(packageManager.getApplicationIcon(app)) }.onFailure { setImageResource(R.drawable.ic_mark) }
                }, LinearLayout.LayoutParams(dp(64), dp(64)).apply { gravity = Gravity.CENTER_HORIZONTAL })
                text(appName, T.Display, top = 16, center = true)
                text("is behind the wall for now", T.Muted, top = 4, center = true)

                // Balance
                row(top = 28, gravity = Gravity.CENTER) {
                    balance = mono("", 40f, bold = true)
                    mono(" min", 16f, C.faint).setPadding(0, 0, 0, dp(5))
                }.gravity = Gravity.CENTER_HORIZONTAL or Gravity.BOTTOM
                balanceNote = text("", T.Faint, top = 4, center = true)

                // Primary: back out
                goBackBtn = button("Go back  +${Store.snapshot?.backReward ?: 1}", Btn.Primary, top = 28) { goBack() }
                    .apply { minHeight = dp(52) }
                text("Backing out earns a minute.", T.Faint, top = 8, center = true)

                // Spend: pay as you go
                status = notice("", Tone.Positive, top = 20)
                openBtn = button("Open $appName", Btn.Secondary, top = 8) { open() }
                payNote = text("", T.Faint, top = 10, center = true)
                space()
                emergencyLink = button("Emergency unlock", Btn.Quiet, top = 16) { showEmergency(true) }
                    .apply { setTextColor(C.faint) }
            }

            emergencyView = column {
                text("Emergency unlock", T.Display, top = 24)
                emergencyInfo = text("", T.Muted, top = 8)
                text("Calls, messages and the camera always work without this.", T.Faint, top = 8)
                card(top = 24) {
                    text("Take a breath first", T.Small)
                    emCountdown = mono("", 48f, bold = true, top = 6)
                    emBar = bar(top = 14)
                }
                reason = field("What's going on?", top = 16).apply {
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    typeface = Fonts.sans
                    addTextChangedListener(object : TextWatcher {
                        override fun afterTextChanged(s: Editable?) = renderEmergency()
                        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    })
                }
                confirm = button("", Btn.Primary, top = 12) { confirmEmergency() }
                button("Never mind", Btn.Quiet, top = 4) { showEmergency(false) }
                space()
            }
        })
        showEmergency(false)
        render()
        Api.state(this) { if (!isFinishing) render(it.exceptionOrNull()) }
    }

    private fun LinearLayout.column(build: LinearLayout.() -> Unit): LinearLayout =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = lp(h = MATCH)
            build()
        }.also { addView(it) }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun render(error: Throwable? = null) {
        val s = Store.snapshot
        val left = Policy.sessionRemainingMs(s, SystemClock.elapsedRealtime(), Store.bootCount(this))
        val bal = s?.balance

        balance.text = bal?.let { signed(it) } ?: "—"
        balance.setTextColor(if (bal != null && bal < 0) C.negative else C.text)
        balanceNote.text = when {
            bal == null -> "Balance not synced yet"
            bal < 0 -> "A lapse, not the end. Finished focus work is the way back."
            else -> "in your balance"
        }

        when {
            error != null -> {
                status.text = if ((error as? ApiError)?.status ?: 0 == 0)
                    "Can't reach Hey Ann. Is Tailscale on? Opening a walled app needs it; calls, messages and your other apps work as usual."
                else error.message
                status.setTextColor(Tone.Warning.ink); status.background = rounded(Tone.Warning.bg, status.dp(10))
                status.show(true)
            }
            left > 0 -> {
                status.text = "Session running · ${mmss(left)} left"
                status.setTextColor(Tone.Positive.ink); status.background = rounded(Tone.Positive.bg, status.dp(10))
                status.show(true)
            }
            else -> status.show(false)
        }
        val hold = Policy.holdMinutes(s)
        val offline = error != null && ((error as? ApiError)?.status ?: 0) == 0
        openBtn.text = when {
            busy -> "Opening…"
            offline && left <= 0 -> "Turn on Tailscale, then tap again"
            left > 0 -> "Open $appName"
            hold < 1 -> "No minutes to spend"
            else -> "Open $appName · pay as you go"
        }
        openBtn.enable(!busy && (left > 0 || hold >= 1))
        payNote.text = if (left > 0) "Your session covers all walled apps. It ends a minute after you leave them."
            else "Billed by the minute, up to $hold min. Switch between walled apps freely; it ends a minute after you leave them, and unused minutes come back."

        val em = s
        emergencyLink.enable(!busy && left <= 0 && (em?.emergencyLeft ?: 0) > 0)
        emergencyLink.text = if (em != null && em.emergencyLeft <= 0) "No emergency unlocks left this week" else "Emergency unlock"
        if (em != null) emergencyInfo.text =
            "For when you truly need it. It opens walled apps for ${em.emergencyMinutes} min and costs ${em.emergencyCost} min, " +
                "even into debt. ${em.emergencyLeft} left this week."
        renderEmergency()
    }

    /** Open the app: inside a running session right away, otherwise start a pay-as-you-go session first. */
    private fun open() {
        val s = Store.snapshot
        if (Policy.sessionRemainingMs(s, SystemClock.elapsedRealtime(), Store.bootCount(this)) > 0) return openApp()
        val hold = Policy.holdMinutes(s)
        if (hold < 1) return
        busy = true; render()
        Api.startSession(this, app, hold) { r ->
            busy = false
            if (r.isSuccess) openApp() else render(r.exceptionOrNull())
        }
    }

    private fun goBack() {
        Api.back(this) {}
        runCatching { startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        finish()
    }

    /** User-initiated only. */
    private fun openApp() {
        packageManager.getLaunchIntentForPackage(app)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        finish()
    }

    // ---- emergency: 60 s wait + typed reason

    private val countdown = object : Runnable {
        override fun run() {
            renderEmergency()
            if (SystemClock.elapsedRealtime() < emergencyReadyAt) main.postDelayed(this, 250)
        }
    }

    private fun showEmergency(on: Boolean) {
        mainView.show(!on)
        emergencyView.show(on)
        main.removeCallbacks(countdown)
        if (on) {
            emergencyReadyAt = SystemClock.elapsedRealtime() + WAIT_MS
            main.post(countdown)
        } else {
            reason.setText("")
        }
    }

    private fun renderEmergency() {
        if (!::confirm.isInitialized) return
        val wait = (emergencyReadyAt - SystemClock.elapsedRealtime()).coerceAtLeast(0)
        emCountdown.text = mmss(wait)
        emCountdown.setTextColor(if (wait > 0) C.text else C.faint)
        emBar.fraction = 1f - wait.toFloat() / WAIT_MS
        val minutes = Store.snapshot?.emergencyMinutes ?: 15
        confirm.text = if (wait > 0) "Unlock for $minutes min" else if (reason.text.trim().length < 5) "Type a reason to unlock" else "Unlock for $minutes min"
        confirm.enable(!busy && wait <= 0 && reason.text.trim().length >= 5)
    }

    private fun confirmEmergency() {
        busy = true; renderEmergency()
        Api.emergency(this, reason.text.trim().toString()) { r ->
            busy = false
            showEmergency(false)
            render(r.exceptionOrNull())
        }
    }

    private fun label(pkg: String): String =
        runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)

    companion object {
        const val EXTRA_APP = "app"
        private const val WAIT_MS = 60_000L
    }
}
