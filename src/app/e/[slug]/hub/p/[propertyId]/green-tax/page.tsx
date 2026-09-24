import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { GreenTaxRegister } from "@/components/hub/green-tax-register"

// Green Tax Registrations — this property's yearly Reg No register: corrections (with the
// gap-free renumbering they imply) and monthly MIRA filing, which locks a month. Rules:
// src/lib/green-tax-registry.ts; DECISIONS "Green Tax Report = MIRA information sheet".
// GREEN_TAX only — highly sensitive, so it is not part of Property Setup's CONTROLS.
export default async function HubPropertyGreenTaxPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "green-tax")
  return (
    <div className="space-y-6">
      <HubPageHeader
        title={item.title}
        icon={item.icon}
        scope="property"
        hint="Every guest who stays 12 hours or more in a real room gets the next Reg No at Night Audit, numbered from 1 each year in check-in order with no gaps. Correct mistakes here, then mark each month as filed once it is submitted to MIRA."
      />
      <GreenTaxRegister propertyId={property.id} canManage={canEdit("update")} />
    </div>
  )
}
