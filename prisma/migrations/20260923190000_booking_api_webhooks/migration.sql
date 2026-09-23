-- Booking API Phase 5 (.agents/docs/BOOKING_API_ADDONS_PLAN.md): signed webhooks telling a
-- brand website when the property changes a booking it made. Endpoints belong to an API
-- key; deliveries are retried with backoff by the booking-api-webhooks job.

-- CreateTable
CREATE TABLE "ApiWebhookEndpoint" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "events" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiWebhookDelivery" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiWebhookEndpoint_keyId_idx" ON "ApiWebhookEndpoint"("keyId");

-- CreateIndex
CREATE INDEX "ApiWebhookEndpoint_enterpriseId_idx" ON "ApiWebhookEndpoint"("enterpriseId");

-- CreateIndex
CREATE INDEX "ApiWebhookDelivery_status_nextAttemptAt_idx" ON "ApiWebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ApiWebhookDelivery_endpointId_createdAt_idx" ON "ApiWebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiWebhookDelivery_enterpriseId_status_idx" ON "ApiWebhookDelivery"("enterpriseId", "status");

-- AddForeignKey
ALTER TABLE "ApiWebhookEndpoint" ADD CONSTRAINT "ApiWebhookEndpoint_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "WebsiteApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiWebhookDelivery" ADD CONSTRAINT "ApiWebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ApiWebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

