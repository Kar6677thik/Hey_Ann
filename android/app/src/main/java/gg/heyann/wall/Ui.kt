package gg.heyann.wall

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// A small design kit so both screens are plain Views built in code (no layouts, no libraries).
// Colours are the Hey Ann web app's dark tokens (web/src/styles.css).

object C {
    const val ground = 0xFF151517.toInt()
    const val surface = 0xFF111114.toInt()
    const val raised = 0xFF1C1C20.toInt()
    const val border = 0xFF242428.toInt()
    const val borderStrong = 0xFF303036.toInt()
    const val rule = 0xFF1D1D21.toInt()
    const val text = 0xFFF2F2F3.toInt()
    const val muted = 0xFFA6A7AD.toInt()
    const val faint = 0xFF87888F.toInt()
    const val primary = 0xFFF2F2F3.toInt()
    const val primaryInk = 0xFF111114.toInt()
    const val accent = 0xFF4A8AD6.toInt()
    const val accentInk = 0xFF8BB6EC.toInt()
    const val accentSoft = 0x244A8AD6
    const val positive = 0xFF44A282.toInt()
    const val negative = 0xFFE5566F.toInt()
    const val warning = 0xFFD9A441.toInt()
}

enum class Tone(val bg: Int, val ink: Int) {
    Neutral(0xFF212125.toInt(), 0xFFC4C5CA.toInt()),
    Accent(C.accentSoft, C.accentInk),
    Positive(0xFF1B2828.toInt(), 0xFF5FC39C.toInt()),
    Negative(0xFF2C1A20.toInt(), 0xFFEF7B8F.toInt()),
    Warning(0xFF2A2416.toInt(), 0xFFE0B25A.toInt()),
}

object Fonts {
    private var regular: Typeface? = null
    private var medium: Typeface? = null
    fun mono(ctx: Context, bold: Boolean = false): Typeface {
        if (regular == null) {
            regular = runCatching { ctx.resources.getFont(R.font.jetbrains_mono_regular) }.getOrDefault(Typeface.MONOSPACE)
            medium = runCatching { ctx.resources.getFont(R.font.jetbrains_mono_medium) }.getOrDefault(Typeface.MONOSPACE)
        }
        return (if (bold) medium else regular)!!
    }
    val sans: Typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    val sansMedium: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
}

fun Context.dp(v: Number): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
fun View.dp(v: Number): Int = context.dp(v)

fun rounded(fill: Int, radius: Int, stroke: Int = 0, strokeWidth: Int = 0) = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = radius.toFloat()
    if (strokeWidth > 0) setStroke(strokeWidth, stroke)
}

private fun ripple(content: Drawable, color: Int, radius: Int) =
    RippleDrawable(ColorStateList.valueOf(color), content, rounded(0xFFFFFFFF.toInt(), radius))

val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

fun lp(w: Int = MATCH, h: Int = WRAP, weight: Float = 0f, top: Int = 0) =
    LinearLayout.LayoutParams(w, h, weight).apply { topMargin = top }

/** Dark, edge-to-edge page: transparent bars with light icons, content padded clear of bars, cutout and keyboard. */
fun Activity.page(build: LinearLayout.() -> Unit): ScrollView {
    // Android 15+ is edge-to-edge already; opt in on 10-14 so all versions lay out the same way.
    if (Build.VERSION.SDK_INT >= 35) Unit
    else if (Build.VERSION.SDK_INT >= 30) @Suppress("DEPRECATION") window.setDecorFitsSystemWindows(false)
    else @Suppress("DEPRECATION") {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }
    val col = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(12), dp(16), dp(24))
        build()
    }
    return ScrollView(this).apply {
        setBackgroundColor(C.ground)
        isFillViewport = true
        clipToPadding = true // content never scrolls under the transparent status bar
        addView(col, ViewGroup.LayoutParams(MATCH, MATCH))
        setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else @Suppress("DEPRECATION") {
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }
}

