-- Folio check numbers (owner, 2026-09-26 — see .agents/docs/DECISIONS.md "Folio check
-- numbers and roll-up"). Every posting carries a property-wide running check number; a
-- charge and the Service Charge / GST / levy lines it generates share it, and a Night
-- Audit stay-night's room rate + extra occupancy + allocations share ONE. The folio screen
-- rolls lines with the same number in the same folio up into one line.

ALTER TABLE "FolioLineItem" ADD COLUMN "checkNo" TEXT;

CREATE INDEX "FolioLineItem_folioId_checkNo_idx" ON "FolioLineItem"("folioId", "checkNo");

-- Backfill, so existing folios roll up the same way new ones will.
--
--   * A ROOT line (generatedFromLineItemId IS NULL) starts a check. A generated line
--     (Service Charge, GST, Green Tax, levies) takes its root ancestor's number.
--   * Night Audit night groups: on one folio and one `date`, the room line(s) (a line
--     with a roomAssignmentId — room rate and extra occupancy) together with the root
--     lines whose charge code is one of that folio's reservation's allocation charge codes
--     form one check — plus, for older postings, room-bucket lines without a
--     roomAssignmentId and a night's separately posted levy (Green Tax, postingType TAX).
--     An allocation line with no room line beside it (routed elsewhere,
--     or posted on a day with no room charge) is a check of its own.
--   * Everything else: one check per root line.
--   * Numbers run per property, in the order the checks were first posted (earliest
--     createdAt), stored as plain digits ("1", "2", ...).
WITH RECURSIVE
ancestry AS (
  SELECT l."id", l."id" AS root_id
  FROM "FolioLineItem" l
  WHERE l."generatedFromLineItemId" IS NULL
  UNION ALL
  SELECT c."id", a.root_id
  FROM "FolioLineItem" c
  JOIN ancestry a ON c."generatedFromLineItemId" = a."id"
),
-- Room revenue codes (report bucket ROOM). Older postings of a night carry no
-- roomAssignmentId, so the code is the other way to recognise a room line.
room_codes AS (
  SELECT cc."id"
  FROM "ChargeCode" cc
  JOIN "ChargeSubgroup" sg ON sg."id" = cc."chargeSubgroupId"
  JOIN "ChargeGroup" g ON g."id" = sg."chargeGroupId"
  WHERE g."reportBucket" = 'ROOM'
),
room_nights AS (
  SELECT DISTINCT l."folioId", l."date"
  FROM "FolioLineItem" l
  WHERE l."generatedFromLineItemId" IS NULL
    AND (l."roomAssignmentId" IS NOT NULL OR l."chargeCodeId" IN (SELECT "id" FROM room_codes))
),
-- Levy codes (postingType TAX — Green Tax and the like). Before levies were generated
-- from the room line, Night Audit posted the night's Green Tax as a line of its own.
levy_codes AS (
  SELECT cc."id" FROM "ChargeCode" cc WHERE cc."postingType" = 'TAX'
),
allocation_codes AS (
  SELECT DISTINCT f."id" AS folio_id, al."chargeCodeId"
  FROM "Folio" f
  JOIN "ReservationAllocation" ra ON ra."reservationId" = f."reservationId"
  JOIN "Allocation" al ON al."id" = ra."allocationId"
),
roots AS (
  SELECT
    l."id",
    l."createdAt",
    f."propertyId",
    CASE
      WHEN rn."folioId" IS NOT NULL AND (
        l."roomAssignmentId" IS NOT NULL
        OR ac.folio_id IS NOT NULL
        OR l."chargeCodeId" IN (SELECT "id" FROM room_codes)
        OR l."chargeCodeId" IN (SELECT "id" FROM levy_codes)
      )
        THEN 'N:' || l."folioId" || ':' || l."date"::text
      ELSE 'L:' || l."id"
    END AS group_key
  FROM "FolioLineItem" l
  JOIN "Folio" f ON f."id" = l."folioId"
  LEFT JOIN room_nights rn ON rn."folioId" = l."folioId" AND rn."date" = l."date"
  LEFT JOIN allocation_codes ac ON ac.folio_id = l."folioId" AND ac."chargeCodeId" = l."chargeCodeId"
  WHERE l."generatedFromLineItemId" IS NULL
),
check_groups AS (
  SELECT "propertyId", group_key, MIN("createdAt") AS first_posted
  FROM roots
  GROUP BY "propertyId", group_key
),
numbered AS (
  SELECT
    "propertyId",
    group_key,
    ROW_NUMBER() OVER (PARTITION BY "propertyId" ORDER BY first_posted, group_key) AS n
  FROM check_groups
),
root_numbers AS (
  SELECT r."id", nb.n
  FROM roots r
  JOIN numbered nb ON nb."propertyId" = r."propertyId" AND nb.group_key = r.group_key
)
UPDATE "FolioLineItem" l
SET "checkNo" = rn.n::text
FROM ancestry a
JOIN root_numbers rn ON rn."id" = a.root_id
WHERE l."id" = a."id";

-- The Sequence Manager's CHECK_NO counter holds the LAST number issued, so the next
-- posting at each property continues after the backfilled ones.
INSERT INTO "PropertySequence" ("id", "propertyId", "sequenceType", "currentValue", "updatedAt")
SELECT gen_random_uuid()::text, f."propertyId", 'CHECK_NO', MAX(l."checkNo"::bigint)::int, NOW()
FROM "FolioLineItem" l
JOIN "Folio" f ON f."id" = l."folioId"
WHERE l."checkNo" ~ '^[0-9]{1,9}$'
GROUP BY f."propertyId"
ON CONFLICT ("propertyId", "sequenceType")
DO UPDATE SET "currentValue" = GREATEST("PropertySequence"."currentValue", EXCLUDED."currentValue"), "updatedAt" = NOW();
