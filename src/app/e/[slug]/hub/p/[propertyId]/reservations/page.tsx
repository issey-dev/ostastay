import { propertyPage } from "@/lib/hub-page"
import { prisma } from "@/lib/db"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ControlsCard } from "@/components/controls/controls-card"
import { BookingNumberFormatForm } from "@/components/hub/booking-number-format-form"
import { DropdownsManager, RESERVATION_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"
import { BookingMarkersEditor } from "@/components/hub/booking-markers-editor"
import { AgentPortalSettingsForm } from "@/components/hub/agent-portal-settings-form"

export default async function HubPropertyReservationsPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "reservations")
  // The booking-number preview shows the number the NEXT booking will actually get: the
  // REGISTRATION_NO counter + 1 (allocateSequenceNumber increments, then uses the value).
  const registrationSeq = await prisma.propertySequence.findUnique({
    where: { propertyId_sequenceType: { propertyId: property.id, sequenceType: "REGISTRATION_NO" } },
    select: { currentValue: true },
  })
  const nextNumber = (registrationSeq?.currentValue ?? 0) + 1
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <ControlsCard title="Booking number format" description="How this property's confirmation numbers look. The running number itself is this property's Registration No sequence (Sequences).">
        <BookingNumberFormatForm propertyId={property.id} propertyCode={property.code} nextNumber={nextNumber} />
      </ControlsCard>
      <ControlsCard
        title="Reservation & housekeeping lists"
        description="The special requests, transport types and housekeeping requests this property offers."
        action={canEdit("create") && (
          <CopyFromPropertyButton
            propertyId={property.id}
            section="lists"
            title="reservation and housekeeping lists"
            keyPrefixes={["SPECIAL_REQUEST:", "TRANSPORT_TYPE:", "HOUSEKEEPING_REQUEST:"]}
          />
        )}
      >
        <DropdownsManager categories={RESERVATION_LOV_CATEGORIES} propertyId={property.id} />
      </ControlsCard>
      <ControlsCard
        title="Agent portal"
        description="Whether sources can work with this property through the agent portal, and the rules for tentative bookings and what agents see."
      >
        <AgentPortalSettingsForm propertyId={property.id} canEdit={canEdit("update")} />
      </ControlsCard>
      <ControlsCard
        title="Booking markers"
        description="How bookings are marked on the Tape Chart and in the lists: the first rule a booking matches decides its icon and colour. A source with its own icon and colour (on its profile) shows that instead."
      >
        <BookingMarkersEditor propertyId={property.id} canEdit={canEdit("update")} />
      </ControlsCard>
    </div>
  )
}
