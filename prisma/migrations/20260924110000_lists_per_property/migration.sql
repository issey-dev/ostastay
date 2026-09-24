-- Hub Setup, Phase 3 (.agents/docs/HUB_SETUP_PLAN.md): the reservation, housekeeping,
-- transport and room-feature dropdown lists become per property. Guest-profile lists
-- (Gender, Title, Nationality, ID Type, Classification, VIP Level, Dietary, Preferences)
-- and Job Functions stay the enterprise's, because a guest profile and a user are shared
-- across the enterprise's properties.
--
-- Nothing points at a SystemCode row by id — every reference (RoomTypeFeature,
-- RoomFeature, ReservationSpecialRequest, ReservationTransport) stores the CODE — so each
-- property simply gets its own copy of the enterprise's list and existing records keep
-- resolving to the same label.

-- 1. The column, its foreign key and the lookup indexes. The old enterprise-wide unique
-- goes first: the copies below share their original's (enterpriseId, category, code).
DROP INDEX "SystemCode_enterpriseId_category_code_key";

ALTER TABLE "SystemCode" ADD COLUMN "propertyId" TEXT;

ALTER TABLE "SystemCode" ADD CONSTRAINT "SystemCode_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "SystemCode_enterpriseId_category_idx" ON "SystemCode"("enterpriseId", "category");
CREATE INDEX "SystemCode_propertyId_category_idx" ON "SystemCode"("propertyId", "category");

-- 2. Every property gets its own copy of its enterprise's property lists.
INSERT INTO "SystemCode" ("id", "enterpriseId", "propertyId", "category", "code", "value", "sortOrder", "isActive")
SELECT gen_random_uuid()::text, sc."enterpriseId", p."id", sc."category", sc."code", sc."value", sc."sortOrder", sc."isActive"
FROM "SystemCode" sc
JOIN "Property" p ON p."enterpriseId" = sc."enterpriseId"
WHERE sc."propertyId" IS NULL
  AND sc."category" IN ('HOUSEKEEPING_REQUEST', 'SPECIAL_REQUEST', 'TRANSPORT_TYPE', 'BED_TYPE', 'ROOM_VIEW', 'ROOM_AMENITY');

-- 3. ...and the enterprise-level originals of those lists go.
DELETE FROM "SystemCode"
WHERE "propertyId" IS NULL
  AND "category" IN ('HOUSEKEEPING_REQUEST', 'SPECIAL_REQUEST', 'TRANSPORT_TYPE', 'BED_TYPE', 'ROOM_VIEW', 'ROOM_AMENITY');

-- 4. A code is unique within its list, at whichever level the list lives. Two PARTIAL
-- unique indexes, because a plain UNIQUE treats NULL propertyIds as distinct (and Prisma
-- cannot express a partial index — see the NOTE on model SystemCode).
CREATE UNIQUE INDEX "SystemCode_enterprise_code_key"
  ON "SystemCode"("enterpriseId", "category", "code") WHERE "propertyId" IS NULL;

CREATE UNIQUE INDEX "SystemCode_property_code_key"
  ON "SystemCode"("propertyId", "category", "code") WHERE "propertyId" IS NOT NULL;
