-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN "webhookToken" TEXT;

-- CreateTable
CREATE TABLE "ChannelInboundBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalBookingId" TEXT NOT NULL,
    "channelName" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "externalRoomId" TEXT,
    "roomTypeId" TEXT,
    "propertyId" TEXT,
    "guestFirstName" TEXT,
    "guestLastName" TEXT,
    "guestEmail" TEXT,
    "arrival" DATETIME,
    "departure" DATETIME,
    "adults" INTEGER,
    "children" INTEGER,
    "totalAmount" REAL,
    "currency" TEXT,
    "channelStatus" TEXT,
    "problem" TEXT,
    "isOverbooking" BOOLEAN NOT NULL DEFAULT false,
    "overbookingNote" TEXT,
    "acknowledgedAt" DATETIME,
    "acknowledgedById" TEXT,
    "rawPayload" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelInboundBooking_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelInboundBooking_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelInboundBooking_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChannelInboundBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChannelInboundBooking_enterpriseId_receivedAt_idx" ON "ChannelInboundBooking"("enterpriseId", "receivedAt");

-- CreateIndex
CREATE INDEX "ChannelInboundBooking_enterpriseId_isOverbooking_idx" ON "ChannelInboundBooking"("enterpriseId", "isOverbooking");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelInboundBooking_connectionId_externalBookingId_key" ON "ChannelInboundBooking"("connectionId", "externalBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_webhookToken_key" ON "ChannelConnection"("webhookToken");

