-- CreateTable
CREATE TABLE "SpaGuestTherapistPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaGuestTherapistPreference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("upid") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaGuestTherapistPreference_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaGuestTherapistPreference_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpaAppointmentParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "participantIndex" INTEGER NOT NULL DEFAULT 1,
    "reservationId" TEXT,
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "therapistId" TEXT,
    "requestedTherapistId" TEXT,
    "requestedGender" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaAppointmentParticipant_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "SpaAppointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointmentParticipant_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointmentParticipant_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpaAppointmentParticipant_requestedTherapistId_fkey" FOREIGN KEY ("requestedTherapistId") REFERENCES "SpaTherapist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SpaAppointmentParticipant" ("appointmentId", "createdAt", "id", "notes", "participantIndex", "reservationId", "therapistId", "updatedAt", "walkInGuestContact", "walkInGuestName") SELECT "appointmentId", "createdAt", "id", "notes", "participantIndex", "reservationId", "therapistId", "updatedAt", "walkInGuestContact", "walkInGuestName" FROM "SpaAppointmentParticipant";
DROP TABLE "SpaAppointmentParticipant";
ALTER TABLE "new_SpaAppointmentParticipant" RENAME TO "SpaAppointmentParticipant";
CREATE INDEX "SpaAppointmentParticipant_therapistId_idx" ON "SpaAppointmentParticipant"("therapistId");
CREATE INDEX "SpaAppointmentParticipant_appointmentId_idx" ON "SpaAppointmentParticipant"("appointmentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SpaGuestTherapistPreference_profileId_propertyId_key" ON "SpaGuestTherapistPreference"("profileId", "propertyId");

