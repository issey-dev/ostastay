-- Split stays: which nights a rate-plan allocation covers (null = whole stay).
ALTER TABLE "ReservationAllocation" ADD COLUMN "appliesTo" TEXT;
