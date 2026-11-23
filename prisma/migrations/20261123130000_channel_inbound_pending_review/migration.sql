-- Channel cancellations/changes after conversion that wait for the desk (DECISIONS.md, 2026-11-23).
ALTER TABLE "ChannelInboundBooking" ADD COLUMN "pendingAction" TEXT;
ALTER TABLE "ChannelInboundBooking" ADD COLUMN "pendingReason" TEXT;
ALTER TABLE "ChannelInboundBooking" ADD COLUMN "pendingSince" TIMESTAMP(3);
CREATE INDEX "ChannelInboundBooking_enterpriseId_pendingAction_idx" ON "ChannelInboundBooking"("enterpriseId", "pendingAction");
