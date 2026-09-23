import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { TaxManager } from "@/components/controls/tax-manager"
import { PaymentMethodsManager } from "@/components/settings/payment-methods-manager"
import { SettlementDefaultsManager } from "@/components/controls/settlement-defaults-manager"
import { GeneralSettingsManager } from "@/components/settings/general-settings-manager"

// INTERIM (Phase 1 → Phase 2 of .agents/docs/HUB_SETUP_PLAN.md): still stored once for the
// whole enterprise. Kept in the enterprise area, and labelled as moving, so no property
// page ever shows settings it does not actually own.
export default async function HubEnterpriseFinancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { item } = await enterprisePage(params, "shared-finance")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="interim" />
      <ControlsCard title="Tax" description="Maldives Tax (Green Tax, GST, Service Charge) and any Custom Tax profiles. Which charge code each levy posts against is set under Charge Codes › Posting Defaults.">
        <TaxManager />
      </ControlsCard>
      <PaymentMethodsManager
        title="Payment Methods"
        description="Accepted payment methods like Cash, Credit Cards, Bank Transfers, or City Ledger."
      />
      <ControlsCard title="Settlement Defaults" description="Which City Ledger payment method settles a debtor folio at checkout.">
        <SettlementDefaultsManager />
      </ControlsCard>
      <ControlsCard title="Cashiering Defaults" description="Opening float and the usual currency-exchange pair, pre-filled on the Cashiering page.">
        <GeneralSettingsManager />
      </ControlsCard>
    </div>
  )
}
