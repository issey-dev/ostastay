-- CreateTable
CREATE TABLE "AvailabilityRestriction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "date" DATETIME NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AvailabilityRestriction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AvailabilityRestriction_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RoomAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT,
    "roomTypeId" TEXT NOT NULL,
    "chargeRoomTypeId" TEXT,
    "ratePlanId" TEXT NOT NULL,
    "overrideRate" REAL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoomAssignment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RoomAssignment_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoomAssignment_chargeRoomTypeId_fkey" FOREIGN KEY ("chargeRoomTypeId") REFERENCES "RoomType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RoomAssignment_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RoomAssignment" ("chargeRoomTypeId", "createdAt", "endDate", "id", "overrideRate", "ratePlanId", "reservationId", "roomId", "roomTypeId", "startDate", "updatedAt") SELECT "chargeRoomTypeId", "createdAt", "endDate", "id", "overrideRate", "ratePlanId", "reservationId", "roomId", "roomTypeId", "startDate", "updatedAt" FROM "RoomAssignment";
DROP TABLE "RoomAssignment";
ALTER TABLE "new_RoomAssignment" RENAME TO "RoomAssignment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AvailabilityRestriction_propertyId_date_idx" ON "AvailabilityRestriction"("propertyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityRestriction_propertyId_roomTypeId_date_key" ON "AvailabilityRestriction"("propertyId", "roomTypeId", "date");
