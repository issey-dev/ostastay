-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "chargeCodeId" TEXT NOT NULL,
    "postingRhythm" TEXT NOT NULL DEFAULT 'EVERY_NIGHT',
    "mode" TEXT NOT NULL DEFAULT 'ADD_TO_RATE',
    "sellSeparate" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Allocation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Allocation_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Allocation" ("chargeCodeId", "code", "createdAt", "id", "isActive", "mode", "name", "postingRhythm", "propertyId", "type", "updatedAt") SELECT "chargeCodeId", "code", "createdAt", "id", "isActive", "mode", "name", "postingRhythm", "propertyId", "type", "updatedAt" FROM "Allocation";
DROP TABLE "Allocation";
ALTER TABLE "new_Allocation" RENAME TO "Allocation";
CREATE UNIQUE INDEX "Allocation_propertyId_code_key" ON "Allocation"("propertyId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: the old 3-way `mode` (which included SELL_SEPARATE) becomes a 2-way
-- INCLUDE_IN_RATE | ADD_TO_RATE plus an independent `sellSeparate` flag. Any row that
-- was mode='SELL_SEPARATE' had no rate-plan behavior of its own, so it maps to a plain
-- ADD_TO_RATE allocation that is additionally sell-separate.
UPDATE "Allocation" SET "sellSeparate" = true, "mode" = 'ADD_TO_RATE' WHERE "mode" = 'SELL_SEPARATE';

