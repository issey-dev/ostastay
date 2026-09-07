-- Per-allocation distribution switch: may the external booking APIs (the brand
-- website today, the channel manager later) offer this extra to a guest?
--
-- Defaults TRUE and every existing row therefore keeps today's behaviour: a property
-- that has already switched "Offer paid extras online" on carries on offering exactly
-- the same list, and nobody's live site quietly stops selling a transfer because of an
-- upgrade. Online selling remains gated by WebsitePropertySettings.offerAddOns, which
-- is off until an administrator turns it on; this flag narrows that list rather than
-- acting as a second master switch.
ALTER TABLE "Allocation" ADD COLUMN "publishToApi" BOOLEAN NOT NULL DEFAULT true;
