-- CreateTable
CREATE TABLE "UserActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enterpriseId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "isSupport" BOOLEAN NOT NULL DEFAULT false,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "UserActivityLog_enterpriseId_createdAt_idx" ON "UserActivityLog"("enterpriseId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActivityLog_userId_createdAt_idx" ON "UserActivityLog"("userId", "createdAt");

