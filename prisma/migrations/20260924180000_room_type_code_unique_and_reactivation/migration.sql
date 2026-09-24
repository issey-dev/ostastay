-- Room types: a code is unique within its property, and re-activating a room type restores
-- the rooms its deactivation took out of service. See model RoomType / Room.

-- Guard for existing data: if a property somehow already holds two room types with the
-- same code, keep the first (by id) and suffix the others ("-2", "-3", ...) so the unique
-- index below can be created. The dev database had none when this was written.
WITH dupes AS (
  SELECT id, row_number() OVER (PARTITION BY "propertyId", code ORDER BY id) AS rn
  FROM "RoomType"
)
UPDATE "RoomType" r
SET code = r.code || '-' || dupes.rn
FROM dupes
WHERE r.id = dupes.id AND dupes.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "RoomType_propertyId_code_key" ON "RoomType"("propertyId", "code");

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "statusBeforeTypeDeactivation" TEXT;
