-- Agent Portal plan Phase 4: Group Blocks for Sources (slot requests, rolling release,
-- quota checkpoints, elasticity) and agent sales windows.
ALTER TABLE "GroupBlock" ADD COLUMN "sourceProfileId" TEXT;
ALTER TABLE "GroupBlock" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'DESK';
ALTER TABLE "GroupBlock" ADD COLUMN "requestedByAgentUserId" TEXT;
ALTER TABLE "GroupBlock" ADD COLUMN "requestNote" TEXT;
ALTER TABLE "GroupBlock" ADD COLUMN "isOverflowRequest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GroupBlock" ADD COLUMN "decisionReason" TEXT;
ALTER TABLE "GroupBlock" ADD COLUMN "decidedBy" TEXT;
ALTER TABLE "GroupBlock" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "GroupBlock" ADD COLUMN "releaseDays" INTEGER;
ALTER TABLE "GroupBlock" ADD COLUMN "elasticRooms" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GroupBlock" ADD COLUMN "elasticNightsBefore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GroupBlock" ADD COLUMN "elasticNightsAfter" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "GroupBlock_sourceProfileId_idx" ON "GroupBlock"("sourceProfileId");
CREATE INDEX "GroupBlock_propertyId_status_idx" ON "GroupBlock"("propertyId", "status");
ALTER TABLE "GroupBlock" ADD CONSTRAINT "GroupBlock_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "Profile"("upid") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GroupBlockRoom" ADD COLUMN "requestedQuantity" INTEGER;

CREATE TABLE "GroupBlockCheckpoint" (
    "id" TEXT NOT NULL,
    "groupBlockId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "minPercent" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3),
    "releasedRooms" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupBlockCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GroupBlockCheckpoint_groupBlockId_idx" ON "GroupBlockCheckpoint"("groupBlockId");
CREATE INDEX "GroupBlockCheckpoint_processedAt_date_idx" ON "GroupBlockCheckpoint"("processedAt", "date");
ALTER TABLE "GroupBlockCheckpoint" ADD CONSTRAINT "GroupBlockCheckpoint_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RatePlan" ADD COLUMN "agentSalesOpenAt" TIMESTAMP(3);
