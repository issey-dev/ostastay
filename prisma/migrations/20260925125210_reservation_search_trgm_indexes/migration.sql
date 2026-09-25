-- The reservations search box is a case-insensitive "contains" across guest name, company,
-- phone/email, confirmation no., channel ref and room number (ILIKE '%x%'). Trigram GIN
-- indexes let Postgres answer that from an index instead of scanning every row, so a search
-- across all statuses stays cheap as the history grows. pg_trgm is a trusted extension
-- (PG13+): the database owner can create it without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Profile_firstName_trgm_idx" ON "Profile" USING GIN ("firstName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Profile_lastName_trgm_idx" ON "Profile" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Profile_companyName_trgm_idx" ON "Profile" USING GIN ("companyName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ProfileCommunication_value_trgm_idx" ON "ProfileCommunication" USING GIN ("value" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Reservation_propertyId_checkInDate_idx" ON "Reservation"("propertyId", "checkInDate");

-- CreateIndex
CREATE INDEX "Reservation_confirmationNo_trgm_idx" ON "Reservation" USING GIN ("confirmationNo" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Reservation_externalRef_trgm_idx" ON "Reservation" USING GIN ("externalRef" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Room_roomNumber_trgm_idx" ON "Room" USING GIN ("roomNumber" gin_trgm_ops);
