import { Suspense } from "react"
import { SupportAccessLog } from "@/components/osta/support-access-log"
import { PageHeader } from "@/components/ui/page-header"
import { InlineLoading } from "@/components/ui/inline-loading"

export default function OstaSupportAccessPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Support Access"
        tabTitle="Support Access · Osta"
        description="Ask an enterprise for time-boxed access, and see what is live, pending or over."
        hint="The enterprise's own admin approves each request from their Hub. Approved access ends on its own when the time is up."
      />
      <Suspense fallback={<InlineLoading className="p-8" label="Loading support access" />}>
        <SupportAccessLog />
      </Suspense>
    </div>
  )
}
