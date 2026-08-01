-- DropIndex
DROP INDEX "ChargeSubgroup_outletId_idx";

-- DropIndex
DROP INDEX "ERegistrationGuestSlot_linkId_idx";

-- CreateTable
CREATE TABLE "PropertyLicenseAllowance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "maxRoomTypes" INTEGER,
    "maxRooms" INTEGER,
    "maxChannels" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PropertyLicenseAllowance_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LicenseInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EnterpriseLicense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "maxProperties" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "validFrom" DATETIME,
    "expiresAt" DATETIME,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "monthlyPrice" REAL,
    "priceCurrency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EnterpriseLicense_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EnterpriseLicense" ("enterpriseId", "id", "maxProperties", "notes", "tier", "updatedAt") SELECT "enterpriseId", "id", "maxProperties", "notes", "tier", "updatedAt" FROM "EnterpriseLicense";
DROP TABLE "EnterpriseLicense";
ALTER TABLE "new_EnterpriseLicense" RENAME TO "EnterpriseLicense";
CREATE UNIQUE INDEX "EnterpriseLicense_enterpriseId_key" ON "EnterpriseLicense"("enterpriseId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PropertyLicenseAllowance_propertyId_key" ON "PropertyLicenseAllowance"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseInvoice_invoiceNo_key" ON "LicenseInvoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseInvoice_receiptNo_key" ON "LicenseInvoice"("receiptNo");

-- CreateIndex
CREATE INDEX "LicenseInvoice_enterpriseId_issuedAt_idx" ON "LicenseInvoice"("enterpriseId", "issuedAt");
