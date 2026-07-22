-- AlterTable
ALTER TABLE "Property" ADD COLUMN "eodSessionsInvalidAt" DATETIME;

-- CreateTable
CREATE TABLE "EodRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "businessDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedByUserId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departuresAt" DATETIME,
    "cashierAt" DATETIME,
    "postAt" DATETIME,
    "reportsAt" DATETIME,
    "finalizedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "EodRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EodRun_propertyId_businessDate_key" ON "EodRun"("propertyId", "businessDate");

