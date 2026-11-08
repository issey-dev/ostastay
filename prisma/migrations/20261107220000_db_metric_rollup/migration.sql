-- Per-minute database-load rollups for the Osta Monitoring page (kept 8 days).
CREATE TABLE "DbMetricRollup" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "enterpriseId" TEXT,
    "propertyId" TEXT,
    "ops" INTEGER NOT NULL DEFAULT 0,
    "totalMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyHist" INTEGER[],
    "engineErrors" INTEGER NOT NULL DEFAULT 0,
    "engineWarnings" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DbMetricRollup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DbMetricRollup_bucketStart_idx" ON "DbMetricRollup"("bucketStart");
CREATE INDEX "DbMetricRollup_enterpriseId_bucketStart_idx" ON "DbMetricRollup"("enterpriseId", "bucketStart");
