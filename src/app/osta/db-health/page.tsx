import { DbHealthDashboard } from "@/components/osta/db-health-dashboard"

export default function OstaDbHealthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Database Health</h2>
        <p className="text-muted-foreground">Row counts, migration status, and live query performance.</p>
      </div>
      <DbHealthDashboard />
    </div>
  )
}
