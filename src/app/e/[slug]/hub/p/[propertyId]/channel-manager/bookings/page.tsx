import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { InboundBookingsManager } from "@/components/hub/inbound-bookings-manager"

// Bookings received through this property's channel-manager connection, with anything
// that needs attention flagged. See the note on ChannelInboundBooking in schema.prisma.
export default async function HubPropertyChannelBookingsPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "channel-bookings")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" hint="Bookings received from the booking channels for this property, with anything that needs attention flagged." />
      <InboundBookingsManager propertyId={property.id} canManage={canEdit("update")} />
    </div>
  )
}
