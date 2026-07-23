-- CreateTable
CREATE TABLE "SpaTreatmentCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaTreatmentCategory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaTreatment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "preparationBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "cleanupBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "chargeCodeId" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 1,
    "pricingMode" TEXT NOT NULL DEFAULT 'PER_PERSON',
    "allowWalkIn" BOOLEAN NOT NULL DEFAULT true,
    "allowInHouseGuest" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaTreatment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaTreatment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SpaTreatmentCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpaTreatment_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaTreatmentRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treatmentId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaTreatmentRate_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaTherapist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "displayName" TEXT NOT NULL,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bookable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaTherapist_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaTherapistTreatment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "therapistId" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "qualified" BOOLEAN NOT NULL DEFAULT true,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "customDurationMinutes" INTEGER,
    "notes" TEXT,
    CONSTRAINT "SpaTherapistTreatment_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaTherapistTreatment_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "roomType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bookable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaRoom_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaTreatmentRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treatmentId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "SpaTreatmentRoom_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaTreatmentRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaTherapistSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "therapistId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "SpaTherapistSchedule_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaTherapistAvailabilityException" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "therapistId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "exceptionType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpaTherapistAvailabilityException_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaRoomAvailabilityException" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "exceptionType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpaRoomAvailabilityException_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaSettings" (
    "propertyId" TEXT NOT NULL PRIMARY KEY,
    "defaultOpeningTime" TEXT NOT NULL DEFAULT '09:00',
    "defaultClosingTime" TEXT NOT NULL DEFAULT '18:00',
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "defaultPreparationBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "defaultCleanupBufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "allowTentativeAppointments" BOOLEAN NOT NULL DEFAULT true,
    "tentativeHoldMinutes" INTEGER NOT NULL DEFAULT 20,
    "requireTherapistAtBooking" BOOLEAN NOT NULL DEFAULT true,
    "requireRoomAtBooking" BOOLEAN NOT NULL DEFAULT true,
    "allowAutoAssignment" BOOLEAN NOT NULL DEFAULT true,
    "chargeTiming" TEXT NOT NULL DEFAULT 'AT_BOOKING',
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 4,
    "lateCancellationChargeType" TEXT NOT NULL DEFAULT 'NONE',
    "lateCancellationChargeValue" REAL,
    "noShowChargeType" TEXT NOT NULL DEFAULT 'NONE',
    "noShowChargeValue" REAL,
    "noShowGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "requireCancellationReason" BOOLEAN NOT NULL DEFAULT true,
    "requireRescheduleReason" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaAppointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "treatmentNameSnapshot" TEXT NOT NULL,
    "durationMinutesSnapshot" INTEGER NOT NULL,
    "preparationBufferMinutesSnapshot" INTEGER NOT NULL,
    "cleanupBufferMinutesSnapshot" INTEGER NOT NULL,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "priceSnapshot" REAL NOT NULL,
    "currencySnapshot" TEXT NOT NULL,
    "appointmentDate" DATETIME NOT NULL,
    "startTime" TEXT NOT NULL,
    "treatmentEndTime" TEXT NOT NULL,
    "blockedUntilTime" TEXT NOT NULL,
    "roomId" TEXT,
    "appointmentStatus" TEXT NOT NULL DEFAULT 'TENTATIVE',
    "paymentStatus" TEXT NOT NULL DEFAULT 'NOT_POSTED',
    "source" TEXT NOT NULL DEFAULT 'FRONT_DESK',
    "folioId" TEXT,
    "folioLineItemId" TEXT,
    "refundPaymentId" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "cancellationReasonCode" TEXT,
    "cancellationNotes" TEXT,
    "bookedByUserId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "completedByUserId" TEXT,
    "checkedInAt" DATETIME,
    "treatmentStartedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "noShowAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaAppointment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointment_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointment_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointment_folioLineItemId_fkey" FOREIGN KEY ("folioLineItemId") REFERENCES "FolioLineItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointment_refundPaymentId_fkey" FOREIGN KEY ("refundPaymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaAppointmentParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "participantIndex" INTEGER NOT NULL DEFAULT 1,
    "reservationId" TEXT,
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "therapistId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaAppointmentParticipant_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "SpaAppointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointmentParticipant_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointmentParticipant_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaTreatmentCategory_propertyId_name_key" ON "SpaTreatmentCategory"("propertyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SpaTherapistTreatment_therapistId_treatmentId_key" ON "SpaTherapistTreatment"("therapistId", "treatmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaTreatmentRoom_treatmentId_roomId_key" ON "SpaTreatmentRoom"("treatmentId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaAppointment_folioLineItemId_key" ON "SpaAppointment"("folioLineItemId");

-- CreateIndex
CREATE INDEX "SpaAppointment_propertyId_appointmentDate_idx" ON "SpaAppointment"("propertyId", "appointmentDate");

-- CreateIndex
CREATE INDEX "SpaAppointment_roomId_appointmentDate_idx" ON "SpaAppointment"("roomId", "appointmentDate");

-- CreateIndex
CREATE INDEX "SpaAppointmentParticipant_therapistId_idx" ON "SpaAppointmentParticipant"("therapistId");

-- CreateIndex
CREATE INDEX "SpaAppointmentParticipant_appointmentId_idx" ON "SpaAppointmentParticipant"("appointmentId");

