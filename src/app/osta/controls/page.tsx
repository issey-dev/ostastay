import { OstaInvoicingManager } from "@/components/osta/osta-invoicing-manager"
import { PlatformMailManager } from "@/components/osta/platform-mail-manager"
import { EmailUsageReport } from "@/components/osta/email-usage-report"
import { PageHeader } from "@/components/ui/page-header"
import { DesktopOnlyNotice } from "@/components/ui/mobile"

// Platform-level controls: how Osta itself bills client enterprises (licensing
// invoices + payment receipts) — the counterpart of a property's own Controls >
// Stationaries page, but for the platform's paper rather than a guest's — plus the
// platform's own outgoing mail sender.
export default function OstaControlsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Controls" tabTitle="Controls · Osta" hint={<>Configure the invoices and payment receipts Osta issues to client enterprises, and check the platform&apos;s own outgoing email.</>} />
      <DesktopOnlyNotice feature="Platform controls" description="You can still read everything below. To make changes comfortably, open the console on a tablet or computer." />
      <PlatformMailManager />
      <EmailUsageReport />
      <OstaInvoicingManager />
    </div>
  )
}
