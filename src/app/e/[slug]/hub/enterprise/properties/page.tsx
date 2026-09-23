import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { PropertiesManager } from "@/components/settings/properties-manager"

export default async function HubEnterprisePropertiesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { item } = await enterprisePage(params, "properties")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="enterprise" />
      <PropertiesManager
        title="Properties"
        description="Every property in this enterprise. Add a property here; once approved, set it up under its own name in the sidebar."
      />
    </div>
  )
}
