-- A refund can reverse one specific earlier payment, with the reason the desk gave.
ALTER TABLE "Payment" ADD COLUMN "refundOfPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "refundReason" TEXT;
CREATE INDEX "Payment_refundOfPaymentId_idx" ON "Payment"("refundOfPaymentId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundOfPaymentId_fkey"
  FOREIGN KEY ("refundOfPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
