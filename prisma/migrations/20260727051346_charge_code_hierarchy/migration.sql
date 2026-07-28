-- AlterTable
ALTER TABLE "EnterpriseSettings" ADD COLUMN "defaultGreenTaxChargeCodeId" TEXT;

-- CreateTable
CREATE TABLE "ChargeGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportBucket" TEXT NOT NULL,
    "isRevenue" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ChargeGroup_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChargeSubgroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "chargeGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ChargeSubgroup_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargeSubgroup_chargeGroupId_fkey" FOREIGN KEY ("chargeGroupId") REFERENCES "ChargeGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChargeCodeGenerate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "generatorCodeId" TEXT NOT NULL,
    "generatedCodeId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "calculateOn" TEXT NOT NULL DEFAULT 'NET',
    "basisGenerateId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ChargeCodeGenerate_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargeCodeGenerate_generatorCodeId_fkey" FOREIGN KEY ("generatorCodeId") REFERENCES "ChargeCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargeCodeGenerate_generatedCodeId_fkey" FOREIGN KEY ("generatedCodeId") REFERENCES "ChargeCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChargeCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chargeSubgroupId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHERS',
    "postingType" TEXT NOT NULL DEFAULT 'CHARGE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "useDefaultTax" BOOLEAN NOT NULL DEFAULT true,
    "taxProfileId" TEXT,
    CONSTRAINT "ChargeCode_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargeCode_chargeSubgroupId_fkey" FOREIGN KEY ("chargeSubgroupId") REFERENCES "ChargeSubgroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChargeCode_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ChargeCode" ("category", "code", "description", "enterpriseId", "id", "taxProfileId", "useDefaultTax") SELECT "category", "code", "description", "enterpriseId", "id", "taxProfileId", "useDefaultTax" FROM "ChargeCode";
DROP TABLE "ChargeCode";
ALTER TABLE "new_ChargeCode" RENAME TO "ChargeCode";
CREATE UNIQUE INDEX "ChargeCode_enterpriseId_code_key" ON "ChargeCode"("enterpriseId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ChargeGroup_enterpriseId_code_key" ON "ChargeGroup"("enterpriseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeSubgroup_enterpriseId_code_key" ON "ChargeSubgroup"("enterpriseId", "code");

-- CreateIndex
CREATE INDEX "ChargeCodeGenerate_enterpriseId_generatorCodeId_idx" ON "ChargeCodeGenerate"("enterpriseId", "generatorCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeCodeGenerate_generatorCodeId_generatedCodeId_key" ON "ChargeCodeGenerate"("generatorCodeId", "generatedCodeId");
