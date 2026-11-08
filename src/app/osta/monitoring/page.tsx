import { Suspense } from "react"
import { MonitoringDashboard } from "@/components/osta/monitoring/monitoring-dashboard"

// Osta platform monitoring (formerly DB Health, /osta/db-health redirects here).
// Client-driven: scope, range and tab live in the URL; see MonitoringDashboard.
export default function OstaMonitoringPage() {
  return (
    <Suspense>
      <MonitoringDashboard />
    </Suspense>
  )
}