/** A card: one tone darker than the page, 1px hairline border, 12dp corners. */
fun LinearLayout.card(top: Int = 12, build: LinearLayout.() -> Unit): LinearLayout =
    LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(C.surface, dp(12), C.border, 1)
        setPadding(dp(16), dp(16), dp(16), dp(16))
        layoutParams = lp(top = dp(top))
        build()
    }.also { addView(it) }

enum class T(val size: Float, val color: Int, val medium: Boolean) {
    Display(24f, C.text, true),
    Title(17f, C.text, true),
    Heading(15f, C.text, true),
    Body(15f, C.text, false),
    Muted(14f, C.muted, false),
    Small(13f, C.muted, false),
    Faint(12.5f, C.faint, false),
}

fun LinearLayout.text(s: CharSequence = "", t: T = T.Body, top: Int = 0, center: Boolean = false): TextView =
    TextView(context).apply {
        text = s
        textSize = t.size
        setTextColor(t.color)
        typeface = if (t.medium) Fonts.sansMedium else Fonts.sans
        setLineSpacing(0f, 1.2f)
        if (center) gravity = Gravity.CENTER_HORIZONTAL
        layoutParams = lp(top = dp(top))
    }.also { addView(it) }

/** Numbers: JetBrains Mono (every figure is the same width, so countdowns don't jitter). */
fun LinearLayout.mono(s: CharSequence = "", size: Float = 15f, color: Int = C.text, bold: Boolean = false, top: Int = 0, w: Int = WRAP): TextView =
    TextView(context).apply {
        text = s
        textSize = size
        setTextColor(color)
        typeface = Fonts.mono(context, bold)
        includeFontPadding = false
        layoutParams = lp(w = w, top = dp(top))
    }.also { addView(it) }

fun LinearLayout.row(top: Int = 0, gravity: Int = Gravity.CENTER_VERTICAL, build: LinearLayout.() -> Unit): LinearLayout =
    LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        this.gravity = gravity
        layoutParams = lp(top = dp(top))
        build()
    }.also { addView(it) }

fun LinearLayout.space(weight: Float = 1f) = View(context).apply { layoutParams = lp(w = 0, h = 0, weight = weight) }.also { addView(it) }

fun LinearLayout.divider(top: Int = 12) =
    View(context).apply { setBackgroundColor(C.rule); layoutParams = lp(h = 1, top = dp(top)) }.also { addView(it) }

/** Small rounded label, e.g. "Wall is up". */
fun LinearLayout.pill(s: String = "", tone: Tone = Tone.Neutral): TextView =
    TextView(context).apply {
        text = s
        textSize = 12.5f
        typeface = Fonts.sansMedium
        setPill(tone)
        setPadding(dp(10), dp(4), dp(10), dp(4))
        layoutParams = lp(w = WRAP)
    }.also { addView(it) }

fun TextView.setPill(tone: Tone) {
    background = rounded(tone.bg, dp(999))
    setTextColor(tone.ink)
}

enum class Btn { Primary, Secondary, Quiet }

/** Buttons are TextViews with a ripple: 48dp minimum touch target, sentence case. */
fun LinearLayout.button(label: String, kind: Btn = Btn.Secondary, w: Int = MATCH, top: Int = 0, onClick: () -> Unit): TextView =
    TextView(context).apply {
        text = label
        textSize = if (kind == Btn.Quiet) 14f else 15f
        typeface = Fonts.sansMedium
        gravity = Gravity.CENTER
        minHeight = dp(48)
        minimumHeight = dp(48)
        setPadding(dp(if (kind == Btn.Quiet) 8 else 18), 0, dp(if (kind == Btn.Quiet) 8 else 18), 0)
        styleButton(kind)
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
        layoutParams = lp(w = w, top = dp(top))
    }.also { addView(it) }

