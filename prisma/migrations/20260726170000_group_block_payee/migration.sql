-- Link a group block to a credit-account Travel Agent / Corporate profile so its master
-- bill settles to City Ledger (a debtor invoice on close). Additive, nullable column.
ALTER TABLE "GroupBlock" ADD COLUMN "payeeProfileId" TEXT;
