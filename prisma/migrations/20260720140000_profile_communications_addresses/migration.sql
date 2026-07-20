-- CreateTable
CREATE TABLE "ProfileCommunication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "upid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileCommunication_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile" ("upid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "upid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fullAddress" TEXT NOT NULL,
    "city" TEXT,
    "stateProvince" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileAddress_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile" ("upid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "upid" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileAttachment_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile" ("upid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profile" (
    "upid" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "profileType" TEXT NOT NULL DEFAULT 'GUEST',
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'REGULAR',
    "photoUrl" TEXT,
    "dateOfBirth" DATETIME,
    "nationality" TEXT,
    "anniversaryDate" DATETIME,
    "vipLevel" TEXT,
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
    "originPropertyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Profile_originPropertyId_fkey" FOREIGN KEY ("originPropertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("anniversaryDate", "arNumber", "classification", "commissionRate", "companyName", "createdAt", "creditLimit", "dateOfBirth", "enterpriseId", "firstName", "gender", "greenTaxExempt", "iataNumber", "isCreditAccount", "isIncognito", "lastName", "lastStayDate", "marketingOptIn", "membershipNumber", "photoUrl", "preferredLanguage", "profileType", "title", "totalNights", "totalRevenue", "totalStays", "updatedAt", "upid") SELECT "anniversaryDate", "arNumber", "classification", "commissionRate", "companyName", "createdAt", "creditLimit", "dateOfBirth", "enterpriseId", "firstName", "gender", "greenTaxExempt", "iataNumber", "isCreditAccount", "isIncognito", "lastName", "lastStayDate", "marketingOptIn", "membershipNumber", "photoUrl", "preferredLanguage", "profileType", "title", "totalNights", "totalRevenue", "totalStays", "updatedAt", "upid" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_arNumber_key" ON "Profile"("arNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

