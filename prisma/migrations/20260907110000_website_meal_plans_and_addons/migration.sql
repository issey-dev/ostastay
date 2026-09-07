-- Website API: let a guest choose their meal plan and tick optional paid extras.
--
-- Both switches default to FALSE, so no existing site starts offering anything it was not
-- offering yesterday. The add-on catalogue needs no table of its own: it is the property's
-- active allocations already marked `sellSeparate`, which is the owner-set flag that means
-- "can be attached to a reservation on its own" and is what the desk's Add-ons picker
-- offers. This only decides whether that same list is exposed publicly.

-- AlterTable
ALTER TABLE "WebsitePropertySettings" ADD COLUMN "offerMealPlans" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WebsitePropertySettings" ADD COLUMN "offerAddOns" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: record what the guest actually chose, so a disputed folio traces to the request.
ALTER TABLE "WebsiteBooking" ADD COLUMN "mealPlanCode" TEXT;
ALTER TABLE "WebsiteBooking" ADD COLUMN "addOnIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
