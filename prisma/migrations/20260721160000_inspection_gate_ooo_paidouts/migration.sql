-- AlterTable
ALTER TABLE "Room" ADD COLUMN "oooExpectedReturn" DATETIME;
ALTER TABLE "Room" ADD COLUMN "oooReason" TEXT;

-- CreateTable
CREATE TABLE "CashierPaidOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashierPaidOut_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "reviewedByUserId" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "logoUrl" TEXT,
    "taxId" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "starRating" INTEGER,
    "bannerColor" TEXT,
    "requireInspectionOnCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "pricesIncludeTaxes" BOOLEAN NOT NULL DEFAULT true,
    "allocationCalculationMode" TEXT NOT NULL DEFAULT 'RATE_PLAN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Property_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Property_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Property" ("allocationCalculationMode", "bannerColor", "checkInTime", "checkOutTime", "code", "contactEmail", "contactPhone", "createdAt", "defaultCurrency", "enterpriseId", "id", "latitude", "legalName", "logoUrl", "longitude", "name", "pricesIncludeTaxes", "rejectionReason", "reviewedAt", "reviewedByUserId", "starRating", "status", "taxId", "timeZone", "updatedAt") SELECT "allocationCalculationMode", "bannerColor", "checkInTime", "checkOutTime", "code", "contactEmail", "contactPhone", "createdAt", "defaultCurrency", "enterpriseId", "id", "latitude", "legalName", "logoUrl", "longitude", "name", "pricesIncludeTaxes", "rejectionReason", "reviewedAt", "reviewedByUserId", "starRating", "status", "taxId", "timeZone", "updatedAt" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
CREATE UNIQUE INDEX "Property_code_key" ON "Property"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

