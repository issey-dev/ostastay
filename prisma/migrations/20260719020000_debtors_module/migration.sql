-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Folio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT,
    "propertyId" TEXT NOT NULL,
    "folioNumber" INTEGER NOT NULL DEFAULT 1,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "settlementMethod" TEXT NOT NULL DEFAULT 'DIRECT',
    "isDebtorAccount" BOOLEAN NOT NULL DEFAULT false,
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "payeeProfileId" TEXT,
    "groupBlockId" TEXT,
    "taxInvoiceNumber" TEXT,
    "proformaInvoiceNumber" TEXT,
    CONSTRAINT "Folio_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folio_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folio_payeeProfileId_fkey" FOREIGN KEY ("payeeProfileId") REFERENCES "Profile" ("upid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Folio_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Folio" ("folioNumber", "groupBlockId", "id", "isClosed", "isMaster", "payeeProfileId", "proformaInvoiceNumber", "propertyId", "reservationId", "taxInvoiceNumber", "walkInGuestContact", "walkInGuestName") SELECT "folioNumber", "groupBlockId", "id", "isClosed", "isMaster", "payeeProfileId", "proformaInvoiceNumber", "propertyId", "reservationId", "taxInvoiceNumber", "walkInGuestContact", "walkInGuestName" FROM "Folio";
DROP TABLE "Folio";
ALTER TABLE "new_Folio" RENAME TO "Folio";
CREATE INDEX "Folio_propertyId_idx" ON "Folio"("propertyId");
CREATE TABLE "new_Profile" (
    "upid" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "profileType" TEXT NOT NULL DEFAULT 'GUEST',
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "companyName" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'REGULAR',
    "photoUrl" TEXT,
    "dateOfBirth" DATETIME,
    "anniversaryDate" DATETIME,
    "loyaltyTier" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "iataNumber" TEXT,
    "commissionRate" REAL,
    "greenTaxExempt" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT,
    "membershipNumber" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "isIncognito" BOOLEAN NOT NULL DEFAULT false,
    "arNumber" TEXT,
    "creditLimit" REAL,
    "isCreditAccount" BOOLEAN NOT NULL DEFAULT false,
    "totalStays" INTEGER NOT NULL DEFAULT 0,
    "totalNights" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" REAL NOT NULL DEFAULT 0.0,
    "lastStayDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("anniversaryDate", "arNumber", "classification", "commissionRate", "companyName", "createdAt", "creditLimit", "dateOfBirth", "enterpriseId", "firstName", "gender", "greenTaxExempt", "iataNumber", "isIncognito", "lastName", "lastStayDate", "loyaltyTier", "marketingOptIn", "membershipNumber", "photoUrl", "preferredLanguage", "profileType", "title", "totalNights", "totalRevenue", "totalStays", "updatedAt", "upid") SELECT "anniversaryDate", "arNumber", "classification", "commissionRate", "companyName", "createdAt", "creditLimit", "dateOfBirth", "enterpriseId", "firstName", "gender", "greenTaxExempt", "iataNumber", "isIncognito", "lastName", "lastStayDate", "loyaltyTier", "marketingOptIn", "membershipNumber", "photoUrl", "preferredLanguage", "profileType", "title", "totalNights", "totalRevenue", "totalStays", "updatedAt", "upid" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_arNumber_key" ON "Profile"("arNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
