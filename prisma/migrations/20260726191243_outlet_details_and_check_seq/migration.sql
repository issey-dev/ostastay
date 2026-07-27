-- CreateTable
CREATE TABLE "OutletCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outletId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "folioId" TEXT,
    "checkNumber" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutletCheck_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OutletCheck_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutletCheck_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FolioLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folioId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "outletId" TEXT,
    "outletCheckId" TEXT,
    "roomAssignmentId" TEXT,
    "shiftId" TEXT,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" REAL NOT NULL,
    "taxAmount" REAL NOT NULL DEFAULT 0.0,
    "serviceChargeAmount" REAL NOT NULL DEFAULT 0.0,
    "isVoid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolioLineItem_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_outletCheckId_fkey" FOREIGN KEY ("outletCheckId") REFERENCES "OutletCheck" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_roomAssignmentId_fkey" FOREIGN KEY ("roomAssignmentId") REFERENCES "RoomAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FolioLineItem" ("amount", "chargeCodeId", "createdAt", "date", "description", "folioId", "id", "isVoid", "outletId", "reference", "roomAssignmentId", "serviceChargeAmount", "shiftId", "taxAmount") SELECT "amount", "chargeCodeId", "createdAt", "date", "description", "folioId", "id", "isVoid", "outletId", "reference", "roomAssignmentId", "serviceChargeAmount", "shiftId", "taxAmount" FROM "FolioLineItem";
DROP TABLE "FolioLineItem";
ALTER TABLE "new_FolioLineItem" RENAME TO "FolioLineItem";
CREATE TABLE "new_GroupBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "cutoffDate" DATETIME,
    "totalRoomsHeld" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'TENTATIVE',
    "payeeProfileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupBlock_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupBlock_payeeProfileId_fkey" FOREIGN KEY ("payeeProfileId") REFERENCES "Profile" ("upid") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GroupBlock" ("code", "createdAt", "cutoffDate", "endDate", "id", "name", "payeeProfileId", "propertyId", "startDate", "status", "totalRoomsHeld", "updatedAt") SELECT "code", "createdAt", "cutoffDate", "endDate", "id", "name", "payeeProfileId", "propertyId", "startDate", "status", "totalRoomsHeld", "updatedAt" FROM "GroupBlock";
DROP TABLE "GroupBlock";
ALTER TABLE "new_GroupBlock" RENAME TO "GroupBlock";
CREATE UNIQUE INDEX "GroupBlock_propertyId_code_key" ON "GroupBlock"("propertyId", "code");
CREATE TABLE "new_Outlet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "outletType" TEXT NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "taxNo" TEXT,
    "checkSequence" INTEGER NOT NULL DEFAULT 0,
    "taxOverrideMode" TEXT NOT NULL DEFAULT 'NONE',
    "taxProfileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Outlet_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Outlet_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Outlet" ("createdAt", "description", "id", "isActive", "name", "outletType", "propertyId", "taxOverrideMode", "taxProfileId", "updatedAt") SELECT "createdAt", "description", "id", "isActive", "name", "outletType", "propertyId", "taxOverrideMode", "taxProfileId", "updatedAt" FROM "Outlet";
DROP TABLE "Outlet";
ALTER TABLE "new_Outlet" RENAME TO "Outlet";
CREATE UNIQUE INDEX "Outlet_propertyId_name_key" ON "Outlet"("propertyId", "name");
CREATE UNIQUE INDEX "Outlet_propertyId_code_key" ON "Outlet"("propertyId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OutletCheck_folioId_idx" ON "OutletCheck"("folioId");

-- CreateIndex
CREATE INDEX "OutletCheck_propertyId_idx" ON "OutletCheck"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "OutletCheck_outletId_checkNumber_key" ON "OutletCheck"("outletId", "checkNumber");
