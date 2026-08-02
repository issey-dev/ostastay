import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-job-runner-key";

const { prisma } = await import("@/lib/db");
const { runJobForEnterprise, runJobForAllEnterprises, reclaimStaleRuns, STALE_RUN_MINUTES, JOB_STATUS } =
  await import("@/lib/jobs/runner");
const { channelKeepAliveJob, channelLogPruneJob, JOBS, findJob, SYNC_LOG_RETENTION_DAYS } = await import(
  "@/lib/jobs"
);
const { verifyCronSecret } = await import("@/lib/jobs/auth");
const { createConnection } = await import("@/lib/channels/connection");
const jobsRoute = await import("@/app/api/jobs/run/route");

function stubBeds24(response: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => response }) as unknown as Response)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("Background job runner", () => {
  let enterpriseId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Job Ent ${Date.now()}`, slug: `test-job-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 1 } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
  });

  // ---------------------------------------------------------------------------
  // Cron authentication — this endpoint runs privileged work across every enterprise.
  // ---------------------------------------------------------------------------

  it("FAILS CLOSED when CRON_SECRET is unset — refuses rather than running unauthenticated", () => {
    delete process.env.CRON_SECRET;
    const result = verifyCronSecret("anything");
    expect(result.ok).toBe(false);
    // 503, not 401: the caller's credentials are not the problem, the server is unconfigured.
    expect(result.ok === false && result.status).toBe(503);
  });

  it("rejects a missing or wrong secret and accepts the right one", () => {
    process.env.CRON_SECRET = "correct-horse-battery-staple";

    expect(verifyCronSecret(null).ok).toBe(false);
    expect(verifyCronSecret("wrong").ok).toBe(false);
    // A wrong secret of a DIFFERENT LENGTH must also compare cleanly rather than throwing —
    // this is why the implementation hashes before timingSafeEqual.
    expect(verifyCronSecret("x").ok).toBe(false);
    expect(verifyCronSecret("correct-horse-battery-staple").ok).toBe(true);
  });

  it("the endpoint refuses an unauthenticated request", async () => {
    process.env.CRON_SECRET = "endpoint-secret";
    const res = await jobsRoute.POST(new Request("http://localhost/api/jobs/run", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("the endpoint rejects an unknown job name with the available list", async () => {
    process.env.CRON_SECRET = "endpoint-secret";
    const res = await jobsRoute.POST(
      new Request("http://localhost/api/jobs/run?job=does-not-exist", {
        method: "POST",
        headers: { "x-cron-secret": "endpoint-secret" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.available).toContain("channel-keepalive");
  });

  // ---------------------------------------------------------------------------
  // Mutual exclusion — the partial unique index is what makes overlapping cron safe.
  // ---------------------------------------------------------------------------

  // What the partial index actually guarantees is that the job never executes CONCURRENTLY
  // with itself for one enterprise — that is what would double-post charges. It does not
  // guarantee "at most one execution per pair of cron hits".
  //
  // The distinction was invisible under SQLite, which serialises every write globally: the
  // second INSERT was always attempted while the first row was still RUNNING, so it always
  // lost. On Postgres the two claims are genuinely independent, and if the first job
  // finishes before the second INSERT lands, that row is already SUCCEEDED and no longer in
  // the partial index (WHERE status = 'RUNNING'), so the second claim legitimately succeeds
  // and the job runs again — sequentially, never overlapping. That is explicitly in
  // contract: `Job.run` is documented as "must be safe to run repeatedly — cron delivery is
  // at-least-once".
  //
  // So this asserts peak concurrency rather than a call count, which is both the real
  // invariant and robust to scheduling. Verified separately that a genuinely overlapping
  // claim is still rejected with P2002 -> SKIPPED_LOCKED.
  it("never runs the same job concurrently for one enterprise", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const slowJob = {
      name: `slow-${Date.now()}`,
      description: "test",
      run: async () => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 250));
        inFlight -= 1;
        return { itemsProcessed: 1, summary: "done" };
      },
    };

    const [a, b] = await Promise.all([
      runJobForEnterprise(slowJob, enterpriseId),
      runJobForEnterprise(slowJob, enterpriseId),
    ]);

    // The one that matters: the two executions never overlapped.
    expect(peakInFlight).toBe(1);
    // Neither invocation may fail; each either ran or saw the lock.
    for (const status of [a.status, b.status]) {
      expect(["SUCCEEDED", "SKIPPED_LOCKED"]).toContain(status);
    }
  });

  it("the same job CAN run concurrently for different enterprises", async () => {
    const other = await prisma.enterprise.create({
      data: { name: `Job Other ${Date.now()}`, slug: `test-job-o-${Date.now()}`, type: "STANDARD" },
    });
    const job = {
      name: `per-ent-${Date.now()}`,
      description: "test",
      run: async () => ({ itemsProcessed: 1, summary: "ok" }),
    };

    const [a, b] = await Promise.all([
      runJobForEnterprise(job, enterpriseId),
      runJobForEnterprise(job, other.id),
    ]);
    // The lock is per (job, enterprise) — one slow tenant must not block every other.
    expect(a.status).toBe("SUCCEEDED");
    expect(b.status).toBe("SUCCEEDED");
  });

  it("reclaims a stale RUNNING row so one crash cannot wedge a job forever", async () => {
    const jobName = `stale-${Date.now()}`;
    const stuck = await prisma.jobRun.create({
      data: {
        enterpriseId,
        jobName,
        status: JOB_STATUS.RUNNING,
        startedAt: new Date(Date.now() - (STALE_RUN_MINUTES + 5) * 60 * 1000),
      },
    });

    // Before reclaim the lock is held, so a fresh run is refused.
    const blocked = await runJobForEnterprise(
      { name: jobName, description: "t", run: async () => ({ itemsProcessed: 0, summary: "" }) },
      enterpriseId
    );
    expect(blocked.status).toBe("SKIPPED_LOCKED");

    const reclaimed = await reclaimStaleRuns(jobName);
    expect(reclaimed).toBe(1);

    // Marked FAILED, not deleted — a crash-looping job must remain visible in the trail.
    const after = await prisma.jobRun.findUnique({ where: { id: stuck.id } });
    expect(after?.status).toBe(JOB_STATUS.FAILED);
    expect(after?.error).toContain("assumed dead");

    // And the job can now run again.
    const now = await runJobForEnterprise(
      { name: jobName, description: "t", run: async () => ({ itemsProcessed: 3, summary: "ok" }) },
      enterpriseId
    );
    expect(now.status).toBe("SUCCEEDED");
  });

  it("does NOT reclaim a run that is merely still in progress", async () => {
    const jobName = `fresh-${Date.now()}`;
    await prisma.jobRun.create({ data: { enterpriseId, jobName, status: JOB_STATUS.RUNNING } });
    expect(await reclaimStaleRuns(jobName)).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Failure isolation
  // ---------------------------------------------------------------------------

  it("records a throwing job as FAILED and never throws out of the runner", async () => {
    const boom = {
      name: `boom-${Date.now()}`,
      description: "test",
      run: async () => {
        throw new Error("job exploded");
      },
    };

    // Must resolve, not reject — a 500 from cron says nothing about which enterprise broke.
    const outcome = await runJobForEnterprise(boom, enterpriseId);
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("job exploded");

    const row = await prisma.jobRun.findFirst({ where: { jobName: boom.name } });
    expect(row?.status).toBe(JOB_STATUS.FAILED);
    expect(row?.finishedAt).not.toBeNull();
  });

  it("one enterprise failing does not stop the others", async () => {
    const failFor = enterpriseId;
    const job = {
      name: `partial-${Date.now()}`,
      description: "test",
      run: async (entId: string) => {
        if (entId === failFor) throw new Error("only this one");
        return { itemsProcessed: 1, summary: "ok" };
      },
    };

    const outcomes = await runJobForAllEnterprises(job);
    expect(outcomes.length).toBeGreaterThan(1);
    expect(outcomes.some((o) => o.status === "FAILED")).toBe(true);
    // The rest still ran — the failure was isolated, not fatal.
    expect(outcomes.some((o) => o.status === "SUCCEEDED")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // The jobs themselves
  // ---------------------------------------------------------------------------

  it("keep-alive refreshes only connections actually due, leaving fresh ones alone", async () => {
    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    const fresh = await createConnection({ enterpriseId, name: `Fresh ${Date.now()}`, inviteCode: "x" });
    const stale = await createConnection({ enterpriseId, name: `Stale ${Date.now()}`, inviteCode: "y" });

    // Age one past the keep-alive threshold.
    await prisma.channelConnection.update({
      where: { id: stale.id },
      data: { lastTokenRefreshAt: new Date(Date.now() - 25 * DAY_MS) },
    });

    stubBeds24({ token: "new-access", expiresIn: 86400 });
    const result = await channelKeepAliveJob.run(enterpriseId);

    expect(result.itemsProcessed).toBe(1);

    // The stale one was refreshed...
    const staleAfter = await prisma.channelConnection.findUnique({ where: { id: stale.id } });
    expect(Date.now() - staleAfter!.lastTokenRefreshAt!.getTime()).toBeLessThan(60 * 1000);

    // ...and the fresh one was left untouched, so this stays cheap run hourly.
    const freshAfter = await prisma.channelConnection.findUnique({ where: { id: fresh.id } });
    expect(freshAfter!.lastTokenRefreshAt!.getTime()).toBeLessThan(staleAfter!.lastTokenRefreshAt!.getTime());
  });

  it("keep-alive keeps going when one connection's credentials are dead", async () => {
    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    const dead = await createConnection({ enterpriseId, name: `Dead ${Date.now()}`, inviteCode: "z" });
    await prisma.channelConnection.update({
      where: { id: dead.id },
      data: { lastTokenRefreshAt: new Date(Date.now() - 28 * DAY_MS) },
    });

    stubBeds24({ error: "Refresh token expired" }, false, 401);
    const result = await channelKeepAliveJob.run(enterpriseId);

    // Reports the failure without throwing — the other connections still got their turn.
    expect(result.summary).toContain("still failing");
  });

  it("prune removes entries past the retention window and leaves recent ones", async () => {
    await prisma.channelSyncLog.create({
      data: {
        enterpriseId,
        connectionName: "Old",
        direction: "OUTBOUND",
        operation: "auth.token",
        ok: true,
        createdAt: new Date(Date.now() - (SYNC_LOG_RETENTION_DAYS + 10) * DAY_MS),
      },
    });
    const recent = await prisma.channelSyncLog.create({
      data: { enterpriseId, connectionName: "Recent", direction: "OUTBOUND", operation: "auth.token", ok: true },
    });

    const result = await channelLogPruneJob.run(enterpriseId);

    expect(result.itemsProcessed).toBeGreaterThanOrEqual(1);
    expect(await prisma.channelSyncLog.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(
      await prisma.channelSyncLog.count({ where: { enterpriseId, connectionName: "Old" } })
    ).toBe(0);
  });

  it("both gap-closing jobs are registered and discoverable", () => {
    // These are the two operational gaps this runner exists to close.
    expect(findJob("channel-keepalive")).toBeTruthy();
    expect(findJob("channel-log-prune")).toBeTruthy();
    expect(JOBS.every((j) => j.name && j.description && typeof j.run === "function")).toBe(true);
  });
});
