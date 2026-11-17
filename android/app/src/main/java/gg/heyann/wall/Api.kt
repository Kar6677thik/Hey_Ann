package gg.heyann.wall

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class ApiError(message: String, val status: Int = 0) : Exception(message)

/**
 * The phone endpoints under /api/phone. Calls run on one background thread; callbacks land on the main thread.
 * Any reply that carries a fresh `state` updates the cache.
 */
object Api {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun state(ctx: Context, done: (Result<JSONObject>) -> Unit = {}) = call(ctx, "GET", "/state", null, done)

    fun back(ctx: Context, done: (Result<JSONObject>) -> Unit = {}) = call(ctx, "POST", "/back", JSONObject(), done)

    fun startSession(ctx: Context, app: String, minutes: Int, done: (Result<JSONObject>) -> Unit) =
        call(ctx, "POST", "/session", JSONObject().put("action", "start").put("app", app).put("minutes", minutes), done)

    fun stopSession(ctx: Context, id: Long, done: (Result<JSONObject>) -> Unit) =
        call(ctx, "POST", "/session", JSONObject().put("action", "stop").put("id", id), done)

    fun emergency(ctx: Context, reason: String, done: (Result<JSONObject>) -> Unit) =
        call(ctx, "POST", "/emergency", JSONObject().put("reason", reason), done)

    fun gap(ctx: Context, minutes: Int, done: (Result<JSONObject>) -> Unit) =
        call(ctx, "POST", "/gap", JSONObject().put("minutes", minutes), done)

    fun usage(ctx: Context, day: String, apps: Map<String, Int>, done: (Result<JSONObject>) -> Unit) =
        call(ctx, "POST", "/usage", JSONObject().put("day", day).put("apps", JSONObject(apps as Map<*, *>)), done)

    /** Every call goes through here: one background thread, result posted to the main thread. */
    private fun call(ctx: Context, method: String, path: String, body: JSONObject?, done: (Result<JSONObject>) -> Unit) {
        val app = ctx.applicationContext
        if (Store.demo) { main.post { done(Result.success(JSONObject())) }; return }
        io.execute {
            val r = runCatching { request(method, path, body) }
            r.onSuccess { j ->
                val st = if (path == "/state") j else j.optJSONObject("state")
                if (st != null) Store.saveState(st, app)
                Store.lastError = null
            }.onFailure { Store.lastError = it.message }
            main.post {
                if (r.isSuccess) runCatching { Store.onState?.invoke() }
                done(r)
            }
        }
    }

    private fun request(method: String, path: String, body: JSONObject?): JSONObject {
        val token = Store.token ?: throw ApiError("Not paired yet: add the device token in Setup.")
        val conn = URL("${Store.serverUrl}/api/phone$path").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Accept", "application/json")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = runCatching { JSONObject(text) }.getOrNull()
            if (code !in 200..299) {
                val msg = json?.optString("error")?.takeIf { it.isNotBlank() } ?: "HTTP $code"
                throw ApiError(if (code == 401) "Token rejected: pair the phone again. ($msg)" else msg, code)
            }
            return json ?: throw ApiError("Unexpected reply from the server.")
        } catch (e: ApiError) {
            throw e
        } catch (e: Exception) {
            throw ApiError("Can't reach Hey Ann (${e.javaClass.simpleName}). Is Tailscale on?")
        } finally {
            conn.disconnect()
        }
    }
}
