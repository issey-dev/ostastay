import { NextResponse } from "next/server";
import { JOBS, findJob } from "@/lib/jobs";
import { runJobForAllEnterprises, reclaimStaleRuns } from "@/lib/jobs/runner";
import { verifyCronSecret, CRON_SECRET_HEADER } from "@/lib/jobs/auth";

// The cron entry point. Next.js has no scheduler, so an external one calls this:
//
//   curl -X POST https://<host>/api/jobs/run -H "x-cron-secret: $CRON_SECRET"
//
// Optional ?job=<name> runs a single job; with no parameter every registered job runs.
// Hourly is a sensible default — both current jobs are cheap when nothing is due, and the
// keep-alive wants plenty of slack against Beds24's 30-day window.
//
// Not a session route: there is no user here, so it is guarded by a shared secret that
// fails closed (see src/lib/jobs/auth.ts). Force-dynamic because it must never be
// prerendered or cached — it is entirely side effects.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = verifyCronSecret(request.headers.get(CRON_SECRET_HEADER));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("job");

  const jobs = requested ? [findJob(requested)].filter(Boolean) : [...JOBS];
  if (requested && jobs.length === 0) {
    return NextResponse.json(
      { error: `Unknown job "${requested}"`, available: JOBS.map((j) => j.name) },
      { status: 400 }
    );
  }

  // Release locks from runs that died before this cycle claims its own, so one crashed
  // container cannot wedge a job permanently.
  const reclaimed = await reclaimStaleRuns(requested ?? undefined);

  const startedAt = Date.now();
  const results = [];
  for (const job of jobs) {
    // runJobForAllEnterprises never throws — one enterprise failing must not stop the rest,
    // and a 500 here would tell the operator nothing about which enterprise broke.
    results.push({ job: job!.name, outcomes: await runJobForAllEnterprises(job!) });
  }

  const flat = results.flatMap((r) => r.outcomes);
  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    staleRunsReclaimed: reclaimed,
    jobsRun: results.map((r) => r.job),
    summary: {
      succeeded: flat.filter((o) => o.status === "SUCCEEDED").length,
      failed: flat.filter((o) => o.status === "FAILED").length,
      skippedLocked: flat.filter((o) => o.status === "SKIPPED_LOCKED").length,
    },
    results,
  });
}

// Discovery for whoever is wiring up the scheduler: which jobs exist, without running them.
// Same secret — the job list is deployment detail, not public information.
export async function GET(request: Request) {
  const auth = verifyCronSecret(request.headers.get(CRON_SECRET_HEADER));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({
    jobs: JOBS.map((j) => ({ name: j.name, description: j.description })),
  });
}
