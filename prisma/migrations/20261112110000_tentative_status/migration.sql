-- Agent Portal plan Phase 1: tentative bookings, option dates, structured cancel reasons
-- and where a booking came from.
ALTER TABLE "Reservation" ADD COLUMN "optionDate" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "confirmationRequestedAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "confirmationNote" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "confirmedBy" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "cancellationReasonCode" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'DESK';
CREATE INDEX "Reservation_status_optionDate_idx" ON "Reservation"("status", "optionDate");

ALTER TABLE "PropertySettings" ADD COLUMN "optionDaysBeforeArrival" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "PropertySettings" ADD COLUMN "shortOptionHours" INTEGER NOT NULL DEFAULT 48;

-- Backfill where existing bookings came from.
UPDATE "Reservation" r SET "origin" = 'WEBSITE'
  WHERE EXISTS (SELECT 1 FROM "WebsiteBooking" w WHERE w."reservationId" = r."id");
UPDATE "Reservation" r SET "origin" = 'CHANNEL'
  WHERE r."origin" = 'DESK' AND EXISTS (SELECT 1 FROM "ChannelInboundBooking" c WHERE c."reservationId" = r."id");
UPDATE "Reservation" SET "origin" = 'GROUP_PICKUP'
  WHERE "origin" = 'DESK' AND "groupBlockId" IS NOT NULL AND "isPostingMaster" = false;
