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
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Shown after the wall sent the user HOME from a walled app. A normal activity: Back, Home and Recents
 * all work, and nothing here relaunches the walled app unless the user taps "Open".
 */
class BlockActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var app: String
    private lateinit var balance: TextView
    private lateinit var status: TextView
    private lateinit var spendRow: LinearLayout
    private lateinit var openBtn: Button
    private lateinit var emergencyBtn: Button
    private lateinit var emergencyBox: LinearLayout
    private lateinit var reason: EditText
    private lateinit var confirm: Button
    private var emergencyReadyAt = 0L
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        actionBar?.hide()
        app = intent.getStringExtra(EXTRA_APP) ?: ""
        setContentView(screen {
            text("Hey Ann", 14f, top = 8)
            text("${label(app)} is walled", 24f, bold = true)
            balance = text("", 18f, top = 12)
            status = text("", 14f)

            button("Go back (+${Store.snapshot?.backReward ?: 1} SM)") { goBack() }

            heading("Spend screen minutes")
            text("Paid now from your balance. End early from the Hey Ann app to get unused minutes back.", 13f)
            spendRow = row {}
            openBtn = button("Open ${label(app)}") { openApp() }.apply { show(false) }

            heading("Emergency")
            emergencyBtn = button("Emergency unlock") { startEmergency() }
            emergencyBox = LinearLayout(this@BlockActivity).apply {
                orientation = LinearLayout.VERTICAL
                text("Wait out the 60 seconds and type why you need it.", 13f)
                reason = EditText(context).apply {
                    hint = "Reason (at least 5 characters)"
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    addTextChangedListener(object : TextWatcher {
                        override fun afterTextChanged(s: Editable?) = renderEmergency()
                        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    })
                }
                addView(reason)
                confirm = button("") { confirmEmergency() }
                show(false)
            }
            addView(emergencyBox)
        })
        render()
        Api.state(this) { if (!isFinishing) render(it.exceptionOrNull()?.message) }
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun render(error: String? = null) {
        val s = Store.snapshot
        balance.text = if (s == null) "Balance unknown" else "Balance: ${s.balance} SM"
        val left = Policy.sessionRemainingMs(s, SystemClock.elapsedRealtime(), Store.bootCount(this))
        status.text = when {
            error != null -> "$error\nNothing new can be bought offline; walled apps stay walled. Calls, messages and other essentials are unaffected."
            left > 0 -> "A session is running (${mmss(left)} left)."
            else -> ""
        }
        openBtn.show(left > 0)

        spendRow.removeAllViews()
        val max = s?.unlockMax ?: 20
        for (m in listOf(5, 10, 15, 20).filter { it <= max }) {
            val b = Button(this).apply {
                text = "$m min"
                isAllCaps = false
                isEnabled = !busy && left <= 0 && (s?.enforce != true || s.balance >= m)
                setOnClickListener { spend(m) }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            spendRow.addView(b)
        }

        val em = s
        emergencyBtn.text = if (em == null) "Emergency unlock" else
            "Emergency unlock (−${em.emergencyCost} SM, ${em.emergencyMinutes} min, ${em.emergencyLeft} left this week)"
        emergencyBtn.isEnabled = !busy && left <= 0 && (em?.emergencyLeft ?: 0) > 0
        renderEmergency()
    }

    private fun spend(minutes: Int) {
        busy = true; render()
        Api.startSession(this, app, minutes) { r ->
            busy = false
            r.onSuccess { render(); status.text = "Session started: $minutes min." }
            r.onFailure { render(it.message) }
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
            if (SystemClock.elapsedRealtime() < emergencyReadyAt) main.postDelayed(this, 500)
        }
    }

    private fun startEmergency() {
        emergencyBox.show(true)
        emergencyBtn.show(false)
        emergencyReadyAt = SystemClock.elapsedRealtime() + 60_000
        main.post(countdown)
    }

    private fun renderEmergency() {
        if (!::confirm.isInitialized) return
        val wait = emergencyReadyAt - SystemClock.elapsedRealtime()
        confirm.text = if (wait > 0) "Wait ${mmss(wait)}" else "Confirm emergency unlock"
        confirm.isEnabled = !busy && wait <= 0 && reason.text.trim().length >= 5
    }

    private fun confirmEmergency() {
        busy = true; renderEmergency()
        Api.emergency(this, reason.text.trim().toString()) { r ->
            busy = false
            r.onSuccess { emergencyBox.show(false); emergencyBtn.show(true); render(); status.text = "Emergency unlock started." }
            r.onFailure { render(it.message) }
        }
    }

    private fun label(pkg: String): String =
        runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)

    companion object {
        const val EXTRA_APP = "app"
    }
}
