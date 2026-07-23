-- CreateTable
CREATE TABLE "PropertyModuleAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PropertyModuleAccess_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExcursionType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "chargeCodeId" TEXT NOT NULL,
    "pricingMode" TEXT NOT NULL DEFAULT 'PER_PERSON',
    "cutoffHours" INTEGER NOT NULL DEFAULT 24,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExcursionType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExcursionType_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExcursionRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "excursionTypeId" TEXT NOT NULL,
    "adultPrice" REAL NOT NULL DEFAULT 0,
    "childPrice" REAL NOT NULL DEFAULT 0,
    "infantPrice" REAL NOT NULL DEFAULT 0,
    "flatPrice" REAL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    CONSTRAINT "ExcursionRate_excursionTypeId_fkey" FOREIGN KEY ("excursionTypeId") REFERENCES "ExcursionType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExcursionSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "excursionTypeId" TEXT NOT NULL,
    "daysOfWeek" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "meetingTime" TEXT,
    "meetingPoint" TEXT,
    "capacity" INTEGER NOT NULL,
    "minCapacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExcursionSchedule_excursionTypeId_fkey" FOREIGN KEY ("excursionTypeId") REFERENCES "ExcursionType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExcursionDeparture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "excursionTypeId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "departureDate" DATETIME NOT NULL,
    "departureTime" TEXT NOT NULL,
    "meetingTime" TEXT,
    "meetingPoint" TEXT,
    "capacity" INTEGER NOT NULL,
    "minCapacity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExcursionDeparture_excursionTypeId_fkey" FOREIGN KEY ("excursionTypeId") REFERENCES "ExcursionType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExcursionDeparture_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ExcursionSchedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExcursionBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departureId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "adultCount" INTEGER NOT NULL DEFAULT 1,
    "childCount" INTEGER NOT NULL DEFAULT 0,
    "infantCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "folioId" TEXT NOT NULL,
    "folioLineItemId" TEXT,
    "refundPaymentId" TEXT,
    "notes" TEXT,
    "bookedByUserId" TEXT NOT NULL,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "movedFromDepartureId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExcursionBooking_departureId_fkey" FOREIGN KEY ("departureId") REFERENCES "ExcursionDeparture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExcursionBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExcursionBooking_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExcursionBooking_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExcursionBooking_folioLineItemId_fkey" FOREIGN KEY ("folioLineItemId") REFERENCES "FolioLineItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExcursionBooking_refundPaymentId_fkey" FOREIGN KEY ("refundPaymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExcursionBooking_movedFromDepartureId_fkey" FOREIGN KEY ("movedFromDepartureId") REFERENCES "ExcursionDeparture" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyModuleAccess_propertyId_module_key" ON "PropertyModuleAccess"("propertyId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionType_propertyId_code_key" ON "ExcursionType"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionDeparture_excursionTypeId_departureDate_departureTime_key" ON "ExcursionDeparture"("excursionTypeId", "departureDate", "departureTime");

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionBooking_folioLineItemId_key" ON "ExcursionBooking"("folioLineItemId");

-- CreateIndex
CREATE INDEX "ExcursionBooking_departureId_idx" ON "ExcursionBooking"("departureId");

