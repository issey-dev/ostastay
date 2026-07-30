-- DropIndex
DROP INDEX "Payment_chargeCodeId_idx";

-- DropIndex
DROP INDEX "PaymentMethod_chargeCodeId_idx";

-- CreateTable
CREATE TABLE "ChannelBookingDefaults" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "linkId" TEXT NOT NULL,
    "ratePlanId" TEXT,
    "mealPlanCode" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelBookingDefaults_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ChannelPropertyLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelBookingDefaults_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBookingDefaults_linkId_key" ON "ChannelBookingDefaults"("linkId");
