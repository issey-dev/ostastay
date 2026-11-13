-- The block's Travel Agent or Company; its reservations carry it (owner, 2026-11-13).
ALTER TABLE "GroupBlock" ADD COLUMN "travelAgentId" TEXT;
ALTER TABLE "GroupBlock" ADD CONSTRAINT "GroupBlock_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "Profile"("upid") ON DELETE SET NULL ON UPDATE CASCADE;
