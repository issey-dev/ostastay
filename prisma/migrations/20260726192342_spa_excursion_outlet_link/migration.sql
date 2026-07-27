-- CreateTable
CREATE TABLE "ExcursionSettings" (
    "propertyId" TEXT NOT NULL PRIMARY KEY,
    "outletId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExcursionSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExcursionSettings_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpaSettings" (
    "propertyId" TEXT NOT NULL PRIMARY KEY,
    "outletId" TEXT,
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
    CONSTRAINT "SpaSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaSettings_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SpaSettings" ("allowAutoAssignment", "allowTentativeAppointments", "cancellationCutoffHours", "chargeTiming", "defaultCleanupBufferMinutes", "defaultClosingTime", "defaultOpeningTime", "defaultPreparationBufferMinutes", "lateCancellationChargeType", "lateCancellationChargeValue", "noShowChargeType", "noShowChargeValue", "noShowGraceMinutes", "propertyId", "requireCancellationReason", "requireRescheduleReason", "requireRoomAtBooking", "requireTherapistAtBooking", "slotIntervalMinutes", "tentativeHoldMinutes", "updatedAt") SELECT "allowAutoAssignment", "allowTentativeAppointments", "cancellationCutoffHours", "chargeTiming", "defaultCleanupBufferMinutes", "defaultClosingTime", "defaultOpeningTime", "defaultPreparationBufferMinutes", "lateCancellationChargeType", "lateCancellationChargeValue", "noShowChargeType", "noShowChargeValue", "noShowGraceMinutes", "propertyId", "requireCancellationReason", "requireRescheduleReason", "requireRoomAtBooking", "requireTherapistAtBooking", "slotIntervalMinutes", "tentativeHoldMinutes", "updatedAt" FROM "SpaSettings";
DROP TABLE "SpaSettings";
ALTER TABLE "new_SpaSettings" RENAME TO "SpaSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
