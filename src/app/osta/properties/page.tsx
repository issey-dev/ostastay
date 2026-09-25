import { PropertyApprovalQueue } from "@/components/osta/property-approval-queue"
import { PageHeader } from "@/components/ui/page-header"

export default function OstaPropertiesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Property Approvals" tabTitle="Property Approvals · Osta" hint="New properties are locked out of real use until approved here." />
      <PropertyApprovalQueue />
    </div>
  )
}
