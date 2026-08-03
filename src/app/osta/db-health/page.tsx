import { DbHealthDashboard } from "@/components/osta/db-health-dashboard"
import { InfoHint } from "@/components/ui/info-hint"

export default function OstaDbHealthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Database Health
            <InfoHint label="Database Health">Storage statistics, per-tenant query load, and channel-manager API performance.</InfoHint>
          </h2>
      </div>
      <DbHealthDashboard />
    </div>
  )
}
