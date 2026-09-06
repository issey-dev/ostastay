-- Website API: per-enterprise API keys (managed in the Hub) granting a property's brand
-- website read access to property info / availability / prices and the ability to create
-- bookings. See .agents/docs/WEBSITE_API_PLAN.md and docs/WEBSITE_API.md.

-- CreateTable
CREATE TABLE "WebsiteApiKey" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "WebsiteApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteApiKeyProperty" (
    "keyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteApiKeyProperty_pkey" PRIMARY KEY ("keyId","propertyId")
);

-- CreateTable
CREATE TABLE "WebsitePropertySettings" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "headline" TEXT,
    "description" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policies" TEXT,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ratePlanId" TEXT,
    "mealPlanCode" TEXT NOT NULL DEFAULT 'NONE',
    "maxNightsAhead" INTEGER NOT NULL DEFAULT 365,
    "minNights" INTEGER NOT NULL DEFAULT 1,
    "deskRemark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsitePropertySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteBooking" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "problem" TEXT,
    "guestFirstName" TEXT NOT NULL,
    "guestLastName" TEXT,
    "guestEmail" TEXT NOT NULL,
    "guestPhone" TEXT,
    "arrival" TIMESTAMP(3) NOT NULL,
    "departure" TIMESTAMP(3) NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "remarks" TEXT,
    "quotedTotal" DOUBLE PRECISION,
    "currency" TEXT,
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteApiKey_keyHash_key" ON "WebsiteApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "WebsiteApiKey_enterpriseId_idx" ON "WebsiteApiKey"("enterpriseId");

-- CreateIndex
CREATE INDEX "WebsiteApiKey_createdByUserId_idx" ON "WebsiteApiKey"("createdByUserId");

-- CreateIndex
CREATE INDEX "WebsiteApiKeyProperty_propertyId_idx" ON "WebsiteApiKeyProperty"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsitePropertySettings_propertyId_key" ON "WebsitePropertySettings"("propertyId");

-- CreateIndex
CREATE INDEX "WebsitePropertySettings_ratePlanId_idx" ON "WebsitePropertySettings"("ratePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteBooking_reservationId_key" ON "WebsiteBooking"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteBooking_keyId_idempotencyKey_key" ON "WebsiteBooking"("keyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WebsiteBooking_enterpriseId_createdAt_idx" ON "WebsiteBooking"("enterpriseId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteBooking_propertyId_createdAt_idx" ON "WebsiteBooking"("propertyId", "createdAt");

-- AddForeignKey
ALTER TABLE "WebsiteApiKey" ADD CONSTRAINT "WebsiteApiKey_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteApiKey" ADD CONSTRAINT "WebsiteApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteApiKeyProperty" ADD CONSTRAINT "WebsiteApiKeyProperty_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "WebsiteApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteApiKeyProperty" ADD CONSTRAINT "WebsiteApiKeyProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsitePropertySettings" ADD CONSTRAINT "WebsitePropertySettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsitePropertySettings" ADD CONSTRAINT "WebsitePropertySettings_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteBooking" ADD CONSTRAINT "WebsiteBooking_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteBooking" ADD CONSTRAINT "WebsiteBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteBooking" ADD CONSTRAINT "WebsiteBooking_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "WebsiteApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteBooking" ADD CONSTRAINT "WebsiteBooking_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
