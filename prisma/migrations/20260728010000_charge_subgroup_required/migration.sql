-- Completes CHARGE_CODE_PLAN.md phase 4: ChargeCode.chargeSubgroupId becomes REQUIRED,
-- so every code is properly linked group -> subgroup -> code and nothing can post with
-- no classification behind it (owner rule, 2026-07-28).

-- Anything still unclassified has to land somewhere before the constraint applies. Its
-- own enterprise's Miscellaneous subgroup is the honest destination — it reads as "not
-- classified yet" rather than guessing a revenue bucket. A no-op wherever the chart has
-- been seeded, which is every path that creates a code.
UPDATE "ChargeCode"
SET "chargeSubgroupId" = (
    SELECT s."id" FROM "ChargeSubgroup" s
    WHERE s."enterpriseId" = "ChargeCode"."enterpriseId" AND s."code" = 'MISCELLANEOUS'
)
WHERE "chargeSubgroupId" IS NULL;

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
