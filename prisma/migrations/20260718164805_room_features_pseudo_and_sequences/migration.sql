-- CreateTable
CREATE TABLE "RoomFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    CONSTRAINT "RoomFeature_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PropertySequence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "sequenceType" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PropertySequence_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "floorId" TEXT,
    "roomNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLEAN',
    "assignedAttendantId" TEXT,
    CONSTRAINT "Room_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Room_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Room_assignedAttendantId_fkey" FOREIGN KEY ("assignedAttendantId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("assignedAttendantId", "floorId", "id", "propertyId", "roomNumber", "roomTypeId", "status") SELECT "assignedAttendantId", "floorId", "id", "propertyId", "roomNumber", "roomTypeId", "status" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_propertyId_roomNumber_key" ON "Room"("propertyId", "roomNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RoomFeature_roomId_category_code_key" ON "RoomFeature"("roomId", "category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PropertySequence_propertyId_sequenceType_key" ON "PropertySequence"("propertyId", "sequenceType");

