-- Channel bookings never store card details (DECISIONS.md, 2026-11-23). Card data is now
-- stripped before storage; this column keeps only the fact that a card was supplied.
ALTER TABLE "ChannelInboundBooking" ADD COLUMN "cardSupplied" BOOLEAN NOT NULL DEFAULT false;
