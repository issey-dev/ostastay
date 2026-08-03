import { SupportAccessManager } from "@/components/controls/support-access-manager"
import { InfoHint } from "@/components/ui/info-hint"

export default function OstaSupportAccessPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            Support Access
            <InfoHint label="Support Access">Request time-boxed access to a tenant enterprise, and enter support mode once approved.</InfoHint>
          </h2>
      </div>
      <SupportAccessManager isInternal={true} />
    </div>
  )
}
