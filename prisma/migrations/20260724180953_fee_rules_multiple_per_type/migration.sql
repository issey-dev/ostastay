-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "cancellationFeeRuleId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "depositFeeRuleId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "noShowFeeRuleId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PropertyFeeRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "ruleType" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'FLAT',
    "value" REAL NOT NULL DEFAULT 0,
    "chargeCodeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PropertyFeeRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropertyFeeRule_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PropertyFeeRule" ("basis", "chargeCodeId", "id", "isActive", "propertyId", "ruleType", "updatedAt", "value") SELECT "basis", "chargeCodeId", "id", "isActive", "propertyId", "ruleType", "updatedAt", "value" FROM "PropertyFeeRule";
DROP TABLE "PropertyFeeRule";
ALTER TABLE "new_PropertyFeeRule" RENAME TO "PropertyFeeRule";
CREATE INDEX "PropertyFeeRule_propertyId_ruleType_idx" ON "PropertyFeeRule"("propertyId", "ruleType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
