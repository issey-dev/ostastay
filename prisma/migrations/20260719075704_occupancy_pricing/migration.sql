-- AlterTable
ALTER TABLE "PriceCalendar" ADD COLUMN "extraAdultPrice" REAL;
ALTER TABLE "PriceCalendar" ADD COLUMN "extraChildPrice" REAL;

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
    "baseOccupancy" INTEGER NOT NULL DEFAULT 2,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPseudo" BOOLEAN NOT NULL DEFAULT false,
    "housekeepingEnabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "RoomType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RoomType" ("basePrice", "code", "description", "housekeepingEnabled", "id", "isActive", "isPseudo", "maxOccupancy", "name", "propertyId") SELECT "basePrice", "code", "description", "housekeepingEnabled", "id", "isActive", "isPseudo", "maxOccupancy", "name", "propertyId" FROM "RoomType";
DROP TABLE "RoomType";
ALTER TABLE "new_RoomType" RENAME TO "RoomType";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
