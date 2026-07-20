-- AlterTable
ALTER TABLE "EnterpriseSettings" ADD COLUMN "commissionChargeCodeId" TEXT;

-- AlterTable
ALTER TABLE "RatePlanAgentAccess" ADD COLUMN "commissionRate" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FolioLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folioId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "outletId" TEXT,
    "roomAssignmentId" TEXT,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "taxAmount" REAL NOT NULL DEFAULT 0.0,
    "serviceChargeAmount" REAL NOT NULL DEFAULT 0.0,
    "isVoid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolioLineItem_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_roomAssignmentId_fkey" FOREIGN KEY ("roomAssignmentId") REFERENCES "RoomAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FolioLineItem" ("amount", "chargeCodeId", "createdAt", "date", "description", "folioId", "id", "isVoid", "outletId", "serviceChargeAmount", "taxAmount") SELECT "amount", "chargeCodeId", "createdAt", "date", "description", "folioId", "id", "isVoid", "outletId", "serviceChargeAmount", "taxAmount" FROM "FolioLineItem";
DROP TABLE "FolioLineItem";
ALTER TABLE "new_FolioLineItem" RENAME TO "FolioLineItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
