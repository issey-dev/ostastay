-- MIRA Green Tax information sheet (GRTInfoSheet25.1) fields.
--   Profile.bookingMethod      — Booking Method on COMPANY/TRAVEL_AGENT profiles; a
--                                reservation reports its agent's value, or "FIT" with none.
--   ProfileDocument.isWorkPermit — flags a work-permit holder (sheet category 3).
ALTER TABLE "Profile" ADD COLUMN "bookingMethod" TEXT;
ALTER TABLE "ProfileDocument" ADD COLUMN "isWorkPermit" BOOLEAN NOT NULL DEFAULT false;
