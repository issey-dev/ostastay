-- Operations Dashboard: a per-user saved arrangement, a per-role widget block list, and
-- the DASHBOARD module those are configured under.

-- CreateTable
CREATE TABLE "UserDashboardLayout" (
    "userId" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboardLayout_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RoleDashboardWidget" (
    "roleId" TEXT NOT NULL,
    "widgetId" TEXT NOT NULL,

    CONSTRAINT "RoleDashboardWidget_pkey" PRIMARY KEY ("roleId","widgetId")
);

-- CreateIndex
CREATE INDEX "RoleDashboardWidget_roleId_idx" ON "RoleDashboardWidget"("roleId");

-- AddForeignKey
ALTER TABLE "UserDashboardLayout" ADD CONSTRAINT "UserDashboardLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleDashboardWidget" ADD CONSTRAINT "RoleDashboardWidget_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant the new DASHBOARD module to every role that already exists.
--
-- Load-bearing, not housekeeping. Until now the Operations Dashboard had no module of its
-- own and every role could open it; from here it is gated on DASHBOARD.canView. New roles
-- pick their default up from prisma/rbac-seed-data.ts, but an existing CUSTOM role would
-- otherwise be handed canView=false by backfillMissingRolePermissions() and silently lose
-- a page it has always had. Grant view to everyone, and the manage bits only where the
-- role can already administer the property, so nothing is taken away and nothing new is
-- handed out.
INSERT INTO "RolePermission" ("id", "roleId", "module", "canView", "canCreate", "canUpdate", "canDelete")
SELECT
    gen_random_uuid()::text,
    r."id",
    'DASHBOARD',
    true,
    false,
    -- Configuring which widgets a role may see is an administrative act: allow it exactly
    -- where the role can already change the property's configuration.
    COALESCE((SELECT rp."canUpdate" FROM "RolePermission" rp WHERE rp."roleId" = r."id" AND rp."module" = 'CONTROLS'), false),
    false
FROM "Role" r
WHERE NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r."id" AND rp."module" = 'DASHBOARD'
);
