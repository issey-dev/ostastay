-- Transportation module (.agents/docs/TRANSPORTATION_PLAN.md): per-property transport
-- configuration (settings, types, locations, routes, providers, vessels, rates) and
-- operations (manifests, bookings). Additive only — no existing table changes.

-- CreateTable
CREATE TABLE "TransportSettings" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultTaxMode" TEXT NOT NULL DEFAULT 'CHARGE_CODE',
    "defaultTaxProfileId" TEXT,
    "defaultChargeCodeId" TEXT,
    "requireProvider" BOOLEAN NOT NULL DEFAULT false,
    "attentionToleranceMinutes" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportType" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SPEEDBOAT',
    "requiresFlightDetails" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportLocation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRoute" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "transportTypeId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'AIRPORT_TRANSFER',
    "direction" TEXT NOT NULL DEFAULT 'BOTH',
    "durationMinutes" INTEGER,
    "instructions" TEXT,
    "departureSlots" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportProvider" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OWN',
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportVessel" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transportTypeId" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 10,
    "registration" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportVessel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRate" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "transportTypeId" TEXT,
    "providerId" TEXT,
    "name" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'BOTH',
    "pricingBasis" TEXT NOT NULL DEFAULT 'PER_PERSON',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adultPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "childPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "infantPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "childMinAge" INTEGER NOT NULL DEFAULT 2,
    "childMaxAge" INTEGER NOT NULL DEFAULT 11,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "chargeCodeId" TEXT NOT NULL,
    "taxMode" TEXT NOT NULL DEFAULT 'CHARGE_CODE',
    "taxProfileId" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportManifest" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    "routeId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "transportTypeId" TEXT,
    "providerId" TEXT,
    "vesselId" TEXT,
    "driverName" TEXT,
    "driverContact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportBooking" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "groupBlockId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestContact" TEXT,
    "folioId" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "infants" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "airline" TEXT,
    "flightNo" TEXT,
    "flightAt" TIMESTAMP(3),
    "terminal" TEXT,
    "airportRepUserId" TEXT,
    "meetingNotes" TEXT,
    "flightAtOnManifest" TIMESTAMP(3),
    "routeId" TEXT,
    "transportTypeId" TEXT,
    "departureAt" TIMESTAMP(3),
    "manifestId" TEXT,
    "providerId" TEXT,
    "vesselId" TEXT,
    "driverName" TEXT,
    "driverContact" TEXT,
    "seatNote" TEXT,
    "rateId" TEXT,
    "vehicleCount" INTEGER NOT NULL DEFAULT 1,
    "amount" DOUBLE PRECISION,
    "priceOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "chargeCodeId" TEXT,
    "taxMode" TEXT NOT NULL DEFAULT 'CHARGE_CODE',
    "taxProfileId" TEXT,
    "billingStatus" TEXT NOT NULL DEFAULT 'NOT_BILLED',
    "folioLineItemId" TEXT,
    "postedAt" TIMESTAMP(3),
    "billingNote" TEXT,
    "createdByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransportSettings_propertyId_key" ON "TransportSettings"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportType_propertyId_code_key" ON "TransportType"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TransportLocation_propertyId_code_key" ON "TransportLocation"("propertyId", "code");

-- CreateIndex
CREATE INDEX "TransportRoute_originId_idx" ON "TransportRoute"("originId");

-- CreateIndex
CREATE INDEX "TransportRoute_destinationId_idx" ON "TransportRoute"("destinationId");

