-- Agent Portal plan Phase 6: agent booking references, confirmation versions, change
-- requests and idempotent replays.
ALTER TABLE "Reservation" ADD COLUMN "agentRef" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "agentConfirmationVersion" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Reservation_agentRef_key" ON "Reservation"("agentRef");

CREATE TABLE "AgentChangeRequest" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentChangeRequest_reservationId_idx" ON "AgentChangeRequest"("reservationId");
CREATE INDEX "AgentChangeRequest_status_idx" ON "AgentChangeRequest"("status");
ALTER TABLE "AgentChangeRequest" ADD CONSTRAINT "AgentChangeRequest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentIdempotency" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentIdempotency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentIdempotency_keyId_idempotencyKey_key" ON "AgentIdempotency"("keyId", "idempotencyKey");
