import { EnterpriseDirectory } from "@/components/osta/enterprise-directory"
import { CreateEnterpriseButton } from "@/components/osta/create-enterprise-button"
import { PageHeader } from "@/components/ui/page-header"
import { getEnterpriseDirectory } from "@/lib/osta/directory"

export default async function OstaEnterprisesPage() {
  const rows = await getEnterpriseDirectory()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Enterprises"
        tabTitle="Enterprises · Osta"
        hint="Every customer enterprise, with licence, billing, properties and channel health on one row. Click a row for a preview; the name opens the enterprise."
        actions={<CreateEnterpriseButton />}
      />
      <EnterpriseDirectory rows={rows} />
    </div>
  )
}
