import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { ChargeGroupsManager } from "@/components/controls/charge-groups-manager"
import { ChargeCodesManager } from "@/components/controls/charge-codes-manager"
import { PostingDefaultsManager } from "@/components/controls/posting-defaults-manager"
import { ModuleOutletPicker } from "@/components/controls/module-outlet-picker"

// INTERIM (Phase 1 → Phase 2 of .agents/docs/HUB_SETUP_PLAN.md): the chart of accounts is
// still one set for the whole enterprise. Kept in the enterprise area, and labelled as
// moving, so no property page ever shows settings it does not actually own.
export default async function HubEnterpriseCashieringPage({ params }: { params: Promise<{ slug: string }> }) {
  const { item } = await enterprisePage(params, "shared-cashiering")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="interim" />
      <ControlsCard title="Charge Groups & Subgroups" description="The two levels above a charge code. A Group carries the reporting bucket every revenue, tax and EOD report rolls up into; a Subgroup splits it further for detail. The canonical set is system-managed — rename freely, and add your own alongside.">
        <ChargeGroupsManager />
      </ControlsCard>
      <ControlsCard title="Charge Codes" description="The transaction codes everything posts against — Night Audit, POS, folios and billing. Each is classified by Subgroup (that's what reports group by), carries a posting type, and can automatically generate derived charges such as Green Tax.">
        <ChargeCodesManager />
      </ControlsCard>
      <ControlsCard title="Posting Defaults" description="Which charge code plays each system role: the nightly room charge, the Green Tax levy, and the Travel Agent commission credit. Billing resolves these by role, never by a hardcoded code name.">
        <PostingDefaultsManager />
      </ControlsCard>
      <ControlsCard title="Spa Outlet" description="The outlet all spa charges post through and whose Tax Rule they follow. Posting is blocked until one is linked.">
        <ModuleOutletPicker module="SPA" />
      </ControlsCard>
      <ControlsCard title="Excursion Outlet" description="The outlet all excursion sales post through and whose Tax Rule they follow. Posting is blocked until one is linked.">
        <ModuleOutletPicker module="EXCURSIONS" />
      </ControlsCard>
    </div>
  )
}
