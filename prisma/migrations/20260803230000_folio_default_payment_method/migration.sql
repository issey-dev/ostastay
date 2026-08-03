-- Per-folio default payment method — the seam that replaces the Folio Panel's
-- "Settlement: Direct / City Ledger" toggle (owner rule, 2026-08-03).
--
-- The toggle asked the desk to declare, up front, how a stay WOULD be settled, and
-- nothing reconciled that declaration against what was actually collected. Settlement is
-- now a consequence of the payment: paying with a CITY_LEDGER-type method is what
-- transfers the bill to an account, and this column simply pre-selects the method the
-- Post Payment form opens on, so that choice is one click at a busy desk.
--
-- Nullable and unset by default: a folio with no default behaves exactly as before, with
-- the cashier picking a method every time. Nothing is backfilled.
ALTER TABLE "Folio" ADD COLUMN "defaultPaymentMethodId" TEXT;

-- Postgres does not index a foreign key automatically (see the 2026-08-03
-- index_foreign_keys migration for the full reasoning). Added here rather than left for
-- a later sweep.
CREATE INDEX "Folio_defaultPaymentMethodId_idx" ON "Folio"("defaultPaymentMethodId");

-- ON DELETE SET NULL, not CASCADE: retiring a payment method must never delete the
-- folios that happened to prefer it. They simply lose the pre-selection.
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_defaultPaymentMethodId_fkey"
  FOREIGN KEY ("defaultPaymentMethodId") REFERENCES "PaymentMethod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
