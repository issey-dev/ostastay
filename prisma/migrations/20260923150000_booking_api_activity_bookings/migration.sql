-- Booking API Phase 2 (.agents/docs/BOOKING_API_ADDONS_PLAN.md): Excursion (and, in Phase 3,
-- Spa) bookings made by brand websites.
--
-- ApiActivityBooking: holds, idempotency, audit (FAILED included) and the guest's public
-- reference for one Booking API attempt. ExcursionBooking.source: every existing booking
-- was made at the desk, so the default 'DESK' is also the correct backfill.

-- AlterTable
ALTER TABLE "ExcursionBooking" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'DESK';

-- CreateTable
CREATE TABLE "ApiActivityBooking" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "publicRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "problem" TEXT,
    "idempotencyKey" TEXT,
    "holdExpiresAt" TIMESTAMP(3),
    "excursionDepartureId" TEXT,
    "adults" INTEGER NOT NULL DEFAULT 0,
    "children" INTEGER NOT NULL DEFAULT 0,
    "infants" INTEGER NOT NULL DEFAULT 0,
    "guestFirstName" TEXT,
    "guestLastName" TEXT,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "remarks" TEXT,
    "paymentStatus" TEXT,
    "paymentProvider" TEXT,
    "paymentReference" TEXT,
    "paymentAmount" DOUBLE PRECISION,
    "paymentCurrency" TEXT,
    "amountMismatch" BOOLEAN NOT NULL DEFAULT false,
    "quotedTotal" DOUBLE PRECISION,
    "currency" TEXT,
    "requestIp" TEXT,
    "excursionBookingId" TEXT,
    "spaAppointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiActivityBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiActivityBooking_publicRef_key" ON "ApiActivityBooking"("publicRef");

-- CreateIndex
CREATE UNIQUE INDEX "ApiActivityBooking_excursionBookingId_key" ON "ApiActivityBooking"("excursionBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiActivityBooking_spaAppointmentId_key" ON "ApiActivityBooking"("spaAppointmentId");

-- CreateIndex
CREATE INDEX "ApiActivityBooking_excursionDepartureId_status_idx" ON "ApiActivityBooking"("excursionDepartureId", "status");

-- CreateIndex
CREATE INDEX "ApiActivityBooking_propertyId_createdAt_idx" ON "ApiActivityBooking"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiActivityBooking_enterpriseId_createdAt_idx" ON "ApiActivityBooking"("enterpriseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiActivityBooking_keyId_idempotencyKey_key" ON "ApiActivityBooking"("keyId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ApiActivityBooking" ADD CONSTRAINT "ApiActivityBooking_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiActivityBooking" ADD CONSTRAINT "ApiActivityBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiActivityBooking" ADD CONSTRAINT "ApiActivityBooking_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "WebsiteApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiActivityBooking" ADD CONSTRAINT "ApiActivityBooking_excursionDepartureId_fkey" FOREIGN KEY ("excursionDepartureId") REFERENCES "ExcursionDeparture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiActivityBooking" ADD CONSTRAINT "ApiActivityBooking_excursionBookingId_fkey" FOREIGN KEY ("excursionBookingId") REFERENCES "ExcursionBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiActivityBooking" ADD CONSTRAINT "ApiActivityBooking_spaAppointmentId_fkey" FOREIGN KEY ("spaAppointmentId") REFERENCES "SpaAppointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

