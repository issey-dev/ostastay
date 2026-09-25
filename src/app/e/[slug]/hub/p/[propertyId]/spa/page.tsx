import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ControlsCard } from "@/components/controls/controls-card"
import { SpaCatalogManager } from "@/components/controls/spa-manager"
import { SpaTherapistsManager } from "@/components/controls/spa-therapists-manager"
import { SpaRoomsManager } from "@/components/controls/spa-rooms-manager"
import { SpaSettingsForm } from "@/components/controls/spa-settings-form"

export default async function HubPropertySpaPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "spa")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <ControlsCard title="Treatment catalog" description="Categories, treatments and pricing this property sells from the Spa scheduler.">
        <SpaCatalogManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Therapists" description="This property's schedulable therapists — treatment qualifications, weekly working hours, and day-off/leave exceptions. A PMS login is optional.">
        <SpaTherapistsManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Treatment rooms" description="This property's rooms available for spa treatments, including couple-capable rooms and maintenance/cleaning closures.">
        <SpaRoomsManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Spa settings" description="Operating hours, booking defaults, charge timing, and cancellation/no-show policy for this property.">
        <SpaSettingsForm propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
