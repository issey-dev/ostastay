-- CreateTable
CREATE TABLE "ChannelPropertyLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "externalPropertyId" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelPropertyLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelPropertyLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelRoomTypeMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "linkId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "externalRoomId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ChannelRoomTypeMap_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ChannelPropertyLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelRoomTypeMap_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelRatePlanMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "linkId" TEXT NOT NULL,
    "ratePlanId" TEXT NOT NULL,
    "externalRateId" TEXT NOT NULL,
    CONSTRAINT "ChannelRatePlanMap_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ChannelPropertyLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelRatePlanMap_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPropertyLink_propertyId_key" ON "ChannelPropertyLink"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPropertyLink_connectionId_externalPropertyId_key" ON "ChannelPropertyLink"("connectionId", "externalPropertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomTypeMap_roomTypeId_key" ON "ChannelRoomTypeMap"("roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomTypeMap_linkId_externalRoomId_key" ON "ChannelRoomTypeMap"("linkId", "externalRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRatePlanMap_ratePlanId_key" ON "ChannelRatePlanMap"("ratePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRatePlanMap_linkId_externalRateId_key" ON "ChannelRatePlanMap"("linkId", "externalRateId");

