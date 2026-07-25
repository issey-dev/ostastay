/*
  Warnings:

  - You are about to drop the `OutletAppointment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `appointmentCapPerSlot` on the `Outlet` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "OutletAppointment_outletId_startTime_idx";

-- AlterTable
ALTER TABLE "Folio" ADD COLUMN "closedBusinessDate" DATETIME;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "OutletAppointment";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Outlet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "outletType" TEXT NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "taxOverrideMode" TEXT NOT NULL DEFAULT 'NONE',
    "taxProfileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Outlet_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Outlet_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Outlet" ("createdAt", "description", "id", "isActive", "name", "outletType", "propertyId", "taxOverrideMode", "taxProfileId", "updatedAt") SELECT "createdAt", "description", "id", "isActive", "name", "outletType", "propertyId", "taxOverrideMode", "taxProfileId", "updatedAt" FROM "Outlet";
DROP TABLE "Outlet";
ALTER TABLE "new_Outlet" RENAME TO "Outlet";
CREATE UNIQUE INDEX "Outlet_propertyId_name_key" ON "Outlet"("propertyId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
