-- Per-pickup toggle: group pickups default to billing the block's master folio.
-- Additive, NOT NULL with default true so existing rows keep the default behavior.
ALTER TABLE "Reservation" ADD COLUMN "groupBillToMaster" BOOLEAN NOT NULL DEFAULT true;
