import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { PropertiesManager } from "@/components/settings/properties-manager"
import { loadHubAddons } from "@/lib/hub-properties"

export default async function HubEnterprisePropertiesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { ctx, item } = await enterprisePage(params, "properties")
  const held = await loadHubAddons(ctx.enterpriseId)
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="enterprise" />
      <PropertiesManager
        addons={{ spa: held.has("SPA"), excursions: held.has("EXCURSIONS") }}
        title="Properties"
        description="Every property in this enterprise. Add a property here; once approved, set it up under its own name in the sidebar."
      />
    </div>
  )
}
