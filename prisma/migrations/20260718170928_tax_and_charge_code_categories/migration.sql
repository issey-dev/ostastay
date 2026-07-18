-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChargeCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHERS',
    "useDefaultTax" BOOLEAN NOT NULL DEFAULT true,
    "taxProfileId" TEXT,
    CONSTRAINT "ChargeCode_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargeCode_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ChargeCode" ("code", "description", "enterpriseId", "id", "taxProfileId") SELECT "code", "description", "enterpriseId", "id", "taxProfileId" FROM "ChargeCode";
DROP TABLE "ChargeCode";
ALTER TABLE "new_ChargeCode" RENAME TO "ChargeCode";
CREATE UNIQUE INDEX "ChargeCode_enterpriseId_code_key" ON "ChargeCode"("enterpriseId", "code");
CREATE TABLE "new_EnterpriseSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "resConfirmPrefix" TEXT NOT NULL DEFAULT '',
    "resConfirmLength" INTEGER NOT NULL DEFAULT 6,
    "systemDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceBrandName" TEXT,
    "invoiceLogoUrl" TEXT,
    "invoiceBrandColor" TEXT DEFAULT '#4f46e5',
    "invoiceFontFamily" TEXT DEFAULT 'Geist',
    "invoiceTaxId" TEXT,
    "invoicePhone" TEXT,
    "invoiceEmail" TEXT,
    "invoiceAddress" TEXT,
    "invoiceHeaderText" TEXT,
    "invoiceFooterText" TEXT,
    "invoicePaymentTerms" TEXT,
    "greenTaxEnabled" BOOLEAN NOT NULL DEFAULT true,
    "greenTaxAdultAmount" REAL NOT NULL DEFAULT 12.00,
    "greenTaxChildAmount" REAL NOT NULL DEFAULT 6.00,
    "greenTaxExemptAge" INTEGER NOT NULL DEFAULT 2,
    "tgstEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tgstRate" REAL NOT NULL DEFAULT 17.00,
    "serviceChargeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "serviceChargeRate" REAL NOT NULL DEFAULT 10.00,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUsername" TEXT,
    "smtpPassword" TEXT,
    "smtpFromAddress" TEXT,
    "smtpUseTls" BOOLEAN NOT NULL DEFAULT true,
    "sftpHost" TEXT,
    "sftpPort" INTEGER,
    "sftpUsername" TEXT,
    "sftpPassword" TEXT,
    "sftpRemotePath" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EnterpriseSettings_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EnterpriseSettings" ("enterpriseId", "greenTaxEnabled", "greenTaxExemptAge", "id", "invoiceAddress", "invoiceBrandColor", "invoiceBrandName", "invoiceEmail", "invoiceFontFamily", "invoiceFooterText", "invoiceHeaderText", "invoiceLogoUrl", "invoicePaymentTerms", "invoicePhone", "invoiceTaxId", "resConfirmLength", "resConfirmPrefix", "serviceChargeEnabled", "serviceChargeRate", "sftpHost", "sftpPassword", "sftpPort", "sftpRemotePath", "sftpUsername", "smtpFromAddress", "smtpHost", "smtpPassword", "smtpPort", "smtpUseTls", "smtpUsername", "systemDate", "tgstEnabled", "tgstRate", "updatedAt") SELECT "enterpriseId", "greenTaxEnabled", "greenTaxExemptAge", "id", "invoiceAddress", "invoiceBrandColor", "invoiceBrandName", "invoiceEmail", "invoiceFontFamily", "invoiceFooterText", "invoiceHeaderText", "invoiceLogoUrl", "invoicePaymentTerms", "invoicePhone", "invoiceTaxId", "resConfirmLength", "resConfirmPrefix", "serviceChargeEnabled", "serviceChargeRate", "sftpHost", "sftpPassword", "sftpPort", "sftpRemotePath", "sftpUsername", "smtpFromAddress", "smtpHost", "smtpPassword", "smtpPort", "smtpUseTls", "smtpUsername", "systemDate", "tgstEnabled", "tgstRate", "updatedAt" FROM "EnterpriseSettings";
DROP TABLE "EnterpriseSettings";
ALTER TABLE "new_EnterpriseSettings" RENAME TO "EnterpriseSettings";
CREATE UNIQUE INDEX "EnterpriseSettings_enterpriseId_key" ON "EnterpriseSettings"("enterpriseId");
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
    "logoUrl" TEXT,
    "taxId" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "starRating" INTEGER,
    "bannerColor" TEXT,
    "pricesIncludeTaxes" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Property_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Property" ("bannerColor", "checkInTime", "checkOutTime", "code", "contactEmail", "contactPhone", "createdAt", "defaultCurrency", "enterpriseId", "id", "latitude", "legalName", "logoUrl", "longitude", "name", "starRating", "status", "taxId", "timeZone", "updatedAt") SELECT "bannerColor", "checkInTime", "checkOutTime", "code", "contactEmail", "contactPhone", "createdAt", "defaultCurrency", "enterpriseId", "id", "latitude", "legalName", "logoUrl", "longitude", "name", "starRating", "status", "taxId", "timeZone", "updatedAt" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
CREATE UNIQUE INDEX "Property_code_key" ON "Property"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

