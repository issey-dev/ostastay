-- "Room type to charge" for ad-hoc room moves that keep the old rate.
-- A guest can physically occupy a room of one type while being priced as another:
-- chargeRoomTypeId pins the room type used for PriceCalendar lookup + base occupancy.
-- Null (the default and the normal case) = charge as the physical room type.
-- Nullable, additive column; no back-fill needed. No DB-level FK (Prisma resolves the
-- relation from the schema), matching the additive style used elsewhere.
ALTER TABLE "RoomAssignment" ADD COLUMN "chargeRoomTypeId" TEXT;
