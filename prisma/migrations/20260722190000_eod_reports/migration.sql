-- CreateTable
CREATE TABLE "EodReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "businessDate" DATETIME NOT NULL,
    "reportType" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EodReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EodReport_propertyId_businessDate_reportType_key" ON "EodReport"("propertyId", "businessDate", "reportType");
