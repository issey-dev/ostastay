-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TaxRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taxProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Tax',
    "ratePercent" REAL NOT NULL,
    "calculateOn" TEXT NOT NULL DEFAULT 'BASE',
    "order" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    CONSTRAINT "TaxRate_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaxRate" ("effectiveFrom", "effectiveTo", "id", "ratePercent", "taxProfileId") SELECT "effectiveFrom", "effectiveTo", "id", "ratePercent", "taxProfileId" FROM "TaxRate";
DROP TABLE "TaxRate";
ALTER TABLE "new_TaxRate" RENAME TO "TaxRate";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

