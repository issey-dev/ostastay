-- Per-room-type holds for a group block. Outstanding holds (quantity minus
-- already-picked-up rooms of the type) deduct from availability.
CREATE TABLE "GroupBlockRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupBlockId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "GroupBlockRoom_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupBlockRoom_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GroupBlockRoom_groupBlockId_roomTypeId_key" ON "GroupBlockRoom"("groupBlockId", "roomTypeId");
