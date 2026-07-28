-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,
    CONSTRAINT "JobRun_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_enterpriseId_startedAt_idx" ON "JobRun"("enterpriseId", "startedAt");


-- PARTIAL unique index: at most one RUNNING JobRun per (job, enterprise).
-- Prisma cannot express a partial index, so it is created here in raw SQL and documented
-- with a NOTE on the JobRun model in schema.prisma. Same approach as
-- CashierShift_one_open_per_user_property.
--
-- This is what makes overlapping cron invocations safe: the second one's INSERT violates
-- this index and is skipped, instead of running the same job twice concurrently.
CREATE UNIQUE INDEX "JobRun_one_running_per_job_enterprise"
  ON "JobRun"("jobName", "enterpriseId")
  WHERE "status" = 'RUNNING';
