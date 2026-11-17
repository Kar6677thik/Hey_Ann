package gg.heyann.wall

import android.app.Activity
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// A handful of helpers so both screens can be plain Views built in code (no layouts, no libraries).

fun Activity.dp(v: Int) = (v * resources.displayMetrics.density).toInt()

/** A scrolling column that keeps clear of the status/navigation bars and the keyboard (edge-to-edge). */
fun Activity.screen(build: LinearLayout.() -> Unit): ScrollView {
    val col = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(16), dp(20), dp(24))
        build()
    }
    return ScrollView(this).apply {
        isFillViewport = true
        addView(col)
        setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }
    }
}

fun LinearLayout.text(s: CharSequence = "", size: Float = 15f, bold: Boolean = false, top: Int = 6): TextView =
    TextView(context).apply {
        text = s
        textSize = size
        if (bold) setTypeface(typeface, Typeface.BOLD)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = (top * resources.displayMetrics.density).toInt() }
    }.also { addView(it) }

fun LinearLayout.heading(s: String) = text(s, 19f, bold = true, top = 22)

fun LinearLayout.button(label: String, onClick: () -> Unit): Button =
    Button(context).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = (6 * resources.displayMetrics.density).toInt() }
    }.also { addView(it) }

fun LinearLayout.row(build: LinearLayout.() -> Unit): LinearLayout =
    LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        build()
    }.also { addView(it) }

fun View.show(v: Boolean) { visibility = if (v) View.VISIBLE else View.GONE }

fun mmss(ms: Long): String {
    val s = (ms + 999) / 1000
    return "%d:%02d".format(s / 60, s % 60)
}
