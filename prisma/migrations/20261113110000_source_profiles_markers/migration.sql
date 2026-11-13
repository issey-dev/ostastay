-- Agent Portal plan Phase 3: Source profiles, the Source on a reservation, booking markers.
ALTER TABLE "Profile" ADD COLUMN "settlementMode" TEXT;
ALTER TABLE "Profile" ADD COLUMN "earlyAccessDays" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "portalAutoConfirm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Profile" ADD COLUMN "markerIcon" TEXT;
ALTER TABLE "Profile" ADD COLUMN "markerColor" TEXT;

ALTER TABLE "Reservation" ADD COLUMN "sourceProfileId" TEXT;
CREATE INDEX "Reservation_sourceProfileId_idx" ON "Reservation"("sourceProfileId");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "Profile"("upid") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BookingMarker" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "match" TEXT NOT NULL,
    "matchValue" TEXT,
    "icon" TEXT NOT NULL,
    "colorToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingMarker_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BookingMarker_propertyId_sortOrder_idx" ON "BookingMarker"("propertyId", "sortOrder");
ALTER TABLE "BookingMarker" ADD CONSTRAINT "BookingMarker_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
