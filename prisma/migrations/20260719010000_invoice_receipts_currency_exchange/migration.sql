-- AlterTable
ALTER TABLE "EnterpriseSettings" ADD COLUMN "invoicePaymentAccountName" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "invoicePaymentAccountNumber" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "invoicePaymentBankInfo" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "invoicePaymentIban" TEXT;

-- AlterTable
ALTER TABLE "Folio" ADD COLUMN "proformaInvoiceNumber" TEXT;
ALTER TABLE "Folio" ADD COLUMN "taxInvoiceNumber" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "receiptNumber" TEXT;

-- CreateTable
CREATE TABLE "CurrencyExchange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "guestName" TEXT,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "amountFrom" REAL NOT NULL,
    "amountTo" REAL NOT NULL,
    "receiptNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    CONSTRAINT "CurrencyExchange_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CurrencyExchange_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CurrencyExchange_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

