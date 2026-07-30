-- Hub-wide module outlet links (owner ruling 2026-07-30): Spa and Excursions each post
-- through ONE outlet shared across every property in the enterprise, and posting from
-- either module is refused while its link is null. The per-property links on
-- SpaSettings/ExcursionSettings move up to EnterpriseSettings; any existing link is
-- carried over (first non-null per enterprise wins).

ALTER TABLE "EnterpriseSettings" ADD COLUMN "spaOutletId" TEXT REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "excursionOutletId" TEXT REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "EnterpriseSettings" SET "spaOutletId" = (
  SELECT ss."outletId" FROM "SpaSettings" ss
  JOIN "Property" p ON p."id" = ss."propertyId"
  WHERE p."enterpriseId" = "EnterpriseSettings"."enterpriseId" AND ss."outletId" IS NOT NULL
  LIMIT 1
) WHERE "spaOutletId" IS NULL;

UPDATE "EnterpriseSettings" SET "excursionOutletId" = (
  SELECT es."outletId" FROM "ExcursionSettings" es
  JOIN "Property" p ON p."id" = es."propertyId"
  WHERE p."enterpriseId" = "EnterpriseSettings"."enterpriseId" AND es."outletId" IS NOT NULL
  LIMIT 1
) WHERE "excursionOutletId" IS NULL;

-- SpaSettings loses outletId. SQLite can't DROP a column carrying a FK — rebuild.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpaSettings" (
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
INSERT INTO "new_SpaSettings" (
    "propertyId", "defaultOpeningTime", "defaultClosingTime", "slotIntervalMinutes",
    "defaultPreparationBufferMinutes", "defaultCleanupBufferMinutes", "allowTentativeAppointments",
    "tentativeHoldMinutes", "requireTherapistAtBooking", "requireRoomAtBooking", "allowAutoAssignment",
    "chargeTiming", "cancellationCutoffHours", "lateCancellationChargeType", "lateCancellationChargeValue",
    "noShowChargeType", "noShowChargeValue", "noShowGraceMinutes", "requireCancellationReason",
    "requireRescheduleReason", "updatedAt"
)
SELECT
    "propertyId", "defaultOpeningTime", "defaultClosingTime", "slotIntervalMinutes",
    "defaultPreparationBufferMinutes", "defaultCleanupBufferMinutes", "allowTentativeAppointments",
    "tentativeHoldMinutes", "requireTherapistAtBooking", "requireRoomAtBooking", "allowAutoAssignment",
    "chargeTiming", "cancellationCutoffHours", "lateCancellationChargeType", "lateCancellationChargeValue",
    "noShowChargeType", "noShowChargeValue", "noShowGraceMinutes", "requireCancellationReason",
    "requireRescheduleReason", "updatedAt"
FROM "SpaSettings";
DROP TABLE "SpaSettings";
ALTER TABLE "new_SpaSettings" RENAME TO "SpaSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- ExcursionSettings held nothing but the moved link — gone entirely.
DROP TABLE "ExcursionSettings";
