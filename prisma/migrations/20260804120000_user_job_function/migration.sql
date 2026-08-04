-- A user's JOB FUNCTION — their post at the property — separated from their ROLE, which
-- is what the app lets them see and do.
--
-- Until now these were the same field. The housekeeping board found its staff with
-- `role.name === 'Housekeeping'` and maintenance did the same, so a hotel could not give a
-- housekeeper read access to Reservations without them vanishing from the room-assignment
-- picker. It also breaks outright once a user can hold more than one role, which is the
-- next phase — see .agents/docs/USER_MANAGEMENT_PLAN.md.

ALTER TABLE "User" ADD COLUMN "jobFunction" TEXT;

-- Seed the tenant-editable JOB_FUNCTION list for every existing enterprise. Kept in step
-- with DEFAULT_JOB_FUNCTIONS in src/lib/job-functions.ts, which seeds newly onboarded
-- enterprises via ensureJobFunctions(). ON CONFLICT so re-running is harmless and so an
-- enterprise that somehow already defined one of these keeps its own label.
INSERT INTO "SystemCode" ("id", "enterpriseId", "category", "code", "value", "sortOrder", "isActive")
SELECT
  gen_random_uuid(),
  e."id",
  'JOB_FUNCTION',
  v."code",
  v."value",
  v."sortOrder",
  true
FROM "Enterprise" e
CROSS JOIN (VALUES
  ('MANAGEMENT',     'Management',      1),
  ('FRONT_OFFICE',   'Front Office',    2),
  ('RESERVATIONS',   'Reservations',    3),
  ('CASHIER',        'Cashier',         4),
  ('HOUSEKEEPING',   'Housekeeping',    5),
  ('MAINTENANCE',    'Maintenance',     6),
  ('FOOD_BEVERAGE',  'Food & Beverage', 7),
  ('SPA',            'Spa',             8)
) AS v("code", "value", "sortOrder")
ON CONFLICT ("enterpriseId", "category", "code") DO NOTHING;

-- Backfill each user's post from the role name that was standing in for it.
--
-- This is what keeps the housekeeping and maintenance boards populated across the deploy:
-- the filters switch from role name to jobFunction in the same release, so without this
-- every board would come up empty and every existing room assignment would look orphaned.
-- Only the names that actually drove behaviour are mapped; everyone else is left NULL for
-- an admin to set, which is honest — the app never knew their post.
UPDATE "User" u
SET "jobFunction" = CASE r."name"
  WHEN 'Housekeeping' THEN 'HOUSEKEEPING'
  WHEN 'Maintenance'  THEN 'MAINTENANCE'
  WHEN 'Front Desk'   THEN 'FRONT_OFFICE'
  WHEN 'Cashier'      THEN 'CASHIER'
  WHEN 'Reservations' THEN 'RESERVATIONS'
END
FROM "Role" r
WHERE r."id" = u."roleId"
  AND r."name" IN ('Housekeeping', 'Maintenance', 'Front Desk', 'Cashier', 'Reservations');
