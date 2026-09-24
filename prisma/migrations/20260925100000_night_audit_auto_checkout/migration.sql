-- Night Audit: check out settled (zero-balance) departures automatically. Per property, off by default.

-- AlterTable
ALTER TABLE "PropertySettings" ADD COLUMN     "autoCheckOutZeroBalance" BOOLEAN NOT NULL DEFAULT false;

