-- Booking API Phase 3: a Spa hold made by a brand website is a TENTATIVE appointment that
-- blocks its therapist(s) and room until holdExpiresAt (BOOKING_API_ADDONS_PLAN.md).
-- Null on every existing row, which keeps the old createdAt + tentativeHoldMinutes rule.

-- AlterTable
ALTER TABLE "SpaAppointment" ADD COLUMN     "holdExpiresAt" TIMESTAMP(3);

