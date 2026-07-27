import { prisma } from "@/lib/db";
import { redactErrorMessage } from "@/lib/channels/redact";

// The background-job runner.
//
// Next.js ships no scheduler, and an in-process setInterval would be wrong here anyway —
// it dies with the process, and on more than one instance every job would run more than
// once. So jobs are driven by an EXTERNAL cron calling /api/jobs/run, and everything that
// makes that safe lives in this file: mutual exclusion, stale-lock recovery, failure
// isolation, and a recorded outcome for every run.

export const JOB_STATUS = {
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;

// A run still RUNNING after this long is assumed dead (process killed, container recycled)
// and may be taken over. Without this, one crash would block a job forever — the classic
// failure of a lock with no lease.
export const STALE_RUN_MINUTES = 30;

export type JobResult = {
  itemsProcessed: number;
  summary: string;
};

export type Job = {
  name: string;
  description: string;
  /** Runs for ONE enterprise. Must be safe to run repeatedly — cron delivery is at-least-once. */
  run: (enterpriseId: string) => Promise<JobResult>;
};

export type JobRunOutcome = {
  jobName: string;
  enterpriseId: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED_LOCKED";
  itemsProcessed: number;
  summary: string;
  error?: string;
};

/**
 * Release locks held by runs that are almost certainly dead.
 *
 * Marked FAILED rather than deleted: "this run died" is itself worth seeing in the trail,
 * and silently removing it would make a crash-looping job look like it never ran at all.
 */
export async function reclaimStaleRuns(jobName?: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000);
  const { count } = await prisma.jobRun.updateMany({
    where: {
      status: JOB_STATUS.RUNNING,
      startedAt: { lt: cutoff },
      ...(jobName ? { jobName } : {}),
    },
    data: {
      status: JOB_STATUS.FAILED,
      finishedAt: new Date(),
      error: `Run exceeded ${STALE_RUN_MINUTES} minutes and was assumed dead`,
    },
  });
  return count;
}

/**
 * Run one job for one enterprise, under the lock.
 *
 * Never throws: a job that fails for enterprise A must not stop the runner reaching
 * enterprise B, and a cron that 500s tells the operator nothing about which of fifty
 * enterprises actually broke. Failures are recorded and returned instead.
 */
export async function runJobForEnterprise(job: Job, enterpriseId: string): Promise<JobRunOutcome> {
  let runId: string;
  try {
    // Claiming the lock IS the insert — the partial unique index means a concurrent
    // invocation's insert fails instead of double-running the job.
    const created = await prisma.jobRun.create({
      data: { enterpriseId, jobName: job.name, status: JOB_STATUS.RUNNING },
      select: { id: true },
    });
    runId = created.id;
  } catch (e) {
    // P2002 = unique violation = this job is already running for this enterprise. Normal
    // and expected when cron fires faster than the job completes; not an error.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return {
        jobName: job.name,
        enterpriseId,
        status: "SKIPPED_LOCKED",
        itemsProcessed: 0,
        summary: "Already running",
      };
    }
    throw e;
  }

  try {
    const result = await job.run(enterpriseId);
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        status: JOB_STATUS.SUCCEEDED,
        finishedAt: new Date(),
        itemsProcessed: result.itemsProcessed,
        summary: result.summary,
      },
    });
    return {
      jobName: job.name,
      enterpriseId,
      status: "SUCCEEDED",
      itemsProcessed: result.itemsProcessed,
      summary: result.summary,
    };
  } catch (e) {
    // Redacted: a job error can quote a channel-manager response, and JobRun is plaintext
    // for the same reasons ChannelSyncLog is.
    const message = redactErrorMessage(e instanceof Error ? e.message : "Unknown error");
    await prisma.jobRun.update({
      where: { id: runId },
      data: { status: JOB_STATUS.FAILED, finishedAt: new Date(), error: message },
    });
    return {
      jobName: job.name,
      enterpriseId,
      status: "FAILED",
      itemsProcessed: 0,
      summary: "Failed",
      error: message,
    };
  }
}

/**
 * Run a job across every enterprise, sequentially.
 *
 * Sequential on purpose: these jobs make outbound calls to the channel manager, and firing
 * them at every enterprise at once would burst straight into a provider rate limit. Cron
 * cadence, not parallelism, is the throughput knob here.
 */
export async function runJobForAllEnterprises(job: Job): Promise<JobRunOutcome[]> {
  const enterprises = await prisma.enterprise.findMany({
    where: { type: "STANDARD" },
    select: { id: true },
  });

  const outcomes: JobRunOutcome[] = [];
  for (const e of enterprises) {
    outcomes.push(await runJobForEnterprise(job, e.id));
  }
  return outcomes;
}
