import { OstaInvoicingManager } from "@/components/osta/osta-invoicing-manager"
import { PlatformMailManager } from "@/components/osta/platform-mail-manager"
import { InfoHint } from "@/components/ui/info-hint"

// Platform-level controls: how Osta itself bills client enterprises (licensing
// invoices + payment receipts) — the counterpart of a property's own Controls >
// Stationaries page, but for the platform's paper rather than a guest's — plus the
// platform's own outgoing mail sender.
export default function OstaControlsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Controls
            <InfoHint label="Controls">Configure the invoices and payment receipts Osta issues to client enterprises, and check the platform&apos;s own outgoing email.</InfoHint>
          </h2>
      </div>
      <PlatformMailManager />
      <OstaInvoicingManager />
    </div>
  )
}
