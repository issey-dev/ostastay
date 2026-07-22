-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "Reservation" ADD COLUMN "noShowAt" DATETIME;

