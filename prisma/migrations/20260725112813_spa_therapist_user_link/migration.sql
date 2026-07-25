/*
  Warnings:

  - You are about to drop the column `employeeId` on the `SpaTherapist` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpaTherapist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bookable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaTherapist_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaTherapist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SpaTherapist" ("bookable", "createdAt", "displayName", "displayOrder", "email", "gender", "id", "isActive", "phone", "propertyId", "updatedAt") SELECT "bookable", "createdAt", "displayName", "displayOrder", "email", "gender", "id", "isActive", "phone", "propertyId", "updatedAt" FROM "SpaTherapist";
DROP TABLE "SpaTherapist";
ALTER TABLE "new_SpaTherapist" RENAME TO "SpaTherapist";
CREATE UNIQUE INDEX "SpaTherapist_userId_key" ON "SpaTherapist"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
