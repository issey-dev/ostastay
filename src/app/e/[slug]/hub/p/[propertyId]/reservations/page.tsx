import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { BookingNumberFormatForm } from "@/components/hub/booking-number-format-form"
import { DropdownsManager, RESERVATION_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"

export default async function HubPropertyReservationsPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "reservations")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard title="Booking Number Format" description="How this property's confirmation numbers look. The running number itself is this property's Registration No sequence (Sequences).">
        <BookingNumberFormatForm propertyId={property.id} propertyCode={property.code} />
      </ControlsCard>
      <ControlsCard title="Reservation & Housekeeping Lists" description="The special requests, transport types and housekeeping requests this property offers.">
        <DropdownsManager categories={RESERVATION_LOV_CATEGORIES} propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
