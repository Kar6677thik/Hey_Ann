package gg.heyann.wall

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.InputType
import android.text.format.DateUtils
import android.view.accessibility.AccessibilityManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

/** Status, setup and permissions on one scrolling screen. */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var summary: TextView
    private lateinit var sessionText: TextView
    private lateinit var endBtn: Button
    private lateinit var pauseText: TextView
    private lateinit var pauseBtn: Button
    private lateinit var message: TextView
    private lateinit var url: EditText
    private lateinit var token: EditText
    private lateinit var a11yText: TextView
    private lateinit var usageText: TextView

    private val clock = object : Runnable {
        override fun run() {
            renderSession()
            main.postDelayed(this, 1_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        actionBar?.hide()
        setContentView(screen {
            text("Hey Ann wall", 24f, bold = true, top = 8)
            text("Blocks only the apps you wall in Hey Ann, and only once the wallet is active. Everything else is never touched.", 13f)

            heading("Status")
            summary = text()
            sessionText = text()
            endBtn = button("End session now (unused minutes come back)") { endSession() }
            button("Refresh") { refresh() }
            message = text("", 13f)

            heading("Protection")
            pauseText = text("", 13f)
            pauseBtn = button("") { togglePause() }

            heading("Setup")
            text("Pair from Hey Ann web: Settings → Wallet → Pair phone, then paste the token shown there.", 13f)
            url = EditText(context).apply {
                hint = "Server URL"
                setText(Store.serverUrl)
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            }.also { addView(it) }
            token = EditText(context).apply {
                hint = if (Store.configured) "Device token (saved; paste to replace)" else "Device token"
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }.also { addView(it) }
            button("Save and test") { save() }

            heading("Permissions")
            a11yText = text()
            button("Open Accessibility settings") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            text("Find “Hey Ann wall” (often under Downloaded apps or Installed apps) and switch it on. It only sees which app is in front. It can't read your screen.", 13f)
            usageText = text(top = 14)
            button("Open Usage access settings") { open(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
            text("Lets the app count minutes per app each day for your Hey Ann stats. During the baseline week, that's all it does.", 13f)
            button("Send usage now") { Usage.reportIfDue(this@MainActivity, force = true) { if (it.isNotBlank()) message.text = it } }

            text("Android 13+: if the switch is greyed out (“Restricted setting”)", 15f, bold = true, top = 14)
            text("Apps installed from a file are restricted at first. Try the switch once, then open App info, tap ⋮ (top right), choose “Allow restricted settings”, confirm, and switch the service on again.", 13f)
            button("Open App info") { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }

            heading("Turning it off")
            text(
                "• One tap: “Pause protection” above. Walled apps open normally until you resume.\n" +
                    "• Fully: Settings → Accessibility → Hey Ann wall → off. Nothing is blocked while it's off.\n" +
                    "• Or uninstall the app like any other.\n" +
                    "Protection off for more than 15 minutes during the active phase is reported to Hey Ann, which charges the protection-gap penalty. Reboots and a dead battery don't count.",
                13f,
            )
        })
    }

    override fun onResume() {
        super.onResume()
        render()
        main.post(clock)
        if (Store.configured) refresh()
    }

    override fun onPause() {
        main.removeCallbacks(clock)
        super.onPause()
    }

    private fun render() {
        val s = Store.snapshot
        summary.text = when {
            !Store.configured -> "Not paired yet. Fill in Setup below."
            s == null -> "Paired. Waiting for the first sync…"
            else -> buildString {
                append("Balance: ${s.balance} SM\n")
                append(
                    when (s.phase) {
                        "active" -> "Phase: active. Walled apps are blocked unless a session runs."
                        "baseline" -> "Phase: baseline. Measuring only; nothing is blocked."
                        else -> "Phase: off. The wallet isn't started; nothing is blocked."
                    }
                )
                append("\nWalled apps: ${s.walledApps.size}")
                if (Store.stateFetchedWall > 0) append("\nLast sync: ${DateUtils.getRelativeTimeSpanString(Store.stateFetchedWall)}")
            }
        }
        message.text = Store.lastError ?: ""
        renderSession()

        val on = a11yOn()
        a11yText.text = if (on) "Accessibility service: ON" else "Accessibility service: OFF (nothing is blocked)"
        usageText.text = if (Usage.granted(this)) "Usage access: granted" else "Usage access: not granted"

        if (Store.paused) {
            pauseText.text = "Paused since ${DateUtils.getRelativeTimeSpanString(Store.pausedAt)}. Walled apps open freely. " +
                "Pauses longer than ${Policy.GAP_MIN} min in the active phase cost the protection-gap penalty."
            pauseBtn.text = "Resume protection"
        } else {
            pauseText.text = if (on) "Protection is on." else "Protection is off: the Accessibility service isn't running."
            pauseBtn.text = "Pause protection"
        }
    }

    private fun renderSession() {
        val s = Store.snapshot
        val left = Policy.sessionRemainingMs(s, SystemClock.elapsedRealtime(), Store.bootCount(this))
        sessionText.text = if (left > 0) {
            val kind = if (s?.session?.kind == "emergency") "Emergency unlock" else "Session"
            "$kind running: ${mmss(left)} left. Walled apps are open."
        } else "No session running."
        endBtn.show(left > 0)
    }

    private fun refresh() {
        Api.state(this) { r -> render(); r.onFailure { message.text = it.message } }
    }

    private fun endSession() {
        val id = Store.snapshot?.session?.id ?: return
        endBtn.isEnabled = false
        Api.stopSession(this, id) { r ->
            endBtn.isEnabled = true
            render()
            r.onSuccess { message.text = "Session ended. ${it.optInt("refunded")} min back." }
            r.onFailure { message.text = it.message }
        }
    }

    private fun togglePause() {
        if (Store.paused) Store.resume(this) else Store.pause()
        render()
    }

    private fun save() {
        val u = url.text.toString().trim().trimEnd('/')
        if (!u.startsWith("https://")) { message.text = "The server URL must start with https://"; return }
        Store.serverUrl = u
        val t = token.text.toString().trim()
        if (t.isNotEmpty()) Store.token = t
        token.setText("")
        token.hint = "Device token (saved; paste to replace)"
        message.text = "Testing…"
        Api.state(this) { r ->
            render()
            message.text = r.fold({ "Connected. Phase: ${it.optString("phase")}." }, { it.message })
        }
    }

    private fun a11yOn(): Boolean =
        getSystemService(AccessibilityManager::class.java)
            .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .any { it.resolveInfo.serviceInfo.packageName == packageName }

    private fun open(i: Intent) = runCatching { startActivity(i) }.onFailure { message.text = "Couldn't open that screen: ${it.message}" }
}
