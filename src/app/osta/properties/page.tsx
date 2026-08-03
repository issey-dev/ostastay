import { PropertyApprovalQueue } from "@/components/osta/property-approval-queue"
import { InfoHint } from "@/components/ui/info-hint"

export default function OstaPropertiesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            Property Approvals
            <InfoHint label="Property Approvals">New properties are locked out of real use until approved here.</InfoHint>
          </h2>
      </div>
      <PropertyApprovalQueue />
    </div>
  )
}
