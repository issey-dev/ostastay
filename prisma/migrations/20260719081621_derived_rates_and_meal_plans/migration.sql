-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "MealPlan_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoomTypeMealPlanRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomTypeId" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    CONSTRAINT "RoomTypeMealPlanRate_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomTypeMealPlanRate_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RatePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isNegotiated" BOOLEAN NOT NULL DEFAULT false,
    "parentRatePlanId" TEXT,
    "derivedAdjustmentType" TEXT,
    "derivedAdjustmentValue" REAL,
    CONSTRAINT "RatePlan_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RatePlan_parentRatePlanId_fkey" FOREIGN KEY ("parentRatePlanId") REFERENCES "RatePlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RatePlan" ("code", "description", "id", "isNegotiated", "name", "priority", "propertyId") SELECT "code", "description", "id", "isNegotiated", "name", "priority", "propertyId" FROM "RatePlan";
DROP TABLE "RatePlan";
ALTER TABLE "new_RatePlan" RENAME TO "RatePlan";
CREATE UNIQUE INDEX "RatePlan_propertyId_code_key" ON "RatePlan"("propertyId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MealPlan_propertyId_code_key" ON "MealPlan"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RoomTypeMealPlanRate_roomTypeId_mealPlanId_key" ON "RoomTypeMealPlanRate"("roomTypeId", "mealPlanId");

-- DataMigration: seed BB/HB/FB/AI meal plans for every existing property so the
-- Controls > Revenue > Meal Plans list isn't empty after this upgrade (matches the
-- 4 non-"Room Only" options the old hardcoded RatePlan.mealPlan/Reservation.mealPlan
-- dropdowns offered). "Room Only"/NONE is intentionally not seeded — no MealPlan row
-- for it means no surcharge lookup at all, which is exactly correct for a meal plan
-- with zero incremental cost.
INSERT INTO "MealPlan" ("id", "propertyId", "code", "name", "isActive")
SELECT lower(hex(randomblob(16))), "id", 'BB', 'Bed & Breakfast', 1 FROM "Property";

INSERT INTO "MealPlan" ("id", "propertyId", "code", "name", "isActive")
SELECT lower(hex(randomblob(16))), "id", 'HB', 'Half Board', 1 FROM "Property";

INSERT INTO "MealPlan" ("id", "propertyId", "code", "name", "isActive")
SELECT lower(hex(randomblob(16))), "id", 'FB', 'Full Board', 1 FROM "Property";

INSERT INTO "MealPlan" ("id", "propertyId", "code", "name", "isActive")
SELECT lower(hex(randomblob(16))), "id", 'AI', 'All Inclusive', 1 FROM "Property";
