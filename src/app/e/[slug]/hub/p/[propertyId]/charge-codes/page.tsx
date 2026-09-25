import { propertyPage } from "@/lib/hub-page"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { loadHubAddons } from "@/lib/hub-properties"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ControlsCard } from "@/components/controls/controls-card"
import { ChargeGroupsManager } from "@/components/controls/charge-groups-manager"
import { ChargeCodesManager } from "@/components/controls/charge-codes-manager"
import { PostingDefaultsManager } from "@/components/controls/posting-defaults-manager"
import { ModuleOutletPicker } from "@/components/controls/module-outlet-picker"

// This property's own chart of accounts (per property since 2026-09-23 — each property
// keeps its own groups, subgroups and codes; .agents/docs/HUB_SETUP_PLAN.md, Phase 2).
export default async function HubPropertyChargeCodesPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { ctx, property, item, canEdit } = await propertyPage(params, "charge-codes")
  const addons = await loadHubAddons(ctx.enterpriseId)
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <ControlsCard title="Charge groups & subgroups" description="The two levels above a charge code. A Group carries the reporting bucket every revenue, tax and EOD report rolls up into; a Subgroup splits it further for detail. The canonical set is system-managed — rename freely, and add your own alongside.">
        <ChargeGroupsManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard
        title="Charge Codes"
        description="The transaction codes this property posts against — Night Audit, POS, folios and billing. Each is classified by Subgroup (that's what reports group by), carries a posting type, and can automatically generate derived charges such as Green Tax."
        action={canEdit("create") && <CopyFromPropertyButton propertyId={property.id} section="charge-codes" title="charge codes" />}
      >
        <ChargeCodesManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Posting defaults" description="Which of this property's charge codes plays each system role: the nightly room charge, the Green Tax levy, and the Travel Agent commission credit. Billing resolves these by role, never by a hardcoded code name.">
        <PostingDefaultsManager propertyId={property.id} />
      </ControlsCard>
      {addons.has("SPA") && (
        <ControlsCard title="Spa outlet" description="The outlet of this property that its spa charges post through and whose Tax Rule they follow. Posting is blocked until one is linked.">
          <ModuleOutletPicker propertyId={property.id} module="SPA" />
        </ControlsCard>
      )}
      {addons.has("EXCURSIONS") && (
        <ControlsCard title="Excursion outlet" description="The outlet of this property that its excursion sales post through and whose Tax Rule they follow. Posting is blocked until one is linked.">
          <ModuleOutletPicker propertyId={property.id} module="EXCURSIONS" />
        </ControlsCard>
      )}
    </div>
  )
}
