-- The saved Operations Dashboard arrangement becomes per user AND per property.
--
-- Keyed on the user alone, one person's two properties shared a single arrangement, so
-- whichever they tidied last became the layout for both. A city hotel with a busy debtors
-- ledger and an island resort running excursions and a spa are two different jobs.

-- Add the column, nullable for the moment so the backfill below has something to write to.
ALTER TABLE "UserDashboardLayout" ADD COLUMN "propertyId" TEXT;

-- Preserve what people already arranged, by giving every property the user can reach the
-- layout that until now applied to all of them. That is precisely what the old row meant,
-- so nobody opens a property tomorrow and finds their arrangement gone; from here each
-- property's copy diverges as it is edited.
--
-- Enterprise-scoped users get a row per ACTIVE property in their enterprise; a
-- property-scoped user is pinned to one work location and gets only that.
CREATE TABLE "UserDashboardLayout_migration_tmp" AS
SELECT
    l."userId",
    p."id" AS "propertyId",
    l."layout",
    l."updatedAt"
FROM "UserDashboardLayout" l
JOIN "User" u ON u."id" = l."userId"
JOIN "Property" p
  ON p."enterpriseId" = u."enterpriseId"
 AND p."status" = 'ACTIVE'
 AND (u."propertyId" IS NULL OR p."id" = u."propertyId");

DELETE FROM "UserDashboardLayout";

INSERT INTO "UserDashboardLayout" ("userId", "propertyId", "layout", "updatedAt")
SELECT "userId", "propertyId", "layout", "updatedAt" FROM "UserDashboardLayout_migration_tmp";

DROP TABLE "UserDashboardLayout_migration_tmp";

-- Now the column can carry its real shape.
ALTER TABLE "UserDashboardLayout" ALTER COLUMN "propertyId" SET NOT NULL;

-- DropPrimaryKey / AddPrimaryKey
ALTER TABLE "UserDashboardLayout" DROP CONSTRAINT "UserDashboardLayout_pkey";
ALTER TABLE "UserDashboardLayout" ADD CONSTRAINT "UserDashboardLayout_pkey" PRIMARY KEY ("userId", "propertyId");

-- CreateIndex
CREATE INDEX "UserDashboardLayout_propertyId_idx" ON "UserDashboardLayout"("propertyId");

-- AddForeignKey
ALTER TABLE "UserDashboardLayout" ADD CONSTRAINT "UserDashboardLayout_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
