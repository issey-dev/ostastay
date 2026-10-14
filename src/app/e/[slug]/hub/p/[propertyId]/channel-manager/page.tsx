import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ChannelConnectionStatus } from "@/components/hub/channel-connection-status"

// This property's channel-manager connection. One connection per property; the enterprise
// connects it to its own Beds24 account here (or Uppsolut does it through its own account
// from the Osta console for customers who opt for that). See
// .agents/docs/HUB_SETUP_PLAN.md (Phase 4) and HUB_CHANNEL_MANAGER_PLAN.md.
export default async function HubPropertyChannelManagerPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "channel-manager")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" hint="The exchange between this property and the booking channels: connect to your Beds24 account, then map rooms and rates, and watch inbound bookings and the exchange log." />
      <ChannelConnectionStatus
        propertyId={property.id}
        propertyName={property.name}
        canCreate={canEdit("create")}
        canUpdate={canEdit("update")}
        canDelete={canEdit("delete")}
      />
    </div>
  )
}
