import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ChannelConnectionStatus } from "@/components/hub/channel-connection-status"

// This property's channel-manager connection — read-only status and the health check. One
// connection per property; Uppsolut connects, disconnects and re-authorizes it from the
// Osta console (.agents/docs/HUB_SETUP_PLAN.md, Phase 4; HUB_CHANNEL_MANAGER_PLAN.md).
export default async function HubPropertyChannelManagerPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "channel-manager")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" hint="The exchange between this property and the booking channels. Uppsolut sets the connection up; mapping, checks, inbound bookings and the exchange log are here." />
      <ChannelConnectionStatus propertyId={property.id} canManage={canEdit("update")} />
    </div>
  )
}
