-- When a maintenance ticket was resolved, on which business date, and by whom.
ALTER TABLE "RoomMaintenance" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "RoomMaintenance" ADD COLUMN "resolvedOn" TIMESTAMP(3);
ALTER TABLE "RoomMaintenance" ADD COLUMN "resolvedById" TEXT;

-- Tickets already resolved: the best record of when is their last update.
UPDATE "RoomMaintenance"
SET "resolvedAt" = "updatedAt",
    "resolvedOn" = date_trunc('day', "updatedAt")
WHERE "status" = 'RESOLVED';

CREATE INDEX "RoomMaintenance_resolvedOn_idx" ON "RoomMaintenance"("resolvedOn");
ALTER TABLE "RoomMaintenance" ADD CONSTRAINT "RoomMaintenance_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
