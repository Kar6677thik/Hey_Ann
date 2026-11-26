package gg.heyann.wall

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/**
 * Sends the usage report about once an hour whenever there is a network, independent of the accessibility service.
 * So pausing, switching the wall off or going offline for a while never makes walled-app time free: it is billed
 * once the phone reaches Hey Ann again (the report covers the last 7 days).
 */
class ReportJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        Store.init(this)
        if (!Store.configured) return false
        Api.state(this) { }
        Usage.reportIfDue(this) { jobFinished(params, false) }
        return true
    }

    override fun onStopJob(params: JobParameters) = true

    companion object {
        private const val ID = 4207

        fun schedule(ctx: Context) {
            runCatching {
                val js = ctx.getSystemService(JobScheduler::class.java)
                if (js.getPendingJob(ID) != null) return
                js.schedule(
                    JobInfo.Builder(ID, ComponentName(ctx, ReportJob::class.java))
                        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                        .setPeriodic(60 * 60_000L, 15 * 60_000L)
                        .setPersisted(true)
                        .build(),
                )
            }
        }
    }
}
