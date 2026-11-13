-- Agent Portal plan Phase 5: agent portal logins and sessions; agent portal settings.
ALTER TABLE "PropertySettings" ADD COLUMN "agentPortalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PropertySettings" ADD COLUMN "agentAvailabilityCap" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "PropertySettings" ADD COLUMN "guestDetailsDueDays" INTEGER NOT NULL DEFAULT 7;

CREATE TABLE "AgentUser" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "sourceProfileId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentUser_inviteTokenHash_key" ON "AgentUser"("inviteTokenHash");
CREATE UNIQUE INDEX "AgentUser_resetTokenHash_key" ON "AgentUser"("resetTokenHash");
CREATE UNIQUE INDEX "AgentUser_enterpriseId_email_key" ON "AgentUser"("enterpriseId", "email");
CREATE INDEX "AgentUser_sourceProfileId_idx" ON "AgentUser"("sourceProfileId");
ALTER TABLE "AgentUser" ADD CONSTRAINT "AgentUser_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentSession_tokenHash_key" ON "AgentSession"("tokenHash");
CREATE INDEX "AgentSession_agentUserId_idx" ON "AgentSession"("agentUserId");
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "AgentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
