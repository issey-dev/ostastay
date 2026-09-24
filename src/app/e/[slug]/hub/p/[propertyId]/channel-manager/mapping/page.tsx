import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { MappingManager } from "@/components/hub/mapping-manager"

// This property's channel-manager mapping: sharing on/off, room types, rate plans,
// availability checks and resyncs, and inbound-booking defaults.
export default async function HubPropertyChannelMappingPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "channel-mapping")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" hint="Map this property's room types and rates to the channel manager's, check and resend availability and prices, and choose the defaults for inbound bookings." />
      <MappingManager propertyId={property.id} canManage={canEdit("update")} />
    </div>
  )
}
