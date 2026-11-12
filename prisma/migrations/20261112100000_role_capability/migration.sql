-- Agent Portal plan §10, Phase 0b: per-role capability overrides.
CREATE TABLE "RoleCapability" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoleCapability_roleId_capability_key" ON "RoleCapability"("roleId", "capability");
CREATE INDEX "RoleCapability_roleId_idx" ON "RoleCapability"("roleId");
ALTER TABLE "RoleCapability" ADD CONSTRAINT "RoleCapability_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
