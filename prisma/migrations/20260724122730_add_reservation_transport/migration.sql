-- CreateTable
CREATE TABLE "ReservationTransport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "transportType" TEXT,
    "flightNumber" TEXT,
    "scheduledAt" DATETIME,
    "reference" TEXT,
    "chargeAmount" REAL,
    "chargeToGuest" BOOLEAN NOT NULL DEFAULT false,
    "chargedLineItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReservationTransport_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationTransport_reservationId_direction_key" ON "ReservationTransport"("reservationId", "direction");
