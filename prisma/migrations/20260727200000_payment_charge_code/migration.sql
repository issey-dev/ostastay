-- Every financial posting is linked to a charge code — a payment just as much as a
-- charge to the guest (owner rule, 2026-07-27). This supersedes the earlier
-- "payment types are Payment Methods, not charge codes" decision.
--
-- PaymentMethod.chargeCodeId  which code money taken by this method posts against
-- Payment.chargeCodeId        stamped at posting time, so re-pointing a method never
--                             rewrites settled history

ALTER TABLE "PaymentMethod" ADD COLUMN "chargeCodeId" TEXT REFERENCES "ChargeCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD COLUMN "chargeCodeId" TEXT REFERENCES "ChargeCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PaymentMethod_chargeCodeId_idx" ON "PaymentMethod"("chargeCodeId");
CREATE INDEX "Payment_chargeCodeId_idx" ON "Payment"("chargeCodeId");
