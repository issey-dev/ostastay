-- Phase 4 of CHARGE_CODE_PLAN.md: drop the deprecated ChargeCode.category column and
-- make the hierarchy FK required. Every reader was migrated to
-- chargeSubgroup.chargeGroup.reportBucket in the preceding release; `category` has been
-- written only as a mirror since then.

-- Safety net: chargeSubgroupId becomes NOT NULL below, so anything still unclassified
-- has to land somewhere first. Its own enterprise's Miscellaneous subgroup is the
-- honest destination — it says "not classified" rather than guessing a revenue bucket.
-- A no-op on any database where the backfill has run (dev: 0 rows).
UPDATE "ChargeCode"
SET "chargeSubgroupId" = (
    SELECT s."id" FROM "ChargeSubgroup" s
    WHERE s."enterpriseId" = "ChargeCode"."enterpriseId" AND s."code" = 'MISCELLANEOUS'
)
WHERE "chargeSubgroupId" IS NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChargeCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chargeSubgroupId" TEXT NOT NULL,
    "postingType" TEXT NOT NULL DEFAULT 'CHARGE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "useDefaultTax" BOOLEAN NOT NULL DEFAULT true,
    "taxProfileId" TEXT,
    CONSTRAINT "ChargeCode_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargeCode_chargeSubgroupId_fkey" FOREIGN KEY ("chargeSubgroupId") REFERENCES "ChargeSubgroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChargeCode_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ChargeCode" ("id", "enterpriseId", "code", "description", "chargeSubgroupId", "postingType", "isSystem", "isActive", "useDefaultTax", "taxProfileId")
SELECT "id", "enterpriseId", "code", "description", "chargeSubgroupId", "postingType", "isSystem", "isActive", "useDefaultTax", "taxProfileId" FROM "ChargeCode";
DROP TABLE "ChargeCode";
ALTER TABLE "new_ChargeCode" RENAME TO "ChargeCode";
CREATE UNIQUE INDEX "ChargeCode_enterpriseId_code_key" ON "ChargeCode"("enterpriseId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
