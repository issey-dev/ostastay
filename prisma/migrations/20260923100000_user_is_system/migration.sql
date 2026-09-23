-- A system-owned account that no person signs in as: today, the one "Online Bookings"
-- user per enterprise that the public Booking API books Excursions and Spa under
-- (src/lib/system-actor.ts, BOOKING_API_ADDONS_PLAN.md Phase 0 §4). It exists so those
-- bookings have a real User for bookedByUserId, a cashier shift and the activity log.
--
-- Such accounts are created inactive with an unusable password, and every staff list
-- filters them out. Defaults FALSE: every existing user stays exactly as it is.
ALTER TABLE "User" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
