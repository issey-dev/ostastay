import { OstaInvoicingManager } from "@/components/osta/osta-invoicing-manager"
import { InfoHint } from "@/components/ui/info-hint"

// Platform-level controls: how Osta itself bills client enterprises (licensing
// invoices + payment receipts) — the counterpart of a property's own Controls >
// Stationaries page, but for the platform's paper rather than a guest's.
export default function OstaControlsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Controls
            <InfoHint label="Controls">Configure the invoices and payment receipts Osta issues to client enterprises.</InfoHint>
          </h2>
      </div>
      <OstaInvoicingManager />
    </div>
  )
}
