-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "confirmationNo" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "primaryGuestId" TEXT NOT NULL,
    "travelAgentId" TEXT,
    "groupBlockId" TEXT,
    "checkInDate" DATETIME NOT NULL,
    "checkOutDate" DATETIME NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "infants" INTEGER NOT NULL DEFAULT 0,
    "mealPlan" TEXT NOT NULL DEFAULT 'NONE',
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reservation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reservation_primaryGuestId_fkey" FOREIGN KEY ("primaryGuestId") REFERENCES "Profile" ("upid") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reservation_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "Profile" ("upid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Reservation_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Reservation" ("adults", "checkInDate", "checkOutDate", "children", "confirmationNo", "createdAt", "groupBlockId", "id", "mealPlan", "primaryGuestId", "propertyId", "status", "travelAgentId", "updatedAt") SELECT "adults", "checkInDate", "checkOutDate", "children", "confirmationNo", "createdAt", "groupBlockId", "id", "mealPlan", "primaryGuestId", "propertyId", "status", "travelAgentId", "updatedAt" FROM "Reservation";
DROP TABLE "Reservation";
ALTER TABLE "new_Reservation" RENAME TO "Reservation";
CREATE UNIQUE INDEX "Reservation_confirmationNo_key" ON "Reservation"("confirmationNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

