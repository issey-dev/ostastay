-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "depositPurpose" TEXT;

-- CreateTable
CREATE TABLE "PropertyFeeRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'FLAT',
    "value" REAL NOT NULL DEFAULT 0,
    "chargeCodeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PropertyFeeRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropertyFeeRule_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyFeeRule_propertyId_ruleType_key" ON "PropertyFeeRule"("propertyId", "ruleType");

