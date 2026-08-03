-- Per-connection override of the booking poll's lookback window (null = built-in 48h
-- default). The window is the outage self-heal horizon: idempotent ingestion makes the
-- overlap free, so widening it only costs Beds24 response size. Added alongside the
-- one-off deep-resync action for catch-ups beyond the routine window.
ALTER TABLE "ChannelConnection" ADD COLUMN "pollLookbackHours" INTEGER;
