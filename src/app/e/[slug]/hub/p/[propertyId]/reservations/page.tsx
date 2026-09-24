import { propertyPage } from "@/lib/hub-page"
import { prisma } from "@/lib/db"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { BookingNumberFormatForm } from "@/components/hub/booking-number-format-form"
import { DropdownsManager, RESERVATION_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"

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
      <ControlsCard title="Booking Number Format" description="How this property's confirmation numbers look. The running number itself is this property's Registration No sequence (Sequences).">
        <BookingNumberFormatForm propertyId={property.id} propertyCode={property.code} nextNumber={nextNumber} />
      </ControlsCard>
      <ControlsCard
        title="Reservation & Housekeeping Lists"
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
    </div>
  )
}
