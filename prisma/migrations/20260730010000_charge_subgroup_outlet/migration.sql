-- Outlet-wise charge subgroups (owner ruling 2026-07-30, part of the numeric
-- transaction-code standard): an F&B/Spa/Excursion outlet owns its own nnRV subgroup.
-- SetNull so deleting an outlet keeps the subgroup and its posted history intact.
ALTER TABLE "ChargeSubgroup" ADD COLUMN "outletId" TEXT REFERENCES "Outlet" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ChargeSubgroup_outletId_idx" ON "ChargeSubgroup"("outletId");
