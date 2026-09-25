import { propertyPage } from "@/lib/hub-page"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ControlsCard } from "@/components/controls/controls-card"
import { TaxManager } from "@/components/controls/tax-manager"
import { PaymentMethodsManager } from "@/components/settings/payment-methods-manager"
import { SettlementDefaultsManager } from "@/components/controls/settlement-defaults-manager"
import { GeneralSettingsManager } from "@/components/settings/general-settings-manager"
import { FeeRulesManager } from "@/components/controls/fee-rules-manager"
import { PropertySwitchSetting } from "@/components/hub/night-audit-settings"
import { prisma } from "@/lib/db"

export default async function HubPropertyFinancePage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { slug, property, item, canEdit } = await propertyPage(params, "finance")
  const canCopy = canEdit("create")
  const { pricesIncludeTaxes, defaultCurrency } = await prisma.property.findUniqueOrThrow({ where: { id: property.id }, select: { pricesIncludeTaxes: true, defaultCurrency: true } })
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <ControlsCard
        title="Tax"
        description="This property's Maldives Tax (Green Tax, GST, Service Charge) and its Custom Tax profiles. Which charge code each levy posts against is set under Charge Codes › Posting Defaults."
        action={canCopy && <CopyFromPropertyButton propertyId={property.id} section="tax-profiles" title="tax profiles" />}
      >
        <div className="mb-6 rounded-md border border-border p-3">
          <PropertySwitchSetting
            propertyId={property.id}
            field="pricesIncludeTaxes"
            label="Prices Include Taxes"
            initial={pricesIncludeTaxes}
            canEdit={canEdit("update")}
            description="Applies to anything charged at this property. On: Green Tax, GST and Service Charge are backed out of the posted amount. Off: they are added on top."
          />
        </div>
        <TaxManager propertyId={property.id} currency={defaultCurrency} nightAuditHref={`/e/${slug}/hub/p/${property.id}/night-audit`} />
      </ControlsCard>
      <PaymentMethodsManager
        propertyId={property.id}
        copyAction={canCopy && <CopyFromPropertyButton propertyId={property.id} section="payment-methods" title="payment methods" />}
        title="Payment Methods"
        description="The payment methods this property accepts — Cash, Credit Cards, Bank Transfers, City Ledger."
      />
      <ControlsCard title="Settlement Defaults" description="Which of this property's City Ledger payment methods settles a debtor folio at checkout.">
        <SettlementDefaultsManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Cashiering Defaults" description="Opening float and the usual currency-exchange pair, pre-filled on this property's Cashiering page.">
        <GeneralSettingsManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Deposit & Fee Rules" description="This property's Deposit, Cancellation and No-Show fee rules. The amount can be flat, a percentage of the stay, the first night, or the full stay. Cancellation fees are prompted on cancel; no-show fees apply at Night Audit — both collected via the Deposit module, never billing.">
        <FeeRulesManager propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
