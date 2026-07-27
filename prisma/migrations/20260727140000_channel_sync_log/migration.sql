-- CreateTable
CREATE TABLE "ChannelSyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "connectionId" TEXT,
    "connectionName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "endpoint" TEXT,
    "ok" BOOLEAN NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "requestSummary" TEXT,
    "responseSummary" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelSyncLog_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChannelSyncLog_enterpriseId_createdAt_idx" ON "ChannelSyncLog"("enterpriseId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_connectionId_createdAt_idx" ON "ChannelSyncLog"("connectionId", "createdAt");

