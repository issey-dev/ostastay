-- Agent booking facts on the reservation (Agent Portal plan section 4).
ALTER TABLE "Reservation" ADD COLUMN "packageName" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "agentReference" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "agentUserId" TEXT;
