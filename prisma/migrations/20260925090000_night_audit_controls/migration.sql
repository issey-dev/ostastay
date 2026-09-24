-- Night Audit controls (2026-09-25): no-show timing and fee, and the scheduled audit. Per property.

-- AlterTable
ALTER TABLE "PropertySettings" ADD COLUMN     "autoAuditEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoAuditTime" TEXT NOT NULL DEFAULT '02:00',
ADD COLUMN     "noShowPostFee" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "noShowTiming" TEXT NOT NULL DEFAULT 'FIRST_AUDIT';

