-- Booking API Phase 1 (.agents/docs/BOOKING_API_ADDONS_PLAN.md): one key for rooms,
-- excursions and spa, and what each property sells online for the two add-ons.
--
-- WebsiteApiKey.scopes: every EXISTING key gets ['ROOMS'] from the column default, so a
-- live brand website keeps exactly the access it has today and gains nothing new until
-- an administrator ticks Excursions or Spa on its key.
--
-- ExcursionType / SpaTreatment.publishOnline default FALSE: nothing is sold online until
-- someone chooses it in the Hub.

-- AlterTable
ALTER TABLE "ExcursionType" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "inclusions" TEXT,
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publishOnline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SpaTreatment" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "inclusions" TEXT,
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publishOnline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WebsiteApiKey" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['ROOMS']::TEXT[];

-- CreateTable
CREATE TABLE "ActivityOnlineSettings" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "holdMinutes" INTEGER NOT NULL DEFAULT 10,
    "leadHours" INTEGER NOT NULL DEFAULT 2,
    "maxPartySize" INTEGER,
    "offerGenderPreference" BOOLEAN NOT NULL DEFAULT true,
    "onlinePaymentMethodId" TEXT,
    "deskRemark" TEXT,
    "policies" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityOnlineSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityOnlineSettings_onlinePaymentMethodId_idx" ON "ActivityOnlineSettings"("onlinePaymentMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityOnlineSettings_propertyId_module_key" ON "ActivityOnlineSettings"("propertyId", "module");

-- AddForeignKey
ALTER TABLE "ActivityOnlineSettings" ADD CONSTRAINT "ActivityOnlineSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityOnlineSettings" ADD CONSTRAINT "ActivityOnlineSettings_onlinePaymentMethodId_fkey" FOREIGN KEY ("onlinePaymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

