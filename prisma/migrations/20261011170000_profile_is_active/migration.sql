-- Profiles with links can't be deleted: they are deactivated instead.
ALTER TABLE "Profile" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
