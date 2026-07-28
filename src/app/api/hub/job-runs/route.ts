import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { JOBS } from "@/lib/jobs";

// Latest run of each background job, for the caller's own enterprise.
//
// The runner records every run precisely so this view can exist: a cron that has silently
// stopped firing is worse than no cron at all, and "last run: 9 days ago" is the only way an
// operator finds that out before a credential lapses.
//
// Read-only and scoped like every other Hub route. Triggering a job is deliberately NOT
// exposed here — that is the cron endpoint's job, guarded by its own shared secret.
export async function GET() {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    const runs = await Promise.all(
      JOBS.map(async (job) => {
        const last = await prisma.jobRun.findFirst({
          where: { enterpriseId: ctx.enterpriseId, jobName: job.name },
          orderBy: { startedAt: "desc" },
        });
        return {
          name: job.name,
          description: job.description,
          lastRun: last
            ? {
                status: last.status,
                startedAt: last.startedAt.toISOString(),
                finishedAt: last.finishedAt?.toISOString() ?? null,
                itemsProcessed: last.itemsProcessed,
                summary: last.summary,
                error: last.error,
              }
            : null,
        };
      })
    );

    return NextResponse.json({ jobs: runs });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
