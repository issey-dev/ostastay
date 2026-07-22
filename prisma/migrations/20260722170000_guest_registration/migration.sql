-- AlterTable
ALTER TABLE "EodRun" ADD COLUMN "registrationAt" DATETIME;

-- AlterTable
ALTER TABLE "PropertySequence" ADD COLUMN "resetYear" INTEGER;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "checkedInAt" DATETIME;

-- CreateTable
CREATE TABLE "GuestRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "registrationNo" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "businessDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestRegistration_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GuestRegistration_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GuestRegistration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("upid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestRegistration_propertyId_year_registrationNo_key" ON "GuestRegistration"("propertyId", "year", "registrationNo");

-- CreateIndex
CREATE UNIQUE INDEX "GuestRegistration_reservationId_profileId_key" ON "GuestRegistration"("reservationId", "profileId");

