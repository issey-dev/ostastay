-- Scope GroupBlock.code uniqueness to (propertyId, code) instead of globally, so one
-- tenant can't detect or reserve another tenant's group codes. The old global constraint
-- guaranteed codes were unique everywhere, so no (propertyId, code) collisions can exist —
-- no data cleanup is needed, just swap the index.
DROP INDEX IF EXISTS "GroupBlock_code_key";

CREATE UNIQUE INDEX "GroupBlock_propertyId_code_key" ON "GroupBlock"("propertyId", "code");
