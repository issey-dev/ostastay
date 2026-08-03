-- Property.businessDate was nullable and neither creation route set it, so every
-- property created through the app carried NULL until its first Night Audit. Server-side
-- code coped via resolveBusinessDate()'s server-date fallback, but the CLIENT reads the
-- raw column: the booking form had nothing to default Arrival to, and a walk-in — whose
-- Arrival is LOCKED to the business date — could not be booked at all on such a property.
--
-- Both creation routes now seed it. This backfills the properties that already exist,
-- so live deployments are fixed by deploying rather than by hand.
--
-- Uses the current UTC date, matching toUtcMidnight()/serverToday() in
-- src/lib/business-date.ts and the same fallback the server already applied to these
-- rows — so this makes explicit what the app was already assuming, changing no behaviour
-- beyond giving the client a value to read. Night Audit rolls it forward from here.
UPDATE "Property"
SET "businessDate" = date_trunc('day', (now() AT TIME ZONE 'UTC'))
WHERE "businessDate" IS NULL;
