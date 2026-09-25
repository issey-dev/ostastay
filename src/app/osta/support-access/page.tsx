import { SupportAccessManager } from "@/components/controls/support-access-manager"
import { PageHeader } from "@/components/ui/page-header"

export default function OstaSupportAccessPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Support Access" tabTitle="Support Access · Osta" hint="Request time-boxed access to a tenant enterprise, and enter support mode once approved." />
      <SupportAccessManager isInternal={true} />
    </div>
  )
}
