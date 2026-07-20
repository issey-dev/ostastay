-- CreateTable
CREATE TABLE "RatePlanAgentAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ratePlanId" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RatePlanAgentAccess_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RatePlanAgentAccess_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile" ("upid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RatePlanAgentAccess_ratePlanId_upid_key" ON "RatePlanAgentAccess"("ratePlanId", "upid");
