-- CreateTable
CREATE TABLE "RoomTypeAmenity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    CONSTRAINT "RoomTypeAmenity_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RoomType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxOccupancy" INTEGER NOT NULL,
    "basePrice" REAL NOT NULL DEFAULT 0.0,
    "description" TEXT,
    "isPseudo" BOOLEAN NOT NULL DEFAULT false,
    "housekeepingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bedType" TEXT,
    "view" TEXT,
    CONSTRAINT "RoomType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RoomType" ("basePrice", "code", "description", "id", "maxOccupancy", "name", "propertyId") SELECT "basePrice", "code", "description", "id", "maxOccupancy", "name", "propertyId" FROM "RoomType";
DROP TABLE "RoomType";
ALTER TABLE "new_RoomType" RENAME TO "RoomType";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RoomTypeAmenity_roomTypeId_code_key" ON "RoomTypeAmenity"("roomTypeId", "code");

