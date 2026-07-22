-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CashierShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT,
    "businessDate" DATETIME,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "openingFloat" REAL NOT NULL DEFAULT 0.0,
    "closingDrop" REAL,
    CONSTRAINT "CashierShift_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashierShift_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CashierShift" ("closedAt", "closingDrop", "enterpriseId", "id", "openedAt", "openingFloat", "userId") SELECT "closedAt", "closingDrop", "enterpriseId", "id", "openedAt", "openingFloat", "userId" FROM "CashierShift";
DROP TABLE "CashierShift";
ALTER TABLE "new_CashierShift" RENAME TO "CashierShift";
CREATE INDEX "CashierShift_propertyId_idx" ON "CashierShift"("propertyId");
CREATE INDEX "CashierShift_userId_idx" ON "CashierShift"("userId");
CREATE TABLE "new_FolioLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folioId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "outletId" TEXT,
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
    CONSTRAINT "FolioLineItem_roomAssignmentId_fkey" FOREIGN KEY ("roomAssignmentId") REFERENCES "RoomAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FolioLineItem" ("amount", "chargeCodeId", "createdAt", "date", "description", "folioId", "id", "isVoid", "outletId", "reference", "roomAssignmentId", "serviceChargeAmount", "taxAmount") SELECT "amount", "chargeCodeId", "createdAt", "date", "description", "folioId", "id", "isVoid", "outletId", "reference", "roomAssignmentId", "serviceChargeAmount", "taxAmount" FROM "FolioLineItem";
DROP TABLE "FolioLineItem";
ALTER TABLE "new_FolioLineItem" RENAME TO "FolioLineItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

