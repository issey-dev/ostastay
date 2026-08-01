import { OstaInvoicingManager } from "@/components/osta/osta-invoicing-manager"

// Platform-level controls: how Osta itself bills client enterprises (licensing
// invoices + payment receipts) — the counterpart of a property's own Controls >
// Stationaries page, but for the platform's paper rather than a guest's.
export default function OstaControlsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Controls</h2>
        <p className="text-muted-foreground">Configure the invoices and payment receipts Osta issues to client enterprises.</p>
      </div>
      <OstaInvoicingManager />
    </div>
  )
}
