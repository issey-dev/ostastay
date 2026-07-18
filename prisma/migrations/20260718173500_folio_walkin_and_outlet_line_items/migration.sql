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
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "payeeProfileId" TEXT,
    "groupBlockId" TEXT,
    CONSTRAINT "Folio_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folio_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folio_payeeProfileId_fkey" FOREIGN KEY ("payeeProfileId") REFERENCES "Profile" ("upid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Folio_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Backfill propertyId from each Folio's existing Reservation. Every Folio row today has
-- a non-null reservationId (it was NOT NULL before this migration), so this INNER JOIN
-- is a safe 1:1 backfill, not a lossy one — verified against the live dev.db (2 rows,
-- 0 orphans) before writing this migration.
INSERT INTO "new_Folio" ("id", "reservationId", "propertyId", "folioNumber", "isClosed", "isMaster", "payeeProfileId", "groupBlockId")
SELECT f."id", f."reservationId", r."propertyId", f."folioNumber", f."isClosed", f."isMaster", f."payeeProfileId", f."groupBlockId"
FROM "Folio" f
JOIN "Reservation" r ON r."id" = f."reservationId";
DROP TABLE "Folio";
ALTER TABLE "new_Folio" RENAME TO "Folio";
CREATE INDEX "Folio_propertyId_idx" ON "Folio"("propertyId");

CREATE TABLE "new_FolioLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folioId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "outletId" TEXT,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "taxAmount" REAL NOT NULL DEFAULT 0.0,
    "serviceChargeAmount" REAL NOT NULL DEFAULT 0.0,
    "isVoid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolioLineItem_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FolioLineItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FolioLineItem" ("id", "folioId", "chargeCodeId", "date", "description", "amount", "taxAmount", "serviceChargeAmount", "isVoid", "createdAt")
SELECT "id", "folioId", "chargeCodeId", "date", "description", "amount", "taxAmount", "serviceChargeAmount", "isVoid", "createdAt" FROM "FolioLineItem";
DROP TABLE "FolioLineItem";
ALTER TABLE "new_FolioLineItem" RENAME TO "FolioLineItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
