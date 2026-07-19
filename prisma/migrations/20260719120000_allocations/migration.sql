-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "chargeCodeId" TEXT NOT NULL,
    "postingRhythm" TEXT NOT NULL DEFAULT 'EVERY_NIGHT',
    "mode" TEXT NOT NULL DEFAULT 'ADD_TO_RATE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Allocation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Allocation_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AllocationRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "allocationId" TEXT NOT NULL,
    "adultPrice" REAL NOT NULL DEFAULT 0,
    "childPrice" REAL NOT NULL DEFAULT 0,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    CONSTRAINT "AllocationRate_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RatePlanAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ratePlanId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RatePlanAllocation_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RatePlanAllocation_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealPlanAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mealPlanId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MealPlanAllocation_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPlanAllocation_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReservationAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "overrideAdultPrice" REAL,
    "overrideChildPrice" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReservationAllocation_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_propertyId_code_key" ON "Allocation"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlanAllocation_ratePlanId_allocationId_key" ON "RatePlanAllocation"("ratePlanId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanAllocation_mealPlanId_allocationId_key" ON "MealPlanAllocation"("mealPlanId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationAllocation_reservationId_allocationId_key" ON "ReservationAllocation"("reservationId", "allocationId");

