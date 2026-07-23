-- AlterTable
ALTER TABLE "ExcursionBooking" ADD COLUMN "movedToBookingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionBooking_movedToBookingId_key" ON "ExcursionBooking"("movedToBookingId");

