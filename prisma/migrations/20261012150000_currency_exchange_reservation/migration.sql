-- A currency exchange can be linked to the in-house guest it was done for.
ALTER TABLE "CurrencyExchange" ADD COLUMN "reservationId" TEXT;
CREATE INDEX "CurrencyExchange_reservationId_idx" ON "CurrencyExchange"("reservationId");
ALTER TABLE "CurrencyExchange" ADD CONSTRAINT "CurrencyExchange_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
