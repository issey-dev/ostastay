-- AlterTable
ALTER TABLE "EnterpriseSettings" ADD COLUMN "receiptFooterText" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "receiptTerms" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "statementFooterText" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "statementTerms" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN "address" TEXT;
ALTER TABLE "Property" ADD COLUMN "stationeryFont" TEXT DEFAULT 'Geist';
