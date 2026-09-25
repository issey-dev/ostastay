import { DbHealthDashboard } from "@/components/osta/db-health-dashboard"
import { PageHeader } from "@/components/ui/page-header"

export default function OstaDbHealthPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="DB Health" tabTitle="DB Health · Osta" hint="Storage statistics, per-tenant query load, and channel-manager API performance." />
      <DbHealthDashboard />
    </div>
  )
}
