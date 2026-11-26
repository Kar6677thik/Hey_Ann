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
import android.view.Gravity
import android.view.accessibility.AccessibilityManager
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/** Status, setup and permissions on one scrolling screen. */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())

    private lateinit var phasePill: TextView
    private lateinit var balance: TextView
    private lateinit var balanceUnit: TextView
    private lateinit var phaseLine: TextView
    private lateinit var syncLine: TextView

    private lateinit var sessionCard: LinearLayout
    private lateinit var sessionPill: TextView
    private lateinit var countdown: TextView

    private lateinit var pausedCard: LinearLayout
    private lateinit var pausedLine: TextView
    private lateinit var pauseBtn: TextView

    private lateinit var doneCount: TextView
    private lateinit var pairMark: ImageView
    private lateinit var pairTitle: TextView
    private lateinit var pairSub: TextView
    private lateinit var pairToggle: TextView
    private lateinit var pairForm: LinearLayout
    private lateinit var url: EditText
    private lateinit var token: EditText
    private lateinit var formMessage: TextView
    private lateinit var usageMark: ImageView
    private lateinit var usageSub: TextView
    private lateinit var usageAction: TextView
    private lateinit var a11yMark: ImageView
    private lateinit var a11yTitle: TextView
    private lateinit var a11yAction: TextView
    private lateinit var restricted: LinearLayout

    private var formOpen = false

    private val clock = object : Runnable {
        override fun run() {
            renderSession()
            main.postDelayed(this, 1_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        setContentView(page {
            // Header
            row(top = 4) {
                addView(ImageView(context).apply { setImageResource(R.drawable.ic_mark) }, LinearLayout.LayoutParams(dp(24), dp(24)).apply { marginEnd = dp(10) })
                text("Hey Ann", T.Title).layoutParams = lp(w = 0, weight = 1f)
                button("Refresh", Btn.Quiet, w = LinearLayout.LayoutParams.WRAP_CONTENT) { refresh() }
            }

            // Balance
            card(top = 12) {
                row {
                    text("Balance", T.Small).layoutParams = lp(w = 0, weight = 1f)
                    phasePill = pill()
                }
                row(top = 6, gravity = Gravity.BOTTOM) {
                    balance = mono("", 56f, bold = true)
                    balanceUnit = mono(" min", 18f, C.faint).apply { setPadding(0, 0, 0, dp(8)) }
                }
                phaseLine = text("", T.Muted, top = 8)
                syncLine = text("", T.Faint, top = 4)
            }

            // Running session
            sessionCard = card {
                row {
                    text("Session", T.Small).layoutParams = lp(w = 0, weight = 1f)
                    sessionPill = pill("Running", Tone.Accent)
                }
                row(top = 6, gravity = Gravity.BOTTOM) {
                    countdown = mono("", 44f, bold = true)
                    mono(" left", 16f, C.faint).setPadding(0, 0, 0, dp(6))
                }
                row(top = 12) {
                    text("Walled apps are open. It ends a minute after you leave them; unused minutes come back.", T.Small).layoutParams = lp(w = 0, weight = 1f)
                    button("End now", Btn.Secondary, w = LinearLayout.LayoutParams.WRAP_CONTENT) { endSession() }
                        .layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(12) }
                }
            }

            // Paused
            pausedCard = card {
                text("Protection paused", T.Heading)
                pausedLine = text("", T.Small, top = 6)
                button("Resume protection", Btn.Primary, top = 12) { togglePause() }
            }

            pauseBtn = button("Pause protection", Btn.Quiet, top = 8) { togglePause() }

            // Setup checklist
            card(top = 24) {
                row {
                    text("Setup", T.Heading).layoutParams = lp(w = 0, weight = 1f)
                    doneCount = mono("", 12.5f, C.faint)
                }

                // 1. Pairing
                row(top = 14) {
                    pairMark = checkMark()
                    column(this) {
                        pairTitle = text("", T.Body)
                        pairSub = text("", T.Small, top = 2)
                    }
                    pairToggle = button("Change", Btn.Quiet, w = LinearLayout.LayoutParams.WRAP_CONTENT) { formOpen = !formOpen; render() }
                }
                pairForm = LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(36), 0, 0, 0)
                    url = field("Server URL", Store.serverUrl, top = 10)
                    token = field("Paste the device token", secret = true)
                    button("Save and test", Btn.Primary, top = 10) { save() }
                    formMessage = text("", T.Small, top = 8)
                }.also { addView(it) }
                divider(top = 14)

                // 2. Usage access
                row(top = 14) {
                    usageMark = checkMark()
                    column(this) {
                        text("Usage access", T.Body)
                        usageSub = text("", T.Small, top = 2)
                    }
                    usageAction = button("", Btn.Secondary, w = LinearLayout.LayoutParams.WRAP_CONTENT) { usageTap() }
                }
                divider(top = 14)

                // 3. The wall service (Accessibility)
                row(top = 14) {
                    a11yMark = checkMark()
                    column(this) {
                        a11yTitle = text("", T.Body)
                        text("Sees which app is in front. Never reads the screen.", T.Small, top = 2)
                    }
                    a11yAction = button("Turn on", Btn.Secondary, w = LinearLayout.LayoutParams.WRAP_CONTENT) { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
                }
                restricted = LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(36), 0, 0, 0)
                    notice(
                        "Switch greyed out? Try it once, then App info → ⋮ → Allow restricted settings, and switch it on again.",
                        Tone.Neutral, top = 10,
                    )
                    button("Open App info", Btn.Quiet, w = LinearLayout.LayoutParams.WRAP_CONTENT, top = 4) {
                        open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                    }
                }.also { addView(it) }
            }

            // Turning it off
            card(top = 12) {
                text("Turning it off", T.Heading)
                text(
                    "Pause above when you need an app with people or in an emergency: nothing is blocked, and every minute in walled apps is billed to your wallet from the usage report. To stop completely, switch off Settings → Accessibility → Hey Ann wall, or uninstall the app.",
                    T.Small, top = 6,
                )
                text("Usage is billed whenever the phone reports, even after time offline. Accessibility off for more than 15 min, or no contact with Hey Ann for 48 h, counts as a lapse. Reboots and a flat battery don't.", T.Faint, top = 6)
            }
            text("Blocks only the apps you wall in Hey Ann. Calls, messages, the camera and everything else are never touched.", T.Faint, top = 16, center = true)
        })
    }

    /** A vertical column that takes the remaining width of a row. */
    private fun column(parent: LinearLayout, build: LinearLayout.() -> Unit) =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            build()
        }.also { parent.addView(it) }

    override fun onResume() {
        super.onResume()
        formOpen = formOpen || !Store.configured
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
        val paired = Store.configured
        val a11y = a11yOn()
        val usage = Usage.granted(this)

        // Balance + phase
        val bal = s?.balance
        balance.text = bal?.let { signed(it) } ?: "—"
        balance.setTextColor(if (bal != null && bal < 0) C.negative else C.text)
        when {
            Store.paused -> phasePill.apply { text = "Paused"; setPill(Tone.Warning) }
            s == null -> phasePill.apply { text = "Not synced"; setPill(Tone.Neutral) }
            s.phase == "active" -> phasePill.apply { text = "Wall is up"; setPill(Tone.Accent) }
            s.phase == "baseline" -> phasePill.apply { text = "Measuring · baseline week"; setPill(Tone.Neutral) }
            else -> phasePill.apply { text = "Not started"; setPill(Tone.Neutral) }
        }
        phaseLine.text = when {
            !paired -> "Pair with Hey Ann below to see your balance."
            s == null -> "Waiting for the first sync."
            s.phase == "active" && s.balance < 0 -> "You're in debt for now. Finished focus work is the way back."
            s.phase == "active" -> "Walled apps open with a session you pay for from here."
            s.phase == "baseline" -> "Just measuring this week. Nothing is blocked."
            else -> "The wallet isn't started yet, so nothing is blocked."
        }
        val err = Store.lastError
        syncLine.text = when {
            err != null -> err
            Store.stateFetchedWall > 0 -> "Synced ${ago(Store.stateFetchedWall)}"
            else -> ""
        }
        syncLine.setTextColor(if (err != null) Tone.Warning.ink else C.faint)
        syncLine.show(syncLine.text.isNotEmpty())

        // Pause
        pausedCard.show(Store.paused)
        pauseBtn.show(!Store.paused)
        if (Store.paused) pausedLine.text =
            "Since ${ago(Store.pausedAt)}. Walled apps open freely; every minute in them is billed to your wallet. Resumes by itself after ${Policy.PAUSE_MAX_MIN} min."

        // Checklist
        pairMark.setDone(paired)
        pairTitle.text = if (paired) "Paired with Hey Ann" else "Pair with Hey Ann"
        pairSub.text = if (paired) Uri.parse(Store.serverUrl).host ?: Store.serverUrl
        else "In Hey Ann on the web: Settings → Wallet → Pair phone. Paste the token below."
        pairToggle.show(paired)
        pairToggle.text = if (formOpen) "Close" else "Change"
        pairForm.show(formOpen || !paired)
        token.hint = if (paired) "Paste a new token to replace it" else "Paste the device token"

        usageMark.setDone(usage)
        usageSub.text = if (usage) "Counts minutes per app for your stats." else "Lets Hey Ann count minutes per app."
        usageAction.text = if (usage) "Send now" else "Allow"
        usageAction.styleButton(if (usage) Btn.Quiet else Btn.Secondary)

        a11yMark.setDone(a11y)
        a11yTitle.text = if (a11y) "Wall service is on" else "Turn on the wall service"
        a11yAction.show(!a11y)
        restricted.show(!a11y)

        doneCount.text = "${listOf(paired, usage, a11y).count { it }} of 3 done"
        renderSession()
    }

    private fun renderSession() {
        val s = Store.snapshot
        val left = Policy.sessionRemainingMs(s, SystemClock.elapsedRealtime(), Store.bootCount(this))
        sessionCard.show(left > 0)
        if (left > 0) {
            countdown.text = mmss(left)
            val emergency = s?.session?.kind == "emergency"
            sessionPill.text = if (emergency) "Emergency" else "Running"
            sessionPill.setPill(if (emergency) Tone.Warning else Tone.Accent)
        }
    }

    private fun refresh() {
        Api.state(this) { render() }
    }

    private fun endSession() {
        val id = Store.snapshot?.session?.id ?: return
        Api.stopSession(this, id) { r ->
            render()
            r.onSuccess { syncLine.show(true); syncLine.setTextColor(Tone.Positive.ink); syncLine.text = "Session ended. ${it.optInt("refunded")} min back." }
        }
    }

    private fun usageTap() {
        if (!Usage.granted(this)) { open(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)); return }
        usageSub.text = "Sending…"
        Usage.reportIfDue(this, force = true) { if (it.isNotBlank()) usageSub.text = it }
    }

    override fun onStart() {
        super.onStart()
        ReportJob.schedule(this)
    }

    private fun togglePause() {
        if (Store.paused) {
            Store.resume(this)
            Usage.reportIfDue(this, force = true) // bill the paused minutes now
            render()
            return
        }
        // A beat of friction, never a lock: with people or in an emergency the app must open.
        val balance = Store.snapshot?.balance
        val d = android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Pause protection?")
            .setMessage(
                "Walled apps open freely for up to ${Policy.PAUSE_MAX_MIN} min, then protection resumes.\n\n" +
                    "It isn't free: every minute in them is billed to your wallet from the usage report" +
                    (if (balance != null) " (balance now $balance min)" else "") + ", and can take you into debt.",
            )
            .setPositiveButton("Pause") { _, _ -> Store.pause(); render() }
            .setNegativeButton("Keep it on", null)
            .create()
        d.setOnShowListener {
            val b = d.getButton(android.app.AlertDialog.BUTTON_POSITIVE)
            b.isEnabled = false
            var left = 5
            val h = Handler(Looper.getMainLooper())
            val step = object : Runnable {
                override fun run() {
                    if (!d.isShowing) return
                    if (left == 0) { b.text = "Pause"; b.isEnabled = true; return }
                    b.text = "Pause (${left--})"
                    h.postDelayed(this, 1000)
                }
            }
            step.run()
        }
        d.show()
    }

    private fun save() {
        val u = url.text.toString().trim().trimEnd('/')
        if (!u.startsWith("https://")) { formMessage.setTextColor(Tone.Warning.ink); formMessage.text = "The server URL must start with https://"; return }
        Store.serverUrl = u
        val t = token.text.toString().trim()
        if (t.isNotEmpty()) Store.token = t
        token.setText("")
        formMessage.setTextColor(C.muted)
        formMessage.text = "Testing…"
        Api.state(this) { r ->
            r.onSuccess { formOpen = false }
            render()
            formMessage.setTextColor(if (r.isSuccess) Tone.Positive.ink else Tone.Warning.ink)
            formMessage.text = r.fold({ "Connected." }, { it.message })
        }
    }

    private fun a11yOn(): Boolean =
        getSystemService(AccessibilityManager::class.java)
            .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .any { it.resolveInfo.serviceInfo.packageName == packageName }

    private fun open(i: Intent) = runCatching { startActivity(i) }
}
