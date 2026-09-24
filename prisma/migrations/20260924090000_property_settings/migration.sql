-- Hub Setup, Phase 1 (.agents/docs/HUB_SETUP_PLAN.md): each property gets its own document
-- content and booking-number format. Order matters — create, COPY, then drop — so no
-- enterprise loses what it had configured.

-- CreateTable
CREATE TABLE "PropertySettings" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "resConfirmPrefix" TEXT NOT NULL DEFAULT '',
    "resConfirmLength" INTEGER NOT NULL DEFAULT 6,
    "defaultFolioStyle" TEXT NOT NULL DEFAULT 'detailed',
    "invoiceHeaderText" TEXT,
    "invoiceFooterText" TEXT,
    "invoicePaymentTerms" TEXT,
    "invoicePaymentAccountName" TEXT,
    "invoicePaymentAccountNumber" TEXT,
    "invoicePaymentIban" TEXT,
    "invoicePaymentBankInfo" TEXT,
    "receiptFooterText" TEXT,
    "receiptTerms" TEXT,
    "statementFooterText" TEXT,
    "statementTerms" TEXT,
    "confirmationLetterMessage" TEXT,
    "registrationCardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "registrationCardMessage" TEXT,
    "registrationCardTerms" TEXT,
    "eRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eRegistrationExpiryHours" INTEGER NOT NULL DEFAULT 72,
    "eRegistrationMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertySettings_propertyId_key" ON "PropertySettings"("propertyId");

-- AddForeignKey
ALTER TABLE "PropertySettings" ADD CONSTRAINT "PropertySettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy: every property starts with its enterprise's current values (or the defaults when
-- the enterprise never saved any). From here on they diverge per property.
INSERT INTO "PropertySettings" (
    "id", "propertyId", "resConfirmPrefix", "resConfirmLength", "defaultFolioStyle",
    "invoiceHeaderText", "invoiceFooterText", "invoicePaymentTerms",
    "invoicePaymentAccountName", "invoicePaymentAccountNumber", "invoicePaymentIban", "invoicePaymentBankInfo",
    "receiptFooterText", "receiptTerms", "statementFooterText", "statementTerms",
    "confirmationLetterMessage",
    "registrationCardEnabled", "registrationCardMessage", "registrationCardTerms",
    "eRegistrationEnabled", "eRegistrationExpiryHours", "eRegistrationMessage",
    "updatedAt"
)
SELECT
    gen_random_uuid()::text, p."id",
    COALESCE(es."resConfirmPrefix", ''), COALESCE(es."resConfirmLength", 6), COALESCE(es."defaultFolioStyle", 'detailed'),
    es."invoiceHeaderText", es."invoiceFooterText", es."invoicePaymentTerms",
    es."invoicePaymentAccountName", es."invoicePaymentAccountNumber", es."invoicePaymentIban", es."invoicePaymentBankInfo",
    es."receiptFooterText", es."receiptTerms", es."statementFooterText", es."statementTerms",
    es."confirmationLetterMessage",
    COALESCE(es."registrationCardEnabled", true), es."registrationCardMessage", es."registrationCardTerms",
    COALESCE(es."eRegistrationEnabled", true), COALESCE(es."eRegistrationExpiryHours", 72), es."eRegistrationMessage",
    CURRENT_TIMESTAMP
FROM "Property" p
LEFT JOIN "EnterpriseSettings" es ON es."enterpriseId" = p."enterpriseId";

-- The booking-number format is purely per property now. (The document-content columns stay
-- on EnterpriseSettings for the INTERNAL enterprise's own license invoices — see schema.)
ALTER TABLE "EnterpriseSettings" DROP COLUMN "resConfirmLength",
DROP COLUMN "resConfirmPrefix";
