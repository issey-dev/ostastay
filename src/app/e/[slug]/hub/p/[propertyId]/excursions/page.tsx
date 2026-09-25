import { propertyPage } from "@/lib/hub-page"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ExcursionsManager } from "@/components/controls/excursions-manager"

export default async function HubPropertyExcursionsPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "excursions")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <ExcursionsManager
        propertyId={property.id}
        title="Excursions"
        description="Activities this property sells to guests from Front Office — catalogue, pricing and recurring schedules. Copying brings excursions with their prices and schedules — never departures or bookings."
        copyAction={canEdit("create") && <CopyFromPropertyButton propertyId={property.id} section="excursions" title="excursions" />}
      />
    </div>
  )
}
