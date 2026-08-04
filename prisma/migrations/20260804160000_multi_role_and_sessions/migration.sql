-- Multi-role, real sessions, and a protected onboarding account.
-- See .agents/docs/USER_MANAGEMENT_PLAN.md phases 0-2.
--
-- Ordering matters throughout: every backfill runs BEFORE the thing it reads is dropped.

-- ---------------------------------------------------------------------------
-- 1. Multi-role
-- ---------------------------------------------------------------------------
-- A user's access becomes the UNION of every role they hold. `User.roleId` was a required
-- scalar, so the single role each user has today must be carried into the join table
-- before the column can go — otherwise every user in every tenant loses all access.

CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- THE load-bearing statement of this migration. Every existing user keeps exactly the
-- access they had.
INSERT INTO "UserRole" ("userId", "roleId", "assignedAt")
SELECT u."id", u."roleId", CURRENT_TIMESTAMP FROM "User" u;

-- Only now is it safe to drop the old column.
DROP INDEX IF EXISTS "User_roleId_idx";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_roleId_fkey";
ALTER TABLE "User" DROP COLUMN "roleId";

-- ---------------------------------------------------------------------------
-- 2. Sessions
-- ---------------------------------------------------------------------------
-- The JWT stays the credential; this row decides whether it is still honoured.
--
-- Existing tokens carry no `jti` and therefore have no row here. requireSession treats a
-- token whose jti is missing from this table as unauthenticated, so everyone currently
-- signed in is signed out by this deploy. That is deliberate and stated in the release
-- notes: the alternative is honouring un-revocable tokens for up to 24h, which defeats
-- the point of building this.

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "propertyId" TEXT,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_jti_key" ON "Session"("jti");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Session_revokedAt_idx" ON "Session"("revokedAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Idle timeout
-- ---------------------------------------------------------------------------
-- 0 keeps today's behaviour (a session lives its full 24h regardless of activity), so
-- this deploy changes no property's timeout until someone sets one.
ALTER TABLE "Property" ADD COLUMN "sessionIdleMinutes" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 4. Protected onboarding account
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "isProtected" BOOLEAN NOT NULL DEFAULT false;

-- Mark one account per enterprise: the OLDEST active, ENTERPRISE-scoped user holding a
-- role with full access to CONTROLS. That is the onboarding account's signature, and
-- picking the oldest makes the choice deterministic rather than arbitrary.
--
-- An enterprise with no such user gets none, and stays exactly as protectable as it is
-- today — better than promoting an unrelated account into being undeletable.
WITH candidate AS (
  SELECT DISTINCT ON (u."enterpriseId") u."id"
  FROM "User" u
  JOIN "UserRole" ur ON ur."userId" = u."id"
  JOIN "RolePermission" rp ON rp."roleId" = ur."roleId"
  WHERE u."isActive" = true
    AND u."scope" = 'ENTERPRISE'
    AND rp."module" = 'CONTROLS'
    AND rp."canView" AND rp."canCreate" AND rp."canUpdate" AND rp."canDelete"
  ORDER BY u."enterpriseId", u."createdAt" ASC
)
UPDATE "User" SET "isProtected" = true
WHERE "id" IN (SELECT "id" FROM candidate);
