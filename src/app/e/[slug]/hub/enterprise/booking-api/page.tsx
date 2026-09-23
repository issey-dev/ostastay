import { enterprisePage } from "@/lib/hub-page"
import { hasPermission } from "@/lib/scope"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { WebsiteApiKeys } from "@/components/hub/website-api-keys"

// Booking API keys (and each key's webhooks) — see .agents/docs/WEBSITE_API_PLAN.md,
// .agents/docs/BOOKING_API_ADDONS_PLAN.md and the public docs at /docs/api-integration.
//
// A key is an enterprise-level credential covering ONE property or ALL of them, so it is
// managed here. What each property's website shows and sells, and the bookings it made,
// are that property's own: Hub > the property > Online Booking (HUB_SETUP_PLAN.md, Phase 4).
export default async function HubBookingApiPage({ params }: { params: Promise<{ slug: string }> }) {
  const { ctx, item } = await enterprisePage(params, "booking-api")
  return (
    <div className="space-y-6">
      <HubPageHeader
        title={item.title}
        icon={item.icon}
        scope="enterprise"
        hint="Lets a property's own website show live availability and prices and take bookings straight into this system — rooms, and excursions and spa where you have them. Create a key per website, for one property or for all of them. What each property sells online is set under that property's Online Booking."
      />
      <WebsiteApiKeys
        canCreate={hasPermission(ctx, "INTEGRATIONS", "create")}
        canManage={hasPermission(ctx, "INTEGRATIONS", "update")}
        canRevoke={hasPermission(ctx, "INTEGRATIONS", "delete")}
      />
    </div>
  )
}
