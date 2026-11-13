-- Agent Portal plan Phase 7: settlement mode per booking and the commission ledger.
ALTER TABLE "Reservation" ADD COLUMN "settlementMode" TEXT;

CREATE TABLE "AgentCommissionPayout" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentCommissionPayout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentCommissionPayout_propertyId_profileId_idx" ON "AgentCommissionPayout"("propertyId", "profileId");

CREATE TABLE "AgentCommission" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "folioId" TEXT,
    "ratePlanId" TEXT,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCRUED',
    "payoutId" TEXT,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentCommission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentCommission_propertyId_status_idx" ON "AgentCommission"("propertyId", "status");
CREATE INDEX "AgentCommission_profileId_status_idx" ON "AgentCommission"("profileId", "status");
CREATE INDEX "AgentCommission_reservationId_idx" ON "AgentCommission"("reservationId");
ALTER TABLE "AgentCommission" ADD CONSTRAINT "AgentCommission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "AgentCommissionPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
