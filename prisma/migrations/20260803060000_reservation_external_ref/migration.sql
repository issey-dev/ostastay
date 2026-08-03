-- Reservation.externalRef: the originating channel's own booking id, first-class on the
-- reservation so staff can match a Beds24/OTA reference straight to the stay. Until now
-- the id lived only on ChannelInboundBooking (and inside the reservation's remarks text),
-- so matching in the channel→reservation direction worked but reservation-side search
-- did not.
ALTER TABLE "Reservation" ADD COLUMN "externalRef" TEXT;

-- Backfill every already-converted channel booking from its provenance row. The link is
-- ChannelInboundBooking.reservationId (SetNull on reservation delete, so only live pairs
-- match). If several inbound rows ever pointed at one reservation, any of their ids is a
-- correct external reference; no ordering is imposed.
UPDATE "Reservation" r
SET "externalRef" = cib."externalBookingId"
FROM "ChannelInboundBooking" cib
WHERE cib."reservationId" = r."id";
