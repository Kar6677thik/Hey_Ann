package gg.heyann.wall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PolicyTest {
    private val own = "gg.heyann.wall"
    private val ig = "com.instagram.android"
    private val min = 60_000L

    private fun state(
        phase: String = "active",
        walled: Set<String> = setOf(ig),
        session: Session? = null,
        serverTime: Long = 1_000_000_000L,
        fetchedElapsed: Long = 5_000_000L,
        boot: Int = 7,
    ) = Snapshot(
        phase = phase, enforce = phase == "active", balance = 30, walledApps = walled, unlockMax = 20,
        session = session, emergencyCost = 30, emergencyMinutes = 15, emergencyLeft = 2, backReward = 1,
        serverTime = serverTime, fetchedElapsed = fetchedElapsed, fetchedBoot = boot,
    )

    private fun block(
        pkg: String?, s: Snapshot?, essentials: Set<String> = emptySet(), paused: Boolean = false,
        nowElapsed: Long = 5_000_000L, boot: Int = 7,
    ) = Policy.shouldBlock(pkg, s, own, essentials, paused, nowElapsed, boot)

    // ---- should block?

    @Test fun blocksWalledAppWhenActiveWithoutSession() = assertTrue(block(ig, state()))

    @Test fun neverBlocksInBaselineOrOff() {
        assertFalse(block(ig, state(phase = "baseline")))
        assertFalse(block(ig, state(phase = "off")))
    }

    @Test fun neverBlocksUnlistedApps() = assertFalse(block("com.spotify.music", state()))

    @Test fun neverBlocksWithoutAnyState() = assertFalse(block(ig, null))

    @Test fun neverBlocksWhenPaused() = assertFalse(block(ig, state(), paused = true))

    @Test fun neverBlocksNullOrBlank() {
        assertFalse(block(null, state()))
        assertFalse(block("", state()))
    }

    @Test fun neverBlocksEssentialsEvenIfServerWallsThem() {
        val everything = Policy.NEVER_BLOCK + own + "com.example.launcher" + "com.example.keyboard"
        val s = state(walled = everything)
        for (p in everything) assertFalse(p, block(p, s, essentials = setOf("com.example.launcher", "com.example.keyboard")))
        assertFalse(block("com.android.settings", s))
        assertFalse(block("com.android.systemui", s))
        assertFalse(block(own, s))
    }

    @Test fun runningSessionAllowsWalledApps() {
        val s = state(session = Session(1, ig, "spend", endsAt = 1_000_000_000L + 10 * min))
        assertFalse(block(ig, s, nowElapsed = 5_000_000L + 9 * min))
        assertTrue(block(ig, s, nowElapsed = 5_000_000L + 10 * min))   // ended on the local timer
    }

    @Test fun anySessionUnlocksAllWalledApps() {
        val yt = "com.google.android.youtube"
        val s = state(walled = setOf(ig, yt), session = Session(1, "*", "emergency", endsAt = 1_000_000_000L + 15 * min))
        assertFalse(block(yt, s))
    }

    @Test fun sessionEndUsesServerClockNotPhoneClock() {
        // Server says 10 min left. Whatever the phone's wall clock says, the end is 10 min of elapsed time after the fetch.
        val s = state(serverTime = 2_000_000_000_000L, session = Session(1, ig, "spend", endsAt = 2_000_000_000_000L + 10 * min))
        assertEquals(5_000_000L + 10 * min, Policy.sessionEndElapsed(s, 7))
        assertEquals(4 * min, Policy.sessionRemainingMs(s, 5_000_000L + 6 * min, 7))
    }

    @Test fun rebootEndsTheLocalSessionSoTheWallStaysClosedOffline() {
        val s = state(session = Session(1, ig, "spend", endsAt = 1_000_000_000L + 10 * min))
        assertNull(Policy.sessionEndElapsed(s, bootNow = 8))
        assertTrue(block(ig, s, nowElapsed = 1_000, boot = 8))
    }

    @Test fun staleCacheStillWallsWhenOffline() {
        // State fetched long ago (no network since): walled apps stay walled.
        assertTrue(block(ig, state(fetchedElapsed = 1_000L), nowElapsed = 1_000L + 24 * 60 * min))
    }

    // ---- gaps

    private val now = 1_800_000_000_000L
    private val bootWall = now - 48 * 60 * min      // booted two days ago

    @Test fun reportsGapOverFifteenMinutes() =
        assertEquals(20, Policy.gapMinutes(now, now - 20 * min, 7, 7, bootWall, enforce = true))

    @Test fun noGapAtOrUnderFifteen() {
        assertNull(Policy.gapMinutes(now, now - 15 * min, 7, 7, bootWall, true))
        assertNull(Policy.gapMinutes(now, now - 3 * min, 7, 7, bootWall, true))
    }

    @Test fun rebootIsNotAGap() {
        // Boot counter moved.
        assertNull(Policy.gapMinutes(now, now - 300 * min, 7, 8, now - 2 * min, true))
        // Boot counter unavailable (-1 both times) but the phone booted after lastAlive.
        assertNull(Policy.gapMinutes(now, now - 300 * min, -1, -1, now - 2 * min, true))
    }

    @Test fun noGapInBaselineOrWithoutHistory() {
        assertNull(Policy.gapMinutes(now, now - 60 * min, 7, 7, bootWall, enforce = false))
        assertNull(Policy.gapMinutes(now, 0, -1, 7, bootWall, true))
        assertNull(Policy.gapMinutes(now, now + 60 * min, 7, 7, bootWall, true)) // clock went backwards
    }

    @Test fun pauseIsReportedOnceAfterFifteenMinutes() {
        assertNull(Policy.pauseGapMinutes(now, now - 10 * min, false, true))
        assertEquals(16, Policy.pauseGapMinutes(now, now - 16 * min, false, true))
        assertNull(Policy.pauseGapMinutes(now, now - 16 * min, true, true))
        assertNull(Policy.pauseGapMinutes(now, now - 60 * min, false, enforce = false))
        assertNull(Policy.pauseGapMinutes(now, 0, false, true))
    }

    // ---- usage aggregation

    @Test fun foregroundMinutesFromEvents() {
        val start = 0L; val end = 24 * 60 * min
        val ev = listOf(
            Policy.UsageEvent(10 * min, ig, "Main", Policy.RESUMED),
            Policy.UsageEvent(40 * min, ig, "Main", Policy.PAUSED),
            Policy.UsageEvent(50 * min, "com.b", "A", Policy.RESUMED),
            Policy.UsageEvent(55 * min, "com.b", "A", Policy.PAUSED),
            Policy.UsageEvent(56 * min, "com.b", "A", Policy.PAUSED),  // duplicate pause/stop: ignored
        )
        assertEquals(mapOf(ig to 30, "com.b" to 5), Policy.foregroundMinutes(ev, start, end))
    }

    @Test fun foregroundMinutesAcrossDayEdgesAndShutdown() {
        val start = 100 * min; val end = 200 * min
        val ev = listOf(
            Policy.UsageEvent(110 * min, ig, "Main", Policy.PAUSED),          // already open at start: counts from start
            Policy.UsageEvent(150 * min, "com.c", "X", Policy.RESUMED),
            Policy.UsageEvent(160 * min, "com.c", "X", Policy.SHUTDOWN),
            Policy.UsageEvent(170 * min, "com.c", "X", Policy.PAUSED),        // after shutdown: no open interval
            Policy.UsageEvent(190 * min, "com.d", "Y", Policy.RESUMED),       // still open at end
        )
        assertEquals(mapOf(ig to 10, "com.c" to 10, "com.d" to 10), Policy.foregroundMinutes(ev, start, end))
    }
}
