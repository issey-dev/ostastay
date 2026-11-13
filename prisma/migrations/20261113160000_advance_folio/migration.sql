-- Agent Portal plan Phase 8: same-day reversal of an Advance Folio.
ALTER TABLE "Reservation" ADD COLUMN "advanceFolioCheckNo" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "advanceFolioDate" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "advanceFolioPrevThrough" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "advanceFolioFolioId" TEXT;
