-- Enforce at most ONE open cashier shift per (user, property). ensureOpenShift did a
-- find-then-create with no constraint, so two concurrent first-postings could open two
-- drawers and a close would shut only the latest, splitting a shift's payments.
-- A partial unique index is the right tool (only OPEN shifts are constrained); Prisma's
-- schema can't express a WHERE-filtered index, so it lives here as a DB-level constraint.
-- ensureOpenShift catches the resulting P2002 and returns the winning shift.

-- Close any pre-existing duplicate open shifts first (keep the most recently opened),
-- so the index can be created. propertyId-null (pre-migration) rows are left alone.
UPDATE "CashierShift"
SET "closedAt" = "openedAt"
WHERE "closedAt" IS NULL
  AND "propertyId" IS NOT NULL
  AND "id" NOT IN (
    SELECT "id" FROM (
      SELECT "id",
        ROW_NUMBER() OVER (PARTITION BY "userId", "propertyId" ORDER BY "openedAt" DESC) AS rn
      FROM "CashierShift"
      WHERE "closedAt" IS NULL AND "propertyId" IS NOT NULL
    ) WHERE rn = 1
  );

CREATE UNIQUE INDEX "CashierShift_one_open_per_user_property"
  ON "CashierShift"("userId", "propertyId")
  WHERE "closedAt" IS NULL;
