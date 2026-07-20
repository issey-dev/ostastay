-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RatePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isNegotiated" BOOLEAN NOT NULL DEFAULT false,
    "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
    "isHouseUse" BOOLEAN NOT NULL DEFAULT false,
    "chargeCodeId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "parentRatePlanId" TEXT,
    "derivedAdjustmentType" TEXT,
    "derivedAdjustmentValue" REAL,
    CONSTRAINT "RatePlan_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RatePlan_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RatePlan_parentRatePlanId_fkey" FOREIGN KEY ("parentRatePlanId") REFERENCES "RatePlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RatePlan" ("chargeCodeId", "code", "derivedAdjustmentType", "derivedAdjustmentValue", "description", "id", "isLocked", "isNegotiated", "name", "parentRatePlanId", "priority", "propertyId") SELECT "chargeCodeId", "code", "derivedAdjustmentType", "derivedAdjustmentValue", "description", "id", "isLocked", "isNegotiated", "name", "parentRatePlanId", "priority", "propertyId" FROM "RatePlan";
DROP TABLE "RatePlan";
ALTER TABLE "new_RatePlan" RENAME TO "RatePlan";
CREATE UNIQUE INDEX "RatePlan_propertyId_code_key" ON "RatePlan"("propertyId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
