-- A paid-out can be linked to the in-house guest it was for.
ALTER TABLE "CashierPaidOut" ADD COLUMN "reservationId" TEXT;
CREATE INDEX "CashierPaidOut_reservationId_idx" ON "CashierPaidOut"("reservationId");
ALTER TABLE "CashierPaidOut" ADD CONSTRAINT "CashierPaidOut_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
