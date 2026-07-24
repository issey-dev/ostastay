/*
  Warnings:

  - You are about to drop the column `flightNumber` on the `ReservationTransport` table. All the data in the column will be lost.
  - You are about to drop the column `reference` on the `ReservationTransport` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledAt` on the `ReservationTransport` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReservationTransport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "transportType" TEXT,
    "carrierCode" TEXT,
    "carrierTime" DATETIME,
    "transportNo" TEXT,
    "transportTime" DATETIME,
    "remarks" TEXT,
    "chargeToGuest" BOOLEAN NOT NULL DEFAULT false,
    "chargeCodeId" TEXT,
    "chargeAmount" REAL,
    "chargedLineItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReservationTransport_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReservationTransport" ("chargeAmount", "chargeToGuest", "chargedLineItemId", "createdAt", "direction", "id", "reservationId", "transportType", "updatedAt") SELECT "chargeAmount", "chargeToGuest", "chargedLineItemId", "createdAt", "direction", "id", "reservationId", "transportType", "updatedAt" FROM "ReservationTransport";
DROP TABLE "ReservationTransport";
ALTER TABLE "new_ReservationTransport" RENAME TO "ReservationTransport";
CREATE UNIQUE INDEX "ReservationTransport_reservationId_direction_key" ON "ReservationTransport"("reservationId", "direction");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
