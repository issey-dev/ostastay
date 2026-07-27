-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'BEDS24',
    "name" TEXT NOT NULL,
    "refreshToken" TEXT,
    "lastTokenRefreshAt" DATETIME,
    "accessToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "lastHealthCheckAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelConnection_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_enterpriseId_name_key" ON "ChannelConnection"("enterpriseId", "name");

