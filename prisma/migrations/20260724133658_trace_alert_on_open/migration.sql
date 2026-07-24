-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReservationTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "traceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionDate" DATETIME,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "alertOnOpen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReservationTrace_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReservationTrace" ("actionDate", "createdAt", "description", "id", "isResolved", "reservationId", "traceType", "updatedAt") SELECT "actionDate", "createdAt", "description", "id", "isResolved", "reservationId", "traceType", "updatedAt" FROM "ReservationTrace";
DROP TABLE "ReservationTrace";
ALTER TABLE "new_ReservationTrace" RENAME TO "ReservationTrace";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