-- CreateIndex
CREATE INDEX "TransportRoute_transportTypeId_idx" ON "TransportRoute"("transportTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRoute_propertyId_code_key" ON "TransportRoute"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TransportProvider_propertyId_name_key" ON "TransportProvider"("propertyId", "name");

-- CreateIndex
CREATE INDEX "TransportVessel_propertyId_idx" ON "TransportVessel"("propertyId");

-- CreateIndex
CREATE INDEX "TransportVessel_providerId_idx" ON "TransportVessel"("providerId");

-- CreateIndex
CREATE INDEX "TransportVessel_transportTypeId_idx" ON "TransportVessel"("transportTypeId");

-- CreateIndex
CREATE INDEX "TransportRate_propertyId_idx" ON "TransportRate"("propertyId");

-- CreateIndex
CREATE INDEX "TransportRate_routeId_idx" ON "TransportRate"("routeId");

-- CreateIndex
CREATE INDEX "TransportRate_transportTypeId_idx" ON "TransportRate"("transportTypeId");

-- CreateIndex
CREATE INDEX "TransportRate_providerId_idx" ON "TransportRate"("providerId");

-- CreateIndex
CREATE INDEX "TransportRate_chargeCodeId_idx" ON "TransportRate"("chargeCodeId");

-- CreateIndex
CREATE INDEX "TransportRate_taxProfileId_idx" ON "TransportRate"("taxProfileId");

-- CreateIndex
CREATE INDEX "TransportManifest_propertyId_serviceDate_direction_transpor_idx" ON "TransportManifest"("propertyId", "serviceDate", "direction", "transportTypeId");

-- CreateIndex
CREATE INDEX "TransportManifest_routeId_idx" ON "TransportManifest"("routeId");

-- CreateIndex
CREATE INDEX "TransportManifest_transportTypeId_idx" ON "TransportManifest"("transportTypeId");

-- CreateIndex
CREATE INDEX "TransportManifest_providerId_idx" ON "TransportManifest"("providerId");

-- CreateIndex
CREATE INDEX "TransportManifest_vesselId_idx" ON "TransportManifest"("vesselId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportBooking_folioLineItemId_key" ON "TransportBooking"("folioLineItemId");

-- CreateIndex
CREATE INDEX "TransportBooking_propertyId_serviceDate_direction_transport_idx" ON "TransportBooking"("propertyId", "serviceDate", "direction", "transportTypeId");

-- CreateIndex
CREATE INDEX "TransportBooking_reservationId_idx" ON "TransportBooking"("reservationId");

-- CreateIndex
CREATE INDEX "TransportBooking_groupBlockId_idx" ON "TransportBooking"("groupBlockId");

-- CreateIndex
CREATE INDEX "TransportBooking_folioId_idx" ON "TransportBooking"("folioId");

-- CreateIndex
CREATE INDEX "TransportBooking_airportRepUserId_idx" ON "TransportBooking"("airportRepUserId");

-- CreateIndex
CREATE INDEX "TransportBooking_routeId_idx" ON "TransportBooking"("routeId");

-- CreateIndex
CREATE INDEX "TransportBooking_transportTypeId_idx" ON "TransportBooking"("transportTypeId");

-- CreateIndex
CREATE INDEX "TransportBooking_manifestId_idx" ON "TransportBooking"("manifestId");

-- CreateIndex
CREATE INDEX "TransportBooking_providerId_idx" ON "TransportBooking"("providerId");

-- CreateIndex
CREATE INDEX "TransportBooking_vesselId_idx" ON "TransportBooking"("vesselId");

-- CreateIndex
CREATE INDEX "TransportBooking_rateId_idx" ON "TransportBooking"("rateId");

-- CreateIndex
CREATE INDEX "TransportBooking_propertyId_billingStatus_idx" ON "TransportBooking"("propertyId", "billingStatus");

-- AddForeignKey
ALTER TABLE "TransportSettings" ADD CONSTRAINT "TransportSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportType" ADD CONSTRAINT "TransportType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportLocation" ADD CONSTRAINT "TransportLocation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_originId_fkey" FOREIGN KEY ("originId") REFERENCES "TransportLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "TransportLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_transportTypeId_fkey" FOREIGN KEY ("transportTypeId") REFERENCES "TransportType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportProvider" ADD CONSTRAINT "TransportProvider_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVessel" ADD CONSTRAINT "TransportVessel_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVessel" ADD CONSTRAINT "TransportVessel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TransportProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVessel" ADD CONSTRAINT "TransportVessel_transportTypeId_fkey" FOREIGN KEY ("transportTypeId") REFERENCES "TransportType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRate" ADD CONSTRAINT "TransportRate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRate" ADD CONSTRAINT "TransportRate_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRate" ADD CONSTRAINT "TransportRate_transportTypeId_fkey" FOREIGN KEY ("transportTypeId") REFERENCES "TransportType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRate" ADD CONSTRAINT "TransportRate_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TransportProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRate" ADD CONSTRAINT "TransportRate_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRate" ADD CONSTRAINT "TransportRate_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportManifest" ADD CONSTRAINT "TransportManifest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportManifest" ADD CONSTRAINT "TransportManifest_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportManifest" ADD CONSTRAINT "TransportManifest_transportTypeId_fkey" FOREIGN KEY ("transportTypeId") REFERENCES "TransportType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportManifest" ADD CONSTRAINT "TransportManifest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TransportProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportManifest" ADD CONSTRAINT "TransportManifest_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "TransportVessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_airportRepUserId_fkey" FOREIGN KEY ("airportRepUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_transportTypeId_fkey" FOREIGN KEY ("transportTypeId") REFERENCES "TransportType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "TransportManifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "TransportProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "TransportVessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_rateId_fkey" FOREIGN KEY ("rateId") REFERENCES "TransportRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBooking" ADD CONSTRAINT "TransportBooking_folioLineItemId_fkey" FOREIGN KEY ("folioLineItemId") REFERENCES "FolioLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

