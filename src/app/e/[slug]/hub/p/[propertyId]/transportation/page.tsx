import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { TransportSetup } from "@/components/hub/transport/transport-setup"

// Hub › property › Transportation (.agents/docs/TRANSPORTATION_PLAN.md): the module switch
// and this property's transfer catalogue. Configuration only — bookings, departures and the
// daily board are operations, on the property dashboard (Transportation).
export default async function HubPropertyTransportationPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "transportation")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <TransportSetup
        propertyId={property.id}
        perms={{ create: canEdit("create"), update: canEdit("update"), delete: canEdit("delete") }}
      />
    </div>
  )
}
