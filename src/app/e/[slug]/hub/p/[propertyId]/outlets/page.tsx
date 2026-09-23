import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { OutletsManager } from "@/components/controls/outlets-manager"
import { FacilityAmenitiesManager } from "@/components/settings/facility-amenities-manager"

export default async function HubPropertyOutletsPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "outlets")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard title="Outlets" description="This property's restaurants, bars, spa and other points of sale — each curates its own set of charge codes and can override tax handling.">
        <OutletsManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Amenities" description="Facilities shown on this property's guest-facing profile (Pool, Gym, Spa, etc).">
        <FacilityAmenitiesManager propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
