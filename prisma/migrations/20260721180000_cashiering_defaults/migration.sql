-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EnterpriseSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "resConfirmPrefix" TEXT NOT NULL DEFAULT '',
    "resConfirmLength" INTEGER NOT NULL DEFAULT 6,
    "cashierDefaultFloat" REAL NOT NULL DEFAULT 300,
    "exchangeFromCurrency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeToCurrency" TEXT NOT NULL DEFAULT 'MVR',
    "systemDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defaultAccommodationChargeCodeId" TEXT,
    "cityLedgerPaymentMethodId" TEXT,
    "commissionChargeCodeId" TEXT,
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
    "invoicePaymentAccountName" TEXT,
    "invoicePaymentAccountNumber" TEXT,
    "invoicePaymentIban" TEXT,
    "invoicePaymentBankInfo" TEXT,
    "confirmationLetterMessage" TEXT,
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
INSERT INTO "new_EnterpriseSettings" ("cityLedgerPaymentMethodId", "commissionChargeCodeId", "confirmationLetterMessage", "defaultAccommodationChargeCodeId", "enterpriseId", "greenTaxAdultAmount", "greenTaxChildAmount", "greenTaxEnabled", "greenTaxExemptAge", "id", "invoiceAddress", "invoiceBrandColor", "invoiceBrandName", "invoiceEmail", "invoiceFontFamily", "invoiceFooterText", "invoiceHeaderText", "invoiceLogoUrl", "invoicePaymentAccountName", "invoicePaymentAccountNumber", "invoicePaymentBankInfo", "invoicePaymentIban", "invoicePaymentTerms", "invoicePhone", "invoiceTaxId", "resConfirmLength", "resConfirmPrefix", "serviceChargeEnabled", "serviceChargeRate", "sftpHost", "sftpPassword", "sftpPort", "sftpRemotePath", "sftpUsername", "smtpFromAddress", "smtpHost", "smtpPassword", "smtpPort", "smtpUseTls", "smtpUsername", "systemDate", "tgstEnabled", "tgstRate", "updatedAt") SELECT "cityLedgerPaymentMethodId", "commissionChargeCodeId", "confirmationLetterMessage", "defaultAccommodationChargeCodeId", "enterpriseId", "greenTaxAdultAmount", "greenTaxChildAmount", "greenTaxEnabled", "greenTaxExemptAge", "id", "invoiceAddress", "invoiceBrandColor", "invoiceBrandName", "invoiceEmail", "invoiceFontFamily", "invoiceFooterText", "invoiceHeaderText", "invoiceLogoUrl", "invoicePaymentAccountName", "invoicePaymentAccountNumber", "invoicePaymentBankInfo", "invoicePaymentIban", "invoicePaymentTerms", "invoicePhone", "invoiceTaxId", "resConfirmLength", "resConfirmPrefix", "serviceChargeEnabled", "serviceChargeRate", "sftpHost", "sftpPassword", "sftpPort", "sftpRemotePath", "sftpUsername", "smtpFromAddress", "smtpHost", "smtpPassword", "smtpPort", "smtpUseTls", "smtpUsername", "systemDate", "tgstEnabled", "tgstRate", "updatedAt" FROM "EnterpriseSettings";
DROP TABLE "EnterpriseSettings";
ALTER TABLE "new_EnterpriseSettings" RENAME TO "EnterpriseSettings";
CREATE UNIQUE INDEX "EnterpriseSettings_enterpriseId_key" ON "EnterpriseSettings"("enterpriseId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

