import { EnterprisesList } from "@/components/osta/enterprises-list"
import { PageHeader } from "@/components/ui/page-header"

export default function OstaEnterprisesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Enterprises" tabTitle="Enterprises · Osta" hint="Every customer enterprise registered on the platform." />
      <EnterprisesList />
    </div>
  )
}
