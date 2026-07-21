-- AlterTable
ALTER TABLE "FolioLineItem" ADD COLUMN "reference" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN "businessDate" DATETIME;

-- CreateTable
CREATE TABLE "FolioRoutingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "targetFolioId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FolioRoutingRule_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FolioRoutingRule_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FolioRoutingRule_targetFolioId_fkey" FOREIGN KEY ("targetFolioId") REFERENCES "Folio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FolioRoutingRule_reservationId_chargeCodeId_key" ON "FolioRoutingRule"("reservationId", "chargeCodeId");


-- Backfill: existing properties start their business date at today's UTC midnight
-- (reservation dates are stored as UTC midnight). Night Audit rolls it forward from here.
UPDATE "Property" SET "businessDate" = strftime('%Y-%m-%dT00:00:00.000Z', 'now') WHERE "businessDate" IS NULL;
