-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "checkInTime" TEXT NOT NULL,
    "checkOutTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "logoUrl" TEXT,
    "taxId" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "starRating" INTEGER,
    "bannerColor" TEXT,
    "pricesIncludeTaxes" BOOLEAN NOT NULL DEFAULT true,
    "allocationCalculationMode" TEXT NOT NULL DEFAULT 'RATE_PLAN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Property_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Property" ("bannerColor", "checkInTime", "checkOutTime", "code", "contactEmail", "contactPhone", "createdAt", "defaultCurrency", "enterpriseId", "id", "latitude", "legalName", "logoUrl", "longitude", "name", "pricesIncludeTaxes", "starRating", "status", "taxId", "timeZone", "updatedAt") SELECT "bannerColor", "checkInTime", "checkOutTime", "code", "contactEmail", "contactPhone", "createdAt", "defaultCurrency", "enterpriseId", "id", "latitude", "legalName", "logoUrl", "longitude", "name", "pricesIncludeTaxes", "starRating", "status", "taxId", "timeZone", "updatedAt" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
CREATE UNIQUE INDEX "Property_code_key" ON "Property"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
