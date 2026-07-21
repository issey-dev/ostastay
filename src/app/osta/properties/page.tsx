import { PropertyApprovalQueue } from "@/components/osta/property-approval-queue"

export default function OstaPropertiesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Property Approvals</h2>
        <p className="text-muted-foreground">
          New properties are locked out of real use until approved here.
        </p>
      </div>
      <PropertyApprovalQueue />
    </div>
  )
}