fun TextView.styleButton(kind: Btn) {
    val r = dp(12)
    when (kind) {
        Btn.Primary -> { setTextColor(C.primaryInk); background = ripple(rounded(C.primary, r), 0x33000000, r) }
        Btn.Secondary -> { setTextColor(C.text); background = ripple(rounded(0, r, C.borderStrong, dp(1)), 0x22FFFFFF, r) }
        Btn.Quiet -> { setTextColor(C.muted); background = ripple(rounded(0, r), 0x22FFFFFF, r) }
    }
}

fun View.enable(on: Boolean) {
    isEnabled = on
    alpha = if (on) 1f else 0.38f
}

fun View.show(v: Boolean) { visibility = if (v) View.VISIBLE else View.GONE }

fun LinearLayout.field(hint: String, value: String = "", secret: Boolean = false, top: Int = 8): EditText =
    EditText(context).apply {
        this.hint = hint
        setText(value)
        textSize = 15f
        setTextColor(C.text)
        setHintTextColor(C.faint)
        inputType = if (secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        typeface = if (secret) Fonts.mono(context) else Fonts.sans // after inputType, which resets it
        isSingleLine = true
        minHeight = dp(48)
        background = rounded(C.raised, dp(10), C.border, 1)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        if (Build.VERSION.SDK_INT >= 29) textCursorDrawable = rounded(C.accent, 0).apply { setSize(dp(2), dp(20)) }
        layoutParams = lp(top = dp(top))
    }.also { addView(it) }

/** A tinted note inside a card or page (warnings, confirmations). */
fun LinearLayout.notice(s: CharSequence = "", tone: Tone = Tone.Warning, top: Int = 12): TextView =
    TextView(context).apply {
        text = s
        textSize = 13.5f
        setLineSpacing(0f, 1.2f)
        setTextColor(tone.ink)
        background = rounded(tone.bg, dp(10))
        setPadding(dp(12), dp(10), dp(12), dp(10))
        layoutParams = lp(top = dp(top))
    }.also { addView(it) }

/** Checklist mark: a green tick when done, an empty ring when not. */
fun LinearLayout.checkMark(): ImageView =
    ImageView(context).apply {
        setImageResource(R.drawable.ic_check)
        scaleType = ImageView.ScaleType.CENTER
        layoutParams = LinearLayout.LayoutParams(dp(24), dp(24)).apply { marginEnd = dp(12) }
    }.also { addView(it) }

fun ImageView.setDone(done: Boolean) {
    if (done) {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Tone.Positive.bg) }
        imageTintList = ColorStateList.valueOf(Tone.Positive.ink)
        imageAlpha = 255
    } else {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(1.5f), C.borderStrong) }
        imageAlpha = 0
    }
}

/** A thin progress track (no gradients): fraction 0..1. */
class Bar(ctx: Context, private val color: Int = C.accent) : View(ctx) {
    var fraction = 0f
        set(v) { field = v.coerceIn(0f, 1f); invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    override fun onDraw(canvas: Canvas) {
        val r = height / 2f
        paint.color = C.raised
        rect.set(0f, 0f, width.toFloat(), height.toFloat()); canvas.drawRoundRect(rect, r, r, paint)
        paint.color = color
        rect.set(0f, 0f, width * fraction, height.toFloat()); if (fraction > 0) canvas.drawRoundRect(rect, r, r, paint)
    }
}

fun LinearLayout.bar(top: Int = 12, color: Int = C.accent): Bar =
    Bar(context, color).apply { layoutParams = lp(h = dp(4), top = dp(top)) }.also { addView(it) }

fun mmss(ms: Long): String {
    val s = (ms + 999) / 1000
    return "%d:%02d".format(s / 60, s % 60)
}

/** "just now" / "5 minutes ago" / "2 hours ago". */
fun ago(wall: Long): String {
    val d = System.currentTimeMillis() - wall
    return if (d < 60_000) "just now" else android.text.format.DateUtils.getRelativeTimeSpanString(wall).toString()
}

/** "−12" with a real minus sign. */
fun signed(n: Int) = if (n < 0) "−${-n}" else "$n"
