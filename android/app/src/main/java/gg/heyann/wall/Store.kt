package gg.heyann.wall

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Everything the app remembers. One process, so the service and the screens share this object. */
object Store {
    const val DEFAULT_URL = "https://heyann.tailf67d61.ts.net"
    private const val KEY_ALIAS = "heyann_device_token"

    private lateinit var prefs: SharedPreferences
    @Volatile var snapshot: Snapshot? = null
        private set

    /** Called on the main thread after every fresh state (the service uses it to time the session end). */
    var onState: (() -> Unit)? = null

    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        prefs = ctx.applicationContext.getSharedPreferences("wall", Context.MODE_PRIVATE)
        snapshot = prefs.getString("state", null)?.let { runCatching { parse(JSONObject(it), prefs.getLong("state_elapsed", 0), prefs.getInt("state_boot", -1)) }.getOrNull() }
    }

    // ---- server + token

    var serverUrl: String
        get() = prefs.getString("url", DEFAULT_URL) ?: DEFAULT_URL
        set(v) = prefs.edit().putString("url", v.trim().trimEnd('/')).apply()

    /** The device token, encrypted with an AES key that never leaves the Android Keystore. */
    var token: String?
        get() = prefs.getString("token", null)?.let { runCatching { decrypt(it) }.getOrNull() }
        set(v) {
            if (v.isNullOrBlank()) prefs.edit().remove("token").apply()
            else prefs.edit().putString("token", encrypt(v.trim())).apply()
        }

    val configured get() = !token.isNullOrBlank()

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val out = c.iv + c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val raw = Base64.decode(stored, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
        return String(c.doFinal(raw, 12, raw.size - 12))
    }

    // ---- cached wallet state

    fun saveState(json: JSONObject, ctx: Context) {
        val now = SystemClock.elapsedRealtime()
        val boot = bootCount(ctx)
        snapshot = parse(json, now, boot)
        prefs.edit().putString("state", json.toString()).putLong("state_elapsed", now).putInt("state_boot", boot)
            .putLong("state_wall", System.currentTimeMillis()).apply()
    }

    val stateFetchedWall get() = prefs.getLong("state_wall", 0)

    private fun parse(j: JSONObject, elapsed: Long, boot: Int): Snapshot {
        val walled = j.optJSONArray("walled_apps")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
        val s = j.optJSONObject("session")
        val em = j.optJSONObject("emergency")
        return Snapshot(
            phase = j.optString("phase", "off"),
            enforce = j.optBoolean("enforce", false),
            balance = j.optInt("balance", 0),
            walledApps = walled,
            unlockMax = j.optInt("unlock_max", 20),
            session = s?.let { Session(it.getLong("id"), it.optString("app"), it.optString("kind"), it.getLong("ends_at")) },
            emergencyCost = em?.optInt("cost", 30) ?: 30,
            emergencyMinutes = em?.optInt("minutes", 15) ?: 15,
            emergencyLeft = em?.optInt("left", 0) ?: 0,
            backReward = j.optInt("back_reward", 1),
            serverTime = j.optLong("server_time", System.currentTimeMillis()),
            fetchedElapsed = elapsed,
            fetchedBoot = boot,
        )
    }

    // ---- protection: pause and liveness

    val paused get() = prefs.getLong("paused_at", 0) > 0
    val pausedAt get() = prefs.getLong("paused_at", 0)
    var pauseGapReported: Boolean
        get() = prefs.getBoolean("pause_gap_reported", false)
        set(v) = prefs.edit().putBoolean("pause_gap_reported", v).apply()

    fun pause() = prefs.edit().putLong("paused_at", System.currentTimeMillis()).putBoolean("pause_gap_reported", false).apply()
    fun resume(ctx: Context) {
        prefs.edit().remove("paused_at").remove("pause_gap_reported").apply()
        markAlive(ctx) // the pause is reported on its own, so it must not also count as a gap later
    }

    val lastAliveWall get() = prefs.getLong("alive_wall", 0)
    val lastAliveBoot get() = prefs.getInt("alive_boot", -1)
    fun markAlive(ctx: Context) =
        prefs.edit().putLong("alive_wall", System.currentTimeMillis()).putInt("alive_boot", bootCount(ctx)).apply()

    /** A gap waiting to be sent (we may be offline when the service comes back). */
    var pendingGap: Int
        get() = prefs.getInt("pending_gap", 0)
        set(v) = prefs.edit().putInt("pending_gap", v).apply()

    var lastUsageReport: Long
        get() = prefs.getLong("usage_at", 0)
        set(v) = prefs.edit().putLong("usage_at", v).apply()

    var lastError: String?
        get() = prefs.getString("last_error", null)
        set(v) = prefs.edit().putString("last_error", v).apply()

    /** Reading a global setting is read-only and needs no permission. -1 if unavailable. */
    fun bootCount(ctx: Context): Int =
        runCatching { Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT) }.getOrDefault(-1)
}
