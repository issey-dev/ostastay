-- Relax ChargeCode.chargeSubgroupId back to optional. The `category` drop (the previous
-- migration) stands; the NOT NULL tighten is the remaining half of CHARGE_CODE_PLAN.md
-- phase 4 and belongs in its own change — every write path already sets the FK, so the
-- constraint only guards hand-written inserts, at the cost of every test fixture that
-- creates a bare code.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChargeCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chargeSubgroupId" TEXT,
    "postingType" TEXT NOT NULL DEFAULT 'CHARGE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "useDefaultTax" BOOLEAN NOT NULL DEFAULT true,
    "taxProfileId" TEXT,
    CONSTRAINT "ChargeCode_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargeCode_chargeSubgroupId_fkey" FOREIGN KEY ("chargeSubgroupId") REFERENCES "ChargeSubgroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChargeCode_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ChargeCode" ("id", "enterpriseId", "code", "description", "chargeSubgroupId", "postingType", "isSystem", "isActive", "useDefaultTax", "taxProfileId")
SELECT "id", "enterpriseId", "code", "description", "chargeSubgroupId", "postingType", "isSystem", "isActive", "useDefaultTax", "taxProfileId" FROM "ChargeCode";
DROP TABLE "ChargeCode";
ALTER TABLE "new_ChargeCode" RENAME TO "ChargeCode";
CREATE UNIQUE INDEX "ChargeCode_enterpriseId_code_key" ON "ChargeCode"("enterpriseId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
