-- Agent Portal plan Phase 2: sell limits, overflow bookings.
CREATE TABLE "AvailabilitySellLimit" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "extraRooms" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AvailabilitySellLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AvailabilitySellLimit_propertyId_roomTypeId_date_key" ON "AvailabilitySellLimit"("propertyId", "roomTypeId", "date");
CREATE INDEX "AvailabilitySellLimit_propertyId_date_idx" ON "AvailabilitySellLimit"("propertyId", "date");
CREATE INDEX "AvailabilitySellLimit_roomTypeId_idx" ON "AvailabilitySellLimit"("roomTypeId");
ALTER TABLE "AvailabilitySellLimit" ADD CONSTRAINT "AvailabilitySellLimit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySellLimit" ADD CONSTRAINT "AvailabilitySellLimit_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Reservation" ADD COLUMN "isOverflow" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Reservation" ADD COLUMN "overflowHotelName" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "overflowNote" TEXT;

ALTER TABLE "PropertySettings" ADD COLUMN "maxOverflowPerNight" INTEGER;
