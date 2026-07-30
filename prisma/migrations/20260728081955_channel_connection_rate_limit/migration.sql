-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN "rateLimitObservedAt" DATETIME;
ALTER TABLE "ChannelConnection" ADD COLUMN "rateLimitPauseThreshold" INTEGER;
ALTER TABLE "ChannelConnection" ADD COLUMN "rateLimitRemaining" INTEGER;
ALTER TABLE "ChannelConnection" ADD COLUMN "rateLimitResetsAt" DATETIME;
ALTER TABLE "ChannelConnection" ADD COLUMN "rateLimitTotal" INTEGER;
