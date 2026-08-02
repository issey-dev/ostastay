-- Add-on gating moves from per-property to per-enterprise (owner decision 2026-08-02):
-- Spa/Excursions are sold to the enterprise, and once enabled apply to every property
-- in it. Replaces PropertyModuleAccess with EnterpriseAddonAccess, carrying data over:
-- an enterprise is enabled if ANY of its properties had the add-on enabled.

-- CreateTable
CREATE TABLE "EnterpriseAddonAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EnterpriseAddonAccess_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Data carry-over BEFORE the drop
INSERT INTO "EnterpriseAddonAccess" ("id", "enterpriseId", "module", "enabled", "updatedAt")
SELECT lower(hex(randomblob(16))), p."enterpriseId", pma."module", true, CURRENT_TIMESTAMP
FROM "PropertyModuleAccess" pma
JOIN "Property" p ON p."id" = pma."propertyId"
WHERE pma."enabled" = true
GROUP BY p."enterpriseId", pma."module";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PropertyModuleAccess";
PRAGMA foreign_keys=on;

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseAddonAccess_enterpriseId_module_key" ON "EnterpriseAddonAccess"("enterpriseId", "module");
