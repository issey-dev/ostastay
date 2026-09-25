import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { PropertyProfileManager } from "@/components/controls/property-profile-manager"
import { PropertyBannerColorManager } from "@/components/controls/property-banner-color-manager"
import { PropertyStationeryFontManager } from "@/components/controls/property-stationery-font-manager"
import { SessionTimeoutManager } from "@/components/controls/session-timeout-manager"

export default async function HubPropertyGeneralPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "general")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard title="Property information" description="This property's own profile — name, code, times, logo and contact details printed on its documents. Which enterprise it belongs to cannot be changed here.">
        <PropertyProfileManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Appearance" description="This property's accent colour and document font — used on its dashboard, its band here in the Hub, and every document it prints.">
        <PropertyBannerColorManager property={property} />
        <PropertyStationeryFontManager property={property} />
      </ControlsCard>
      <ControlsCard title="Idle sign-out" description="How long a terminal at this property may sit idle before the person using it is signed out.">
        <SessionTimeoutManager property={property} />
      </ControlsCard>
    </div>
  )
}
