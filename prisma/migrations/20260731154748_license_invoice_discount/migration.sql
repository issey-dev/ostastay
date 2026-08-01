-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LicenseInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME,
    "paidAt" DATETIME,
    "paymentReference" TEXT,
    "receiptNo" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LicenseInvoice_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LicenseInvoice" ("amount", "createdAt", "currency", "dueAt", "enterpriseId", "id", "invoiceNo", "issuedAt", "notes", "paidAt", "paymentReference", "periodEnd", "periodStart", "receiptNo", "status", "updatedAt") SELECT "amount", "createdAt", "currency", "dueAt", "enterpriseId", "id", "invoiceNo", "issuedAt", "notes", "paidAt", "paymentReference", "periodEnd", "periodStart", "receiptNo", "status", "updatedAt" FROM "LicenseInvoice";
DROP TABLE "LicenseInvoice";
ALTER TABLE "new_LicenseInvoice" RENAME TO "LicenseInvoice";
CREATE UNIQUE INDEX "LicenseInvoice_invoiceNo_key" ON "LicenseInvoice"("invoiceNo");
CREATE UNIQUE INDEX "LicenseInvoice_receiptNo_key" ON "LicenseInvoice"("receiptNo");
CREATE INDEX "LicenseInvoice_enterpriseId_issuedAt_idx" ON "LicenseInvoice"("enterpriseId", "issuedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
