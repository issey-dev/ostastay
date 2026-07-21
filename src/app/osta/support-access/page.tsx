import { SupportAccessManager } from "@/components/controls/support-access-manager"

export default function OstaSupportAccessPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Support Access</h2>
        <p className="text-muted-foreground">
          Request time-boxed access to a tenant enterprise, and enter support mode once approved.
        </p>
      </div>
      <SupportAccessManager isInternal={true} />
    </div>
  )
}
