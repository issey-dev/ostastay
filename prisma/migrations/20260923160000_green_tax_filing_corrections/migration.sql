-- Green Tax registration corrections (Hub) — 2026-09-23.
--   EnterpriseSettings.greenTaxStayBasis — ACTUAL | STANDARD, how the 12-hour rule is measured.
--   GreenTaxFiling    — months submitted to MIRA; their numbers are locked.
--   GreenTaxCorrection — audit trail of every renumbering correction.
ALTER TABLE "EnterpriseSettings" ADD COLUMN "greenTaxStayBasis" TEXT NOT NULL DEFAULT 'ACTUAL';

CREATE TABLE "GreenTaxFiling" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "filedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filedById" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "GreenTaxFiling_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GreenTaxFiling_propertyId_year_month_key" ON "GreenTaxFiling"("propertyId", "year", "month");
ALTER TABLE "GreenTaxFiling" ADD CONSTRAINT "GreenTaxFiling_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GreenTaxCorrection" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "registrationNo" INTEGER NOT NULL,
    "guestName" TEXT,
    "confirmationNo" TEXT,
    "issue" TEXT,
    "reason" TEXT NOT NULL,
    "shiftFrom" INTEGER,
    "shiftTo" INTEGER,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GreenTaxCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GreenTaxCorrection_propertyId_year_idx" ON "GreenTaxCorrection"("propertyId", "year");
ALTER TABLE "GreenTaxCorrection" ADD CONSTRAINT "GreenTaxCorrection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
